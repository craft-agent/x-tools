"""The `search` operation: one page of X's search, as the compact posts and the cursor of the next page."""

import json
import unittest

from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from timelines import cursor_entry, module_entry, page, tweet_entry
from tweets import POST_ID, make_tweet
from twscrape import AbortReqError
from twscrape import api as fake_api

FIRST, SECOND, THIRD = POST_ID, POST_ID + 1, POST_ID + 2
VALID_ARGS = {"query": "reading slowly", "product": "Latest", "count": 20, "cursor": None}
TWSCRAPE_404_ERROR = "Failed to get XClIdGen. See: https://github.com/vladkens/twscrape/issues/248"
REFUSED_ERROR = (
    "X refused the search: X answers 404 to a search by an account whose phone is not verified"
)


def search_request(**args) -> dict:
    return make_request("search", args={**VALID_ARGS, **args})


def post_ids(reply: dict) -> list[str]:
    return [post["id"] for post in reply["data"]["posts"]]


class SearchTest(BridgeTest):
    def setUp(self):
        fake_api.TWEETS.clear()
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.TWEETS.clear)
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def answer_with(self, *entries: dict, tweets: tuple[int, ...] = ()) -> None:
        """Scripts the page X answers with; `tweets` are the ids twscrape can parse, else those of the entries."""
        for id in tweets:
            fake_api.TWEETS[id] = make_tweet(id)
        fake_api.GQL_REPLY = page(*entries)


class TestPage(SearchTest):
    def test_a_page_is_the_posts_and_the_next_cursor(self):
        self.answer_with(tweet_entry(FIRST), tweet_entry(SECOND), cursor_entry("next-page"), tweets=(FIRST, SECOND))
        reply = handle(search_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["posts"][0]["text"], "Notes on reading slowly.")
        self.assertEqual(set(reply["data"]), {"posts", "cursor"})
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_a_page_is_one_request_with_the_variables_of_twscrapes_search(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(search_request(query="  spaced  words ", product="Top", count=7))
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [
                {
                    "op": fake_api.OP_SearchTimeline,
                    "kv": {"rawQuery": "  spaced  words ", "count": 7, "product": "Top", "querySource": "typed_query"},
                    "ft": None,
                    "toggles": {"withArticleRichContentState": False},
                }
            ],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(search_request(cursor="from-before"))
        handle(search_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])

    def test_each_product_is_asked_for_as_it_is_named(self):
        for product in ("Latest", "Top", "Media"):
            with self.subTest(product):
                handle(search_request(product=product))
                self.assertEqual(fake_api.GQL_ITEMS[-1]["kv"]["product"], product)

    def test_posts_follow_the_entries_not_the_order_twscrape_parsed_them_in(self):
        parsed_first = module_entry(THIRD)
        self.answer_with(
            parsed_first, tweet_entry(SECOND), tweet_entry(FIRST), cursor_entry("next"), tweets=(FIRST, SECOND, THIRD)
        )
        self.assertEqual(post_ids(handle(search_request())), [str(SECOND), str(FIRST), str(THIRD)])

    def test_a_tweet_in_a_conversation_entry_is_found_by_the_id_the_entry_ends_in(self):
        self.answer_with(tweet_entry(SECOND), tweet_entry(FIRST, prefix="conversationthread"), tweets=(FIRST, SECOND))
        self.assertEqual(post_ids(handle(search_request())), [str(SECOND), str(FIRST)])

    def test_a_tweet_twice_in_the_entries_is_listed_once(self):
        self.answer_with(tweet_entry(FIRST), tweet_entry(FIRST, prefix="conversationthread"), tweets=(FIRST,))
        self.assertEqual(post_ids(handle(search_request())), [str(FIRST)])

    def test_count_caps_the_posts(self):
        self.answer_with(
            tweet_entry(FIRST), tweet_entry(SECOND), tweet_entry(THIRD), cursor_entry("next"),
            tweets=(FIRST, SECOND, THIRD),
        )
        reply = handle(search_request(count=2))
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_bottom_cursor_is_the_one_returned(self):
        self.answer_with(
            cursor_entry("above", "Top"), tweet_entry(FIRST), cursor_entry("below", "Bottom"), tweets=(FIRST,)
        )
        self.assertEqual(handle(search_request())["data"]["cursor"], "below")

    def test_a_page_without_a_bottom_cursor_ends_the_pages(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        self.assertIsNone(handle(search_request())["data"]["cursor"])

    def test_a_page_without_posts_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(search_request()), {"posts": [], "cursor": None}, contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)

    def test_entries_twscrape_cannot_parse_leave_a_page_without_posts(self):
        self.answer_with(tweet_entry(FIRST), cursor_entry("next"))
        self.assert_ok(handle(search_request()), {"posts": [], "cursor": None}, contacted=True)


class TestFailures(SearchTest):
    def test_no_reply_is_no_account(self):
        reply = handle(search_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        self.assertIsNotNone(reply["session"])

    def test_the_404_twscrape_retries_is_search_refused(self):
        fake_api.GQL_ERROR = AbortReqError(TWSCRAPE_404_ERROR)
        reply = handle(search_request())
        self.assert_failure(reply, "search_refused", contacted=True)
        self.assertEqual(reply["error"], REFUSED_ERROR)
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)

    def test_any_other_abort_is_an_x_error_as_before(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(search_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")
        self.assertIsNotNone(reply["session"])

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(search_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(search_request()), "error", contacted=True)


class TestArguments(SearchTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        missing = {key: value for key, value in VALID_ARGS.items() if key != "cursor"}
        invalid = {
            "no arguments": ({}, None),
            "a missing cursor": (missing, None),
            "an extra key": ({**VALID_ARGS, "limit": 5}, None),
            "no query": ({**VALID_ARGS, "query": None}, None),
            "a number as query": ({**VALID_ARGS, "query": 5}, None),
            "an empty query": ({**VALID_ARGS, "query": ""}, None),
            "a blank query": ({**VALID_ARGS, "query": " \t\n "}, None),
            "a query of 601 characters": ({**VALID_ARGS, "query": "q" * 601}, "q" * 601),
            "an unknown product": ({**VALID_ARGS, "product": "Nonsense-9f3"}, "Nonsense-9f3"),
            "a lowercase product": ({**VALID_ARGS, "product": "latest"}, "latest"),
            "a list as product": ({**VALID_ARGS, "product": ["Latest"]}, None),
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
                reply = handle(make_request("search", args=args))
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
            "a query of 600 characters": {"query": "q" * 600},
            "a count of 1": {"count": 1},
            "a count of 50": {"count": 50},
            "a cursor of 2000 characters": {"cursor": "c" * 2000},
            "a cursor of 1 character": {"cursor": "c"},
        }.items():
            with self.subTest(name):
                self.assertTrue(handle(search_request(**args))["ok"])


class TestMasking(SearchTest):
    def test_cookie_values_in_a_post_or_the_cursor_are_masked(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        self.answer_with(tweet_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(search_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["posts"][0]["text"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(search_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(search_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
