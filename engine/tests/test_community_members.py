"""The `community_members` operation: one page of a community's members, as the compact users and the next cursor."""

import unittest

from community_pages import COMMUNITY_ID, LIMIT_ARGS, MEMBERS_ARGS, NO_COMMUNITY_BODIES, UNREADABLE_REPLY, page_cases
from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import Reply, community_reply, members_slice_page
from tweets import make_user
from twscrape import AbortReqError
from twscrape import api as fake_api
from user_pages import FIRST, SECOND, THIRD, UserPageTest, user_ids


def members_request(**args) -> dict:
    return make_request("community_members", args={**MEMBERS_ARGS, **args})


class MembersTest(UserPageTest):
    def answer_with(self, *ids: int, next_cursor: object = None, users: tuple[int, ...] | None = None) -> None:
        """Scripts the page X answers with; `users` (by default `ids`) are the ids twscrape can parse."""
        super().answer_with(users=ids if users is None else users)
        fake_api.GQL_REPLY = members_slice_page(*ids, next_cursor=next_cursor)


class TestRequest(MembersTest):
    def test_a_page_is_one_request_with_the_variables_of_twscrapes_community_members(self):
        self.answer_with(FIRST)
        self.assertTrue(handle(members_request(count=7))["ok"])
        kv = {"communityId": COMMUNITY_ID, "count": 7, "includePromotedContent": False}
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [{"op": fake_api.OP_membersSliceTimeline_Query, "kv": kv, "ft": None, "toggles": None}],
        )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(FIRST)
        handle(members_request(cursor="from-before"))
        handle(members_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])


class TestPage(MembersTest):
    def test_a_page_is_the_users_and_the_next_cursor(self):
        self.answer_with(FIRST, SECOND, next_cursor="next-page")
        reply = handle(members_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"users", "cursor"})
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_users_follow_the_items_not_their_ids(self):
        self.answer_with(SECOND, THIRD, FIRST)
        self.assertEqual(user_ids(handle(members_request())), [str(SECOND), str(THIRD), str(FIRST)])

    def test_a_user_outside_the_slice_or_that_twscrape_cannot_parse_is_left_out(self):
        self.answer_with(SECOND, FIRST, users=(FIRST, THIRD))
        fake_api.GQL_REPLY.body["data"]["communityResults"]["result"]["creator_results"] = {
            "result": {"__typename": "User", "rest_id": str(THIRD)}
        }
        self.assertEqual(user_ids(handle(members_request())), [str(FIRST)])

    def test_count_caps_the_users(self):
        self.answer_with(FIRST, SECOND, THIRD, next_cursor="next")
        reply = handle(members_request(count=2))
        self.assertEqual(user_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_cursor_is_none_unless_it_is_text(self):
        for cursor in (None, 7, {"value": "x"}):
            with self.subTest(cursor):
                self.answer_with(FIRST, next_cursor=cursor)
                self.assertIsNone(handle(members_request())["data"]["cursor"])

    def test_a_page_without_users_has_no_cursor_though_X_gave_one(self):
        self.answer_with(next_cursor="past-the-end")
        self.assert_ok(handle(members_request()), {"users": [], "cursor": None}, contacted=True)
        self.answer_with(FIRST, next_cursor="past-the-end", users=())
        self.assert_ok(handle(members_request()), {"users": [], "cursor": None}, contacted=True)

    def test_a_reply_without_the_members_slice_is_no_such_community(self):
        bodies = {
            **NO_COMMUNITY_BODIES,
            "a community without a slice": community_reply({"__typename": "Community", "rest_id": "1"}).body,
            "a community with a null slice": community_reply({"members_slice": None}).body,
            "a community with a text slice": community_reply({"members_slice": "none"}).body,
        }
        for name, body in bodies.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                self.assert_ok(handle(members_request()), None, contacted=True)

    def test_a_result_of_another_type_is_a_parse_failure(self):
        fake_api.GQL_REPLY = UNREADABLE_REPLY
        self.assert_failure(handle(members_request()), "parse_error", contacted=True)


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
        self.assert_invalid_before_contact("community_members", page_cases(MEMBERS_ARGS))

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(FIRST)
        for name, args in LIMIT_ARGS.items():
            with self.subTest(name):
                self.assertTrue(handle(members_request(**args))["ok"])


class TestMasking(MembersTest):
    def test_cookie_values_in_a_user_or_the_cursor_are_masked(self):
        fake_api.PEOPLE[FIRST] = make_user(displayname=f"leaked {TOKEN} and {COOKIES}")
        fake_api.GQL_REPLY = members_slice_page(FIRST, next_cursor=f"cursor-{CSRF}")
        reply = handle(members_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["users"][0]["displayname"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(FIRST)
        handle(members_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
