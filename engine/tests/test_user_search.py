"""The `user_search` operation: one page of X's search for accounts, as the compact users and the next cursor."""

import unittest

from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import cursor_entry, user_entry
from tweets import make_user
from twscrape import AbortReqError
from twscrape import api as fake_api
from user_pages import FIRST, SECOND, THIRD, UserPageTest, user_ids

VALID_ARGS = {"query": "reading slowly", "count": 20, "cursor": None}
TWSCRAPE_404_ERROR = "Failed to get XClIdGen. See: https://github.com/vladkens/twscrape/issues/248"
REFUSED_ERROR = "X refused the search: X answers 404 to a search by an account whose phone is not verified"


def user_search_request(**args) -> dict:
    return make_request("user_search", args={**VALID_ARGS, **args})


class TestPage(UserPageTest):
    def test_a_page_is_the_users_and_the_next_cursor(self):
        self.answer_with(user_entry(FIRST), user_entry(SECOND), cursor_entry("next-page"), users=(FIRST, SECOND))
        reply = handle(user_search_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"users", "cursor"})
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["users"][0]["username"], f"user_{FIRST}")
        self.assertEqual(reply["data"]["users"][0]["created"], "2020-01-01T00:00:00+00:00")
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_a_page_is_one_request_with_the_variables_of_twscrapes_search_user(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        handle(user_search_request(query="  spaced  words ", count=7))
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [
                {
                    "op": fake_api.OP_SearchTimeline,
                    "kv": {"rawQuery": "  spaced  words ", "count": 7, "product": "People", "querySource": "typed_query"},
                    "ft": None,
                    "toggles": {"withArticleRichContentState": False},
                }
            ],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        handle(user_search_request(cursor="from-before"))
        handle(user_search_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])

    def test_users_follow_the_entries_not_their_ids(self):
        self.answer_with(user_entry(SECOND), user_entry(THIRD), user_entry(FIRST), users=(FIRST, SECOND, THIRD))
        self.assertEqual(user_ids(handle(user_search_request())), [str(SECOND), str(THIRD), str(FIRST)])

    def test_a_user_in_no_user_entry_comes_after_the_listed_ones_in_parse_order(self):
        unlisted = user_entry(THIRD, prefix="promoted")
        self.answer_with(unlisted, user_entry(SECOND), user_entry(FIRST), users=(FIRST, SECOND, THIRD))
        self.assertEqual(user_ids(handle(user_search_request())), [str(SECOND), str(FIRST), str(THIRD)])

    def test_an_entry_id_that_only_ends_in_a_user_id_is_not_a_user_entry(self):
        self.answer_with(user_entry(FIRST, prefix="who"), user_entry(SECOND), users=(FIRST, SECOND))
        self.assertEqual(user_ids(handle(user_search_request())), [str(SECOND), str(FIRST)])

    def test_a_user_twice_in_the_entries_is_listed_once(self):
        self.answer_with(user_entry(FIRST), user_entry(FIRST), users=(FIRST,))
        self.assertEqual(user_ids(handle(user_search_request())), [str(FIRST)])

    def test_count_caps_the_users(self):
        self.answer_with(
            user_entry(FIRST), user_entry(SECOND), user_entry(THIRD), cursor_entry("next"),
            users=(FIRST, SECOND, THIRD),
        )
        reply = handle(user_search_request(count=2))
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_bottom_cursor_is_the_one_returned(self):
        self.answer_with(
            cursor_entry("above", "Top"), user_entry(FIRST), cursor_entry("below", "Bottom"), users=(FIRST,)
        )
        self.assertEqual(handle(user_search_request())["data"]["cursor"], "below")

    def test_a_page_without_a_bottom_cursor_ends_the_pages(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        self.assertIsNone(handle(user_search_request())["data"]["cursor"])

    def test_a_page_without_users_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(user_search_request()), {"users": [], "cursor": None}, contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)

    def test_entries_twscrape_cannot_parse_leave_a_page_without_users(self):
        self.answer_with(user_entry(FIRST), cursor_entry("next"))
        self.assert_ok(handle(user_search_request()), {"users": [], "cursor": None}, contacted=True)


class TestFailures(UserPageTest):
    def test_no_reply_is_no_account(self):
        reply = handle(user_search_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)
        self.assertIsNotNone(reply["session"])

    def test_the_404_twscrape_retries_is_search_refused(self):
        fake_api.GQL_ERROR = AbortReqError(TWSCRAPE_404_ERROR)
        reply = handle(user_search_request())
        self.assert_failure(reply, "search_refused", contacted=True)
        self.assertEqual(reply["error"], REFUSED_ERROR)
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})
        self.assertEqual(len(fake_api.GQL_ITEMS), 1)

    def test_any_other_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(user_search_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")
        self.assertIsNotNone(reply["session"])

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(user_search_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(user_search_request()), "error", contacted=True)


class TestArguments(UserPageTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        missing = {key: value for key, value in VALID_ARGS.items() if key != "cursor"}
        invalid = {
            "no arguments": ({}, None),
            "a missing cursor": (missing, None),
            "an extra key": ({**VALID_ARGS, "limit": 5}, None),
            "a product": ({**VALID_ARGS, "product": "Latest"}, "Latest"),
            "no query": ({**VALID_ARGS, "query": None}, None),
            "a number as query": ({**VALID_ARGS, "query": 5}, None),
            "an empty query": ({**VALID_ARGS, "query": ""}, None),
            "a blank query": ({**VALID_ARGS, "query": " \t\n "}, None),
            "a query of 601 characters": ({**VALID_ARGS, "query": "q" * 601}, "q" * 601),
            "a count of 0": ({**VALID_ARGS, "count": 0}, None),
            "a count of 51": ({**VALID_ARGS, "count": 51}, None),
            "a boolean count": ({**VALID_ARGS, "count": True}, None),
            "a text count": ({**VALID_ARGS, "count": "7"}, None),
            "a decimal count": ({**VALID_ARGS, "count": 7.5}, None),
            "an empty cursor": ({**VALID_ARGS, "cursor": ""}, None),
            "a cursor of 2001 characters": ({**VALID_ARGS, "cursor": "c" * 2001}, "c" * 2001),
            "a number as cursor": ({**VALID_ARGS, "cursor": 5}, None),
        }
        self.assert_invalid_before_contact("user_search", invalid)

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        for name, args in {
            "a query of 600 characters": {"query": "q" * 600},
            "a count of 1": {"count": 1},
            "a count of 50": {"count": 50},
            "a cursor of 2000 characters": {"cursor": "c" * 2000},
            "a cursor of 1 character": {"cursor": "c"},
        }.items():
            with self.subTest(name):
                self.assertTrue(handle(user_search_request(**args))["ok"])


class TestMasking(UserPageTest):
    def test_cookie_values_in_a_user_or_the_cursor_are_masked(self):
        fake_api.PEOPLE[FIRST] = make_user(displayname=f"leaked {TOKEN} and {COOKIES}")
        self.answer_with(user_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(user_search_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["users"][0]["displayname"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(user_search_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        handle(user_search_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
