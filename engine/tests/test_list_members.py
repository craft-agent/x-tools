"""The `list_members` operation: one page of a list's members, as the compact users and the next cursor."""

import unittest

from list_pages import LIMIT_ARGS, LIST_ID, NO_LIST_BODIES, VALID_ARGS, invalid_cases
from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import Reply, cursor_entry, list_page, user_entry
from tweets import make_user
from twscrape import AbortReqError
from twscrape import api as fake_api
from user_pages import FIRST, SECOND, THIRD, UserPageTest, user_ids

KEY = "members_timeline"


def members_request(**args) -> dict:
    return make_request("list_members", args={**VALID_ARGS, **args})


class MembersTest(UserPageTest):
    def answer_with(self, *entries: dict, users: tuple[int, ...] = ()) -> None:
        super().answer_with(users=users)
        fake_api.GQL_REPLY = list_page(KEY, *entries)


class TestRequest(MembersTest):
    def test_a_page_is_one_request_with_the_variables_of_twscrapes_list_members(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        reply = handle(members_request(count=7))
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [{"op": fake_api.OP_ListMembers, "kv": {"listId": LIST_ID, "count": 7}, "ft": None, "toggles": None}],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        handle(members_request(cursor="from-before"))
        handle(members_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])


class TestPage(MembersTest):
    def test_a_page_is_the_users_and_the_next_cursor(self):
        self.answer_with(user_entry(FIRST), user_entry(SECOND), cursor_entry("next-page"), users=(FIRST, SECOND))
        reply = handle(members_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"users", "cursor"})
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_users_follow_the_entries_not_their_ids(self):
        self.answer_with(user_entry(SECOND), user_entry(THIRD), user_entry(FIRST), users=(FIRST, SECOND, THIRD))
        self.assertEqual(user_ids(handle(members_request())), [str(SECOND), str(THIRD), str(FIRST)])

    def test_count_caps_the_users(self):
        self.answer_with(
            user_entry(FIRST), user_entry(SECOND), user_entry(THIRD), cursor_entry("next"),
            users=(FIRST, SECOND, THIRD),
        )
        reply = handle(members_request(count=2))
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_bottom_cursor_is_the_one_returned(self):
        self.answer_with(
            cursor_entry("above", "Top"), user_entry(FIRST), cursor_entry("below", "Bottom"), users=(FIRST,)
        )
        self.assertEqual(handle(members_request())["data"]["cursor"], "below")

    def test_a_page_without_users_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(members_request()), {"users": [], "cursor": None}, contacted=True)

    def test_a_reply_without_the_members_timeline_is_no_such_list(self):
        bodies = {
            **NO_LIST_BODIES,
            "a list without members": {"data": {"list": {"tweets_timeline": {"timeline": {"instructions": []}}}}},
            "a list with a null timeline": {"data": {"list": {KEY: None}}},
        }
        for name, body in bodies.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                self.assert_ok(handle(members_request()), None, contacted=True)


class TestFailures(MembersTest):
    def test_no_reply_is_no_account(self):
        reply = handle(members_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(members_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(members_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(members_request()), "error", contacted=True)


class TestArguments(MembersTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        self.assert_invalid_before_contact("list_members", invalid_cases())

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        for name, args in LIMIT_ARGS.items():
            with self.subTest(name):
                self.assertTrue(handle(members_request(**args))["ok"])


class TestMasking(MembersTest):
    def test_cookie_values_in_a_user_or_the_cursor_are_masked(self):
        fake_api.PEOPLE[FIRST] = make_user(displayname=f"leaked {TOKEN} and {COOKIES}")
        self.answer_with(user_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(members_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["users"][0]["displayname"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(members_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(user_entry(FIRST), users=(FIRST,))
        handle(members_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
