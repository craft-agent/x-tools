"""The `list_posts` operation: one page of a list's latest posts, as the compact posts and the next cursor."""

import unittest

from list_pages import LIMIT_ARGS, LIST_ID, NO_LIST_BODIES, VALID_ARGS, invalid_cases
from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from timelines import Reply, conversation_module_entry, cursor_entry, list_page, tweet_entry
from tweets import POST_ID, make_tweet
from twscrape import AbortReqError
from twscrape import api as fake_api

FIRST, SECOND, THIRD, FOURTH = POST_ID, POST_ID + 1, POST_ID + 2, POST_ID + 3
KEY = "tweets_timeline"


def posts_request(**args) -> dict:
    return make_request("list_posts", args={**VALID_ARGS, **args})


def post_ids(reply: dict) -> list[str]:
    return [post["id"] for post in reply["data"]["posts"]]


class ListPostsTest(BridgeTest):
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
        fake_api.GQL_REPLY = list_page(KEY, *entries)


class TestRequest(ListPostsTest):
    def test_a_page_is_one_request_with_the_variables_and_toggles_of_twscrapes_list_timeline(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        reply = handle(posts_request(count=7))
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [
                {
                    "op": fake_api.OP_ListLatestTweetsTimeline,
                    "kv": {"listId": LIST_ID, "count": 7},
                    "ft": None,
                    "toggles": {"withArticleRichContentState": False},
                }
            ],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(posts_request(cursor="from-before"))
        handle(posts_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])


class TestPage(ListPostsTest):
    def test_a_page_is_the_posts_and_the_next_cursor(self):
        self.answer_with(tweet_entry(FIRST), tweet_entry(SECOND), cursor_entry("next-page"), tweets=(FIRST, SECOND))
        reply = handle(posts_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"posts", "cursor"})
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_the_posts_of_a_conversation_module_come_in_place(self):
        self.answer_with(
            tweet_entry(THIRD), conversation_module_entry(7, SECOND, FIRST), tweet_entry(FOURTH),
            tweets=(FIRST, SECOND, THIRD, FOURTH),
        )
        reply = handle(posts_request())
        self.assertEqual(post_ids(reply), [str(THIRD), str(SECOND), str(FIRST), str(FOURTH)])

    def test_a_module_item_twscrape_cannot_parse_is_skipped(self):
        self.answer_with(
            tweet_entry(THIRD), conversation_module_entry(7, SECOND, FIRST), tweets=(FIRST, THIRD)
        )
        self.assertEqual(post_ids(handle(posts_request())), [str(THIRD), str(FIRST)])

    def test_count_caps_the_posts(self):
        self.answer_with(
            tweet_entry(FIRST), tweet_entry(SECOND), tweet_entry(THIRD), cursor_entry("next"),
            tweets=(FIRST, SECOND, THIRD),
        )
        reply = handle(posts_request(count=2))
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_top_cursor_is_ignored(self):
        self.answer_with(cursor_entry("above", "Top"), tweet_entry(FIRST), cursor_entry("below"), tweets=(FIRST,))
        self.assertEqual(handle(posts_request())["data"]["cursor"], "below")
        self.answer_with(cursor_entry("above", "Top"), tweet_entry(FIRST), tweets=(FIRST,))
        self.assertIsNone(handle(posts_request())["data"]["cursor"])

    def test_a_page_without_posts_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(posts_request()), {"posts": [], "cursor": None}, contacted=True)

    def test_a_reply_without_the_tweets_timeline_is_no_such_list(self):
        bodies = {
            **NO_LIST_BODIES,
            "a members reply": {"data": {"list": {"members_timeline": {"timeline": {"instructions": []}}}}},
            "a list with a null timeline": {"data": {"list": {KEY: None}}},
        }
        for name, body in bodies.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                self.assert_ok(handle(posts_request()), None, contacted=True)


class TestFailures(ListPostsTest):
    def test_no_reply_is_no_account(self):
        reply = handle(posts_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(posts_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(posts_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(posts_request()), "error", contacted=True)


class TestArguments(ListPostsTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in invalid_cases().items():
            with self.subTest(name):
                reply = handle(make_request("list_posts", args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, str(reply))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for name, args in LIMIT_ARGS.items():
            with self.subTest(name):
                self.assertTrue(handle(posts_request(**args))["ok"])


class TestMasking(ListPostsTest):
    def test_cookie_values_in_a_post_or_the_cursor_are_masked(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        self.answer_with(tweet_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(posts_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["posts"][0]["text"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(posts_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(posts_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
