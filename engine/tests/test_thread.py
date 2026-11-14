"""The `thread` operation: one TweetDetail page, read as the posts of the author's thread, oldest first."""

import json
import unittest

from detail import DETAIL_KV, FIFTH, FIRST, FOCAL, FOURTH, GRACE, POST, SECOND, THIRD, DetailTest, ids_of
from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import cursor_entry
from twscrape import AbortReqError
from twscrape import api as fake_api


def thread_request(**args) -> dict:
    return make_request("thread", args={"id": FOCAL, **args})


class TestThread(DetailTest):
    def test_a_page_is_one_request_with_what_twscrape_sends_for_a_thread(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        handle(thread_request())
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        item = fake_api.GQL_ITEMS[0]
        self.assertEqual(item["op"], fake_api.OP_TweetDetail)
        self.assertEqual(item["kv"], {**DETAIL_KV, "referrer": "profile", "with_rux_injections": False})
        self.assertIsNone(item["toggles"])
        self.assertIs(item["ft"]["rweb_video_screen_enabled"], False)
        self.assertIs(item["ft"]["responsive_web_grok_analysis_button_from_backend"], True)

    def test_the_chain_of_the_author_goes_both_ways_from_the_post(self):
        self.tweet(FIRST)
        self.tweet(SECOND, FIRST)
        self.tweet(POST, SECOND)
        self.tweet(THIRD, POST)
        self.tweet(FOURTH, SECOND, user=GRACE)
        self.tweet(FIFTH, THIRD, user=GRACE)
        self.answer_with_tweets(THIRD, FIRST, FOURTH, POST, SECOND, FIFTH)
        for focal in (FIRST, SECOND, POST, THIRD):
            with self.subTest(focal):
                reply = handle(thread_request(id=str(focal)))
                self.assertEqual(set(reply["data"]), {"posts"})
                self.assertEqual(ids_of(reply["data"]["posts"]), [str(id) for id in (FIRST, SECOND, POST, THIRD)])

    def test_an_ancestor_by_someone_else_stops_the_chain(self):
        self.tweet(FIRST)
        self.tweet(SECOND, FIRST, user=GRACE)
        self.tweet(POST, SECOND)
        self.tweet(THIRD, POST)
        self.answer_with_tweets(FIRST, SECOND, POST, THIRD)
        self.assertEqual(ids_of(handle(thread_request())["data"]["posts"]), [FOCAL, str(THIRD)])

    def test_the_chain_ends_where_it_leaves_the_page(self):
        self.tweet(POST, FIRST)
        self.answer_with_tweets(POST)
        self.assertEqual(ids_of(handle(thread_request())["data"]["posts"]), [FOCAL])

    def test_the_first_self_reply_in_the_timeline_is_followed(self):
        self.tweet(POST)
        self.tweet(FIRST, POST)
        self.tweet(SECOND, POST)
        self.tweet(THIRD, FIRST)
        self.answer_with_tweets(POST, SECOND, FIRST, THIRD)
        self.assertEqual(ids_of(handle(thread_request())["data"]["posts"]), [FOCAL, str(SECOND)])

    def test_a_chain_that_loops_is_listed_once(self):
        self.tweet(FIRST, POST)
        self.tweet(POST, FIRST)
        self.answer_with_tweets(POST, FIRST)
        self.assertEqual(ids_of(handle(thread_request())["data"]["posts"]), [str(FIRST), FOCAL])

    def test_no_post_is_no_data(self):
        self.tweet(FIRST, POST)
        self.answer_with_tweets(FIRST)
        self.assert_ok(handle(thread_request()), None, contacted=True)


class TestFailures(DetailTest):
    def test_no_reply_is_no_account(self):
        reply = handle(thread_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        self.assertIsNotNone(reply["session"])

    def test_the_failures_of_a_request_keep_their_kinds(self):
        for error, kind in ((AbortReqError("Blocked: 403"), "x_error"), (TimeoutError(), "timeout")):
            with self.subTest(kind):
                fake_api.GQL_ERROR = error
                self.assert_failure(handle(thread_request()), kind, contacted=True)


class TestArguments(DetailTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        invalid = {
            "no arguments": ({}, None),
            "an extra key": ({"id": FOCAL, "cursor": None}, None),
            "a number as id": ({"id": 5}, None),
            "an empty id": ({"id": ""}, None),
            "an id of 21 digits": ({"id": "1" * 21}, "1" * 21),
            "an id that is not digits": ({"id": "12ab-9f3"}, "12ab-9f3"),
        }
        self.assert_invalid_before_contact("thread", invalid)


class TestMasking(DetailTest):
    def test_cookie_values_in_a_post_are_masked(self):
        self.tweet(POST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        self.tweet(FIRST, POST)
        self.answer_with_tweets(POST, FIRST, extra=(cursor_entry(f"cursor-{CSRF}"),))
        reply = handle(thread_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("leaked [masked] and [masked]", json.dumps(reply))

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(thread_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.tweet(POST)
        self.answer_with_tweets(POST)
        handle(thread_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
