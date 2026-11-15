"""The `timeline` operation: one page of an account's posts, replies or media, and the cursor of the next page."""

import json
import unittest

from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from timelines import cursor_entry, module_entry, page, tweet_entry
from tweets import POST_ID, make_photo, make_tweet, make_user
from twscrape import AbortReqError, NoAccountError
from twscrape import api as fake_api
from twscrape.models import Media

FIRST, SECOND, THIRD = POST_ID, POST_ID + 1, POST_ID + 2
USER_ID = "4001"
VALID_ARGS = {"user_id": USER_ID, "tab": "posts", "count": 20, "cursor": None}
POSTS_VARIABLES = {
    "includePromotedContent": True,
    "withQuickPromoteEligibilityTweetFields": True,
    "withVoice": True,
    "withV2Timeline": True,
}
REPLIES_VARIABLES = {
    "includePromotedContent": True,
    "withCommunity": True,
    "withVoice": True,
    "withV2Timeline": True,
}
MEDIA_VARIABLES = {
    "includePromotedContent": False,
    "withClientEventToken": False,
    "withBirdwatchNotes": False,
    "withVoice": True,
    "withV2Timeline": True,
}
# For each tab: the operation twscrape reads it with, the variables beside `userId` and `count`, and the toggles.
TABS = {
    "posts": (fake_api.OP_UserTweets, POSTS_VARIABLES, None),
    "replies": (fake_api.OP_UserTweetsAndReplies, REPLIES_VARIABLES, None),
    "media": (fake_api.OP_UserMedia, MEDIA_VARIABLES, {"withArticlePlainText": False}),
}


def timeline_request(**args) -> dict:
    return make_request("timeline", args={**VALID_ARGS, **args})


def post_ids(reply: dict) -> list[str]:
    return [post["id"] for post in reply["data"]["posts"]]


class TimelineTest(BridgeTest):
    def setUp(self):
        fake_api.TWEETS.clear()
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.TWEETS.clear)
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def answer_with(self, *entries: dict, tweets: tuple[int, ...] = ()) -> None:
        """Scripts the page X answers with; `tweets` are the ids twscrape can parse."""
        for id in tweets:
            fake_api.TWEETS[id] = make_tweet(id)
        fake_api.GQL_REPLY = page(*entries)


class TestRequest(TimelineTest):
    def test_each_tab_is_one_request_with_the_operation_and_variables_twscrape_sends(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for tab, (operation_id, variables, toggles) in TABS.items():
            with self.subTest(tab):
                fake_api.GQL_ITEMS.clear()
                handle(timeline_request(tab=tab, count=7))
                self.assertEqual(
                    fake_api.GQL_ITEMS,
                    [
                        {
                            "op": operation_id,
                            "kv": {"userId": USER_ID, "count": 7, **variables},
                            "ft": None,
                            "toggles": toggles,
                        }
                    ],
                )

    def test_the_user_id_is_sent_as_text_and_the_count_as_asked(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(timeline_request(user_id="1700000000000000001", count=50))
        kv = fake_api.GQL_ITEMS[0]["kv"]
        self.assertEqual((kv["userId"], kv["count"]), ("1700000000000000001", 50))

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for tab in TABS:
            handle(timeline_request(tab=tab, cursor="from-before"))
            handle(timeline_request(tab=tab))
        given, absent = fake_api.GQL_ITEMS[::2], fake_api.GQL_ITEMS[1::2]
        self.assertEqual([item["kv"]["cursor"] for item in given], ["from-before"] * 3)
        self.assertTrue(all("cursor" not in item["kv"] for item in absent))
        self.assertEqual(len(fake_api.GQL_ITEMS), 6)


class TestPage(TimelineTest):
    def test_a_page_is_the_posts_and_the_next_cursor(self):
        self.answer_with(tweet_entry(FIRST), tweet_entry(SECOND), cursor_entry("next-page"), tweets=(FIRST, SECOND))
        reply = handle(timeline_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["posts"][0]["text"], "Notes on reading slowly.")
        self.assertEqual(set(reply["data"]), {"posts", "cursor"})
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_posts_follow_the_entries_not_the_order_twscrape_parsed_them_in(self):
        self.answer_with(
            module_entry(THIRD), tweet_entry(SECOND), tweet_entry(FIRST), cursor_entry("next"),
            tweets=(FIRST, SECOND, THIRD),
        )
        self.assertEqual(post_ids(handle(timeline_request())), [str(SECOND), str(FIRST), str(THIRD)])

    def test_a_post_in_a_conversation_entry_is_found_by_the_id_the_entry_ends_in(self):
        self.answer_with(
            tweet_entry(SECOND), tweet_entry(FIRST, prefix="profile-conversation-1700-tweet"), tweets=(FIRST, SECOND)
        )
        self.assertEqual(post_ids(handle(timeline_request(tab="replies"))), [str(SECOND), str(FIRST)])

    def test_posts_and_replies_keep_whoever_wrote_what_X_lists(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST)
        fake_api.TWEETS[SECOND] = make_tweet(SECOND, user=make_user("grace_reads", 4002, "Grace Reads"))
        fake_api.GQL_REPLY = page(tweet_entry(FIRST), tweet_entry(SECOND))
        for tab in ("posts", "replies"):
            with self.subTest(tab):
                reply = handle(timeline_request(tab=tab))
                self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
                self.assertEqual(reply["data"]["posts"][1]["user"]["username"], "grace_reads")

    def test_count_caps_the_posts(self):
        self.answer_with(
            tweet_entry(FIRST), tweet_entry(SECOND), tweet_entry(THIRD), cursor_entry("next"),
            tweets=(FIRST, SECOND, THIRD),
        )
        for tab in ("posts", "replies"):
            with self.subTest(tab):
                reply = handle(timeline_request(tab=tab, count=2))
                self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
                self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_bottom_cursor_is_the_one_returned(self):
        self.answer_with(
            cursor_entry("above", "Top"), tweet_entry(FIRST), cursor_entry("below", "Bottom"), tweets=(FIRST,)
        )
        self.assertEqual(handle(timeline_request())["data"]["cursor"], "below")

    def test_a_page_without_a_bottom_cursor_ends_the_pages(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        self.assertIsNone(handle(timeline_request())["data"]["cursor"])

    def test_a_page_without_posts_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        for tab in TABS:
            with self.subTest(tab):
                self.assert_ok(handle(timeline_request(tab=tab)), {"posts": [], "cursor": None}, contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 3)


class TestMedia(TimelineTest):
    def setUp(self):
        super().setUp()
        fake_api.TWEETS[FIRST] = make_tweet(FIRST, media=Media(photos=[make_photo()]))
        fake_api.TWEETS[SECOND] = make_tweet(SECOND)
        fake_api.TWEETS[THIRD] = make_tweet(THIRD, media=Media(photos=[make_photo()]))
        fake_api.GQL_REPLY = page(
            tweet_entry(FIRST), tweet_entry(SECOND), tweet_entry(THIRD), cursor_entry("next")
        )

    def test_the_media_tab_keeps_only_the_posts_that_hold_media(self):
        reply = handle(timeline_request(tab="media"))
        self.assertEqual(post_ids(reply), [str(FIRST), str(THIRD)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_other_tabs_keep_the_posts_without_media(self):
        for tab in ("posts", "replies"):
            with self.subTest(tab):
                self.assertEqual(post_ids(handle(timeline_request(tab=tab))), [str(FIRST), str(SECOND), str(THIRD)])

    def test_the_count_counts_the_posts_kept(self):
        self.assertEqual(post_ids(handle(timeline_request(tab="media", count=2))), [str(FIRST), str(THIRD)])
        self.assertEqual(post_ids(handle(timeline_request(tab="media", count=1))), [str(FIRST)])

    def test_a_page_without_media_has_no_cursor(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST)
        fake_api.TWEETS[THIRD] = make_tweet(THIRD)
        self.assert_ok(handle(timeline_request(tab="media")), {"posts": [], "cursor": None}, contacted=True)


class TestFailures(TimelineTest):
    def test_no_reply_is_no_account(self):
        reply = handle(timeline_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        self.assertIsNotNone(reply["session"])

    def test_the_failures_keep_their_kinds(self):
        for error, kind in (
            (NoAccountError("none"), "no_account"),
            (AbortReqError("Blocked by Cloudflare: 403"), "x_error"),
            (TimeoutError(), "timeout"),
            (ValueError("boom"), "error"),
        ):
            with self.subTest(kind):
                fake_api.GQL_ERROR = error
                self.assert_failure(handle(timeline_request(tab="media")), kind, contacted=True)

    def test_the_404_of_a_search_is_not_a_refusal_here(self):
        fake_api.GQL_ERROR = AbortReqError("Failed to get XClIdGen.")
        self.assert_failure(handle(timeline_request()), "x_error", contacted=True)


class TestArguments(TimelineTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        missing = {key: value for key, value in VALID_ARGS.items() if key != "cursor"}
        invalid = {
            "no arguments": ({}, None),
            "a missing cursor": (missing, None),
            "an extra key": ({**VALID_ARGS, "limit": 5}, None),
            "no user id": ({**VALID_ARGS, "user_id": None}, None),
            "a number as user id": ({**VALID_ARGS, "user_id": 4001}, None),
            "a boolean as user id": ({**VALID_ARGS, "user_id": True}, None),
            "an empty user id": ({**VALID_ARGS, "user_id": ""}, None),
            "a sign": ({**VALID_ARGS, "user_id": "-1"}, "-1"),
            "a handle as user id": ({**VALID_ARGS, "user_id": "ada_writes"}, "ada_writes"),
            "a newline": ({**VALID_ARGS, "user_id": "123\n"}, None),
            "21 digits": ({**VALID_ARGS, "user_id": "1" * 21}, "1" * 21),
            "other scripts' digits": ({**VALID_ARGS, "user_id": "١٢٣"}, "١٢٣"),
            "an unknown tab": ({**VALID_ARGS, "tab": "Nonsense-9f3"}, "Nonsense-9f3"),
            "a capitalised tab": ({**VALID_ARGS, "tab": "Posts"}, "Posts"),
            "a list as tab": ({**VALID_ARGS, "tab": ["posts"]}, None),
            "a count of 0": ({**VALID_ARGS, "count": 0}, None),
            "a count of 51": ({**VALID_ARGS, "count": 51}, None),
            "a boolean count": ({**VALID_ARGS, "count": True}, None),
            "a text count": ({**VALID_ARGS, "count": "7"}, None),
            "a decimal count": ({**VALID_ARGS, "count": 7.5}, None),
            "an empty cursor": ({**VALID_ARGS, "cursor": ""}, None),
            "a cursor of 2001 characters": ({**VALID_ARGS, "cursor": "c" * 2001}, "c" * 2001),
            "a number as cursor": ({**VALID_ARGS, "cursor": 5}, None),
        }
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in invalid.items():
            with self.subTest(name):
                reply = handle(make_request("timeline", args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["fingerprint"])
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, json.dumps(reply))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for name, args in {
            "a user id of 1 digit": {"user_id": "0"},
            "a user id of 20 digits": {"user_id": "9" * 20},
            "a count of 1": {"count": 1},
            "a count of 50": {"count": 50},
            "a cursor of 2000 characters": {"cursor": "c" * 2000},
            "a cursor of 1 character": {"cursor": "c"},
        }.items():
            with self.subTest(name):
                self.assertTrue(handle(timeline_request(**args))["ok"])


class TestMasking(TimelineTest):
    def test_cookie_values_in_a_post_or_the_cursor_are_masked(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        fake_api.GQL_REPLY = page(tweet_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(timeline_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["posts"][0]["text"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(timeline_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(timeline_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
