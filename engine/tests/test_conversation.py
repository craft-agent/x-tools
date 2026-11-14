"""The `conversation` operation: one TweetDetail page, read as a post, its ancestors, its replies and the cursor."""

import json
import unittest

from detail import DETAIL_KV, FIRST, FOCAL, FOURTH, GRACE, POST, SECOND, THIRD, DetailTest, ids_of
from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import cursor_entry
from twscrape import AbortReqError
from twscrape import api as fake_api

CONVERSATION_ARGS = {"id": FOCAL, "ranking": "Likes", "cursor": None}


def conversation_request(**args) -> dict:
    return make_request("conversation", args={**CONVERSATION_ARGS, **args})


class TestRequest(DetailTest):
    def test_a_page_is_one_request_with_what_twscrape_sends_for_replies(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        handle(conversation_request(ranking="Recency"))
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [
                {
                    "op": fake_api.OP_TweetDetail,
                    "kv": {**DETAIL_KV, "referrer": "tweet", "rankingMode": "Recency"},
                    "ft": None,
                    "toggles": fake_api.ARTICLE_FIELD_TOGGLES,
                }
            ],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        handle(conversation_request(cursor="from-before"))
        handle(conversation_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])

    def test_each_ranking_is_asked_for_as_it_is_named(self):
        for ranking in ("Likes", "Recency"):
            with self.subTest(ranking):
                handle(conversation_request(ranking=ranking))
                self.assertEqual(fake_api.GQL_ITEMS[-1]["kv"]["rankingMode"], ranking)


class TestConversation(DetailTest):
    def test_the_post_its_ancestors_root_first_and_its_replies(self):
        self.tweet(FIRST, user=GRACE)
        self.tweet(SECOND, FIRST)
        self.tweet(THIRD, SECOND, user=GRACE)
        self.tweet(POST, THIRD)
        self.tweet(FOURTH, POST, user=GRACE)
        self.answer_with_tweets(POST, THIRD, FIRST, SECOND, FOURTH, extra=(cursor_entry("next"),))
        reply = handle(conversation_request())
        self.assertTrue(reply["ok"], reply)
        data = reply["data"]
        self.assertEqual(set(data), {"post", "ancestors", "replies", "cursor"})
        self.assertEqual(data["post"]["id"], FOCAL)
        self.assertEqual(data["post"]["reply_to"], {"id": str(THIRD), "username": None})
        self.assertEqual(ids_of(data["ancestors"]), [str(FIRST), str(SECOND), str(THIRD)])
        self.assertEqual(ids_of(data["replies"]), [str(FOURTH)])
        self.assertEqual(data["cursor"], "next")
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_ancestors_end_where_the_chain_leaves_the_page(self):
        self.tweet(SECOND, FIRST)
        self.tweet(POST, SECOND)
        self.answer_with_tweets(POST, SECOND)
        self.assertEqual(ids_of(handle(conversation_request())["data"]["ancestors"]), [str(SECOND)])

    def test_a_post_that_is_not_a_reply_has_no_ancestors(self):
        self.tweet(POST)
        self.tweet(FIRST)
        self.answer_with_tweets(POST, FIRST)
        self.assertEqual(handle(conversation_request())["data"]["ancestors"], [])

    def test_a_chain_that_loops_ends_at_the_first_repeat(self):
        self.tweet(FIRST, POST)
        self.tweet(POST, FIRST)
        self.answer_with_tweets(POST, FIRST)
        data = handle(conversation_request())["data"]
        self.assertEqual(ids_of(data["ancestors"]), [str(FIRST)])
        self.assertEqual(ids_of(data["replies"]), [str(FIRST)])

    def test_replies_are_the_direct_ones_in_the_order_of_the_timeline(self):
        self.tweet(POST)
        self.tweet(FIRST, POST, user=GRACE)
        self.tweet(SECOND, POST)
        self.tweet(THIRD, FIRST)
        self.tweet(FOURTH, POST)
        self.answer_with_tweets(POST, FOURTH, THIRD, FIRST, SECOND)
        self.assertEqual(
            ids_of(handle(conversation_request())["data"]["replies"]), [str(FOURTH), str(FIRST), str(SECOND)]
        )

    def test_the_bottom_cursor_is_the_one_returned(self):
        self.tweet(POST)
        self.tweet(FIRST, POST)
        self.answer_with_tweets(
            POST, FIRST, extra=(cursor_entry("more", "ShowMoreThreads"), cursor_entry("below", "Bottom"))
        )
        self.assertEqual(handle(conversation_request())["data"]["cursor"], "below")

    def test_without_a_bottom_cursor_the_show_more_threads_cursor_is_returned(self):
        self.tweet(POST)
        self.tweet(FIRST, POST)
        self.answer_with_tweets(POST, FIRST, extra=(cursor_entry("more", "ShowMoreThreads"),))
        self.assertEqual(handle(conversation_request())["data"]["cursor"], "more")

    def test_a_page_without_replies_has_no_cursor_though_X_gave_one(self):
        self.tweet(POST)
        self.answer_with_tweets(POST, extra=(cursor_entry("past-the-end"),))
        data = handle(conversation_request())["data"]
        self.assertEqual((data["replies"], data["cursor"]), ([], None))
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)

    def test_a_page_without_cursors_ends_the_pages(self):
        self.tweet(POST)
        self.tweet(FIRST, POST)
        self.answer_with_tweets(POST, FIRST)
        self.assertIsNone(handle(conversation_request())["data"]["cursor"])

    def test_no_post_on_a_first_page_is_no_data(self):
        self.tweet(FIRST, POST)
        self.answer_with_tweets(FIRST, extra=(cursor_entry("more"),))
        self.assert_ok(handle(conversation_request()), None, contacted=True)

    def test_no_post_on_a_continuing_page_is_a_page_of_replies(self):
        self.tweet(FIRST, POST)
        self.tweet(SECOND, FIRST)
        self.answer_with_tweets(FIRST, SECOND, extra=(cursor_entry("more"),))
        data = handle(conversation_request(cursor="from-before"))["data"]
        self.assertEqual((data["post"], data["ancestors"], data["cursor"]), (None, [], "more"))
        self.assertEqual(ids_of(data["replies"]), [str(FIRST)])

    def test_a_continuing_page_without_anything_is_an_empty_page(self):
        self.answer_with_tweets()
        self.assert_ok(
            handle(conversation_request(cursor="from-before")),
            {"post": None, "ancestors": [], "replies": [], "cursor": None},
            contacted=True,
        )


class TestFailures(DetailTest):
    def test_no_reply_is_no_account(self):
        reply = handle(conversation_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        self.assertIsNotNone(reply["session"])

    def test_the_failures_of_a_request_keep_their_kinds(self):
        for error, kind in ((AbortReqError("Blocked: 403"), "x_error"), (TimeoutError(), "timeout")):
            with self.subTest(kind):
                fake_api.GQL_ERROR = error
                self.assert_failure(handle(conversation_request()), kind, contacted=True)


class TestArguments(DetailTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        invalid = {
            "no arguments": ({}, None),
            "a missing cursor": ({"id": FOCAL, "ranking": "Likes"}, None),
            "an extra key": ({**CONVERSATION_ARGS, "limit": 5}, None),
            "no id": ({"ranking": "Likes", "cursor": None}, None),
            "a number as id": ({**CONVERSATION_ARGS, "id": 5}, None),
            "an id of 21 digits": ({**CONVERSATION_ARGS, "id": "1" * 21}, "1" * 21),
            "an id that is not digits": ({**CONVERSATION_ARGS, "id": "12ab-9f3"}, "12ab-9f3"),
            "an unknown ranking": ({**CONVERSATION_ARGS, "ranking": "Nonsense-9f3"}, "Nonsense-9f3"),
            "a lowercase ranking": ({**CONVERSATION_ARGS, "ranking": "likes"}, "likes"),
            "a list as ranking": ({**CONVERSATION_ARGS, "ranking": ["Likes"]}, None),
            "an empty cursor": ({**CONVERSATION_ARGS, "cursor": ""}, None),
            "a cursor of 2001 characters": ({**CONVERSATION_ARGS, "cursor": "c" * 2001}, "c" * 2001),
            "a number as cursor": ({**CONVERSATION_ARGS, "cursor": 5}, None),
        }
        self.assert_invalid_before_contact("conversation", invalid)

    def test_the_limits_themselves_are_taken(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        for name, args in {
            "an id of 1 digit": {"id": "1"},
            "an id of 20 digits": {"id": "1" * 20},
            "a cursor of 2000 characters": {"cursor": "c" * 2000},
            "a cursor of 1 character": {"cursor": "c"},
        }.items():
            with self.subTest(name):
                self.assertTrue(handle(conversation_request(**args))["ok"])


class TestMasking(DetailTest):
    def test_cookie_values_in_a_post_or_the_cursor_are_masked(self):
        self.tweet(POST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        self.tweet(FIRST, POST)
        self.answer_with_tweets(POST, FIRST, extra=(cursor_entry(f"cursor-{CSRF}"),))
        reply = handle(conversation_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("leaked [masked] and [masked]", json.dumps(reply))
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        handle(conversation_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
