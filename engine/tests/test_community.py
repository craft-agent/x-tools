"""The `community` operation: one community's details as a compact dict, or None when X gives none."""

import json
import unittest

from community_pages import COMMUNITY_ID, NO_COMMUNITY_BODIES, UNREADABLE_REPLY, id_cases
from support import COOKIES, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from timelines import Reply, community_reply
from twscrape import AbortReqError
from twscrape import api as fake_api

# The recorded reply's fields that the bridge reads, with others (`role`, banners, the creator) it leaves out.
RESULT = {
    "__typename": "Community",
    "rest_id": COMMUNITY_ID,
    "name": "New York Mets",
    "description": "Fans of the Mets.",
    "member_count": 29024,
    "join_policy": "Open",
    "primary_community_topic": {"topic_name": "Baseball"},
    "is_nsfw": False,
    "is_member": False,
    "created_at": 1646766287273,
    "role": "NonMember",
    "custom_banner_media": {"media_info": {"original_img_url": "https://pbs.example.test/banner.jpg"}},
    "creator_results": {"result": {"__typename": "User", "rest_id": "4001"}},
    "rules": [
        {"id": "r1", "name": "Keep Tweets on topic.", "rest_id": "11"},
        {"id": "r2", "name": "No Hate Speech/Slurs", "description": "Ridiculous behaviour is out.", "rest_id": "12"},
    ],
}
VIEW = {
    "id": COMMUNITY_ID,
    "name": "New York Mets",
    "description": "Fans of the Mets.",
    "rules": [
        {"name": "Keep Tweets on topic.", "description": None},
        {"name": "No Hate Speech/Slurs", "description": "Ridiculous behaviour is out."},
    ],
    "member_count": 29024,
    "join_policy": "Open",
    "topic": "Baseball",
    "nsfw": False,
    "created_at": "2022-03-08T19:04:47+00:00",
    "is_member": False,
}
MINIMAL = {"__typename": "Community", "rest_id": COMMUNITY_ID, "name": "Bare"}


def community_request(**args) -> dict:
    return make_request("community", args={"id": COMMUNITY_ID, **args})


class CommunityTest(BridgeTest):
    def setUp(self):
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def answer_with(self, result: object) -> None:
        fake_api.GQL_REPLY = community_reply(result)


class TestRequest(CommunityTest):
    def test_the_community_is_one_request_with_the_variables_and_features_of_twscrapes_community_info(self):
        self.answer_with(RESULT)
        self.assertTrue(handle(community_request())["ok"])
        features = {"c9s_list_members_action_api_enabled": False, "c9s_superc9s_indication_enabled": False}
        self.assertEqual(
            fake_api.GQL_ITEMS,
            [{"op": fake_api.OP_CommunityQuery, "kv": {"communityId": COMMUNITY_ID}, "ft": features, "toggles": None}],
        )


class TestView(CommunityTest):
    def test_every_field_is_mapped(self):
        self.answer_with(RESULT)
        reply = handle(community_request())
        self.assert_ok(reply, VIEW, contacted=True)
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_absent_optional_fields_are_none_an_empty_text_or_an_empty_list(self):
        self.answer_with(MINIMAL)
        expected = {
            "id": COMMUNITY_ID, "name": "Bare", "description": "", "rules": [], "member_count": None,
            "join_policy": None, "topic": None, "nsfw": None, "created_at": None, "is_member": None,
        }
        self.assert_ok(handle(community_request()), expected, contacted=True)

    def test_null_optional_fields_are_taken_as_absent(self):
        nulls = {key: None for key in ("description", "rules", "member_count", "primary_community_topic", "created_at")}
        self.answer_with({**MINIMAL, **nulls, "primary_community_topic": {"topic_name": None}})
        data = handle(community_request())["data"]
        self.assertEqual((data["description"], data["rules"], data["topic"]), ("", [], None))

    def test_a_result_without_a_typename_is_read_as_a_community(self):
        self.answer_with({key: value for key, value in RESULT.items() if key != "__typename"})
        self.assert_ok(handle(community_request()), VIEW, contacted=True)

    def test_a_reply_that_gives_no_community_is_none(self):
        for name, body in NO_COMMUNITY_BODIES.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                self.assert_ok(handle(community_request()), None, contacted=True)

    def test_a_reply_the_bridge_cannot_read_is_a_parse_failure_that_names_no_value(self):
        unreadable = {
            "an unknown type": UNREADABLE_REPLY,
            "no id": community_reply({**MINIMAL, "rest_id": None}),
            "a number as name": community_reply({**MINIMAL, "name": 7}),
            "no name": community_reply({"__typename": "Community", "rest_id": COMMUNITY_ID}),
            "a text member count": community_reply({**MINIMAL, "member_count": "29024"}),
            "a boolean member count": community_reply({**MINIMAL, "member_count": True}),
            "a number as nsfw": community_reply({**MINIMAL, "is_nsfw": 1}),
            "a text creation": community_reply({**MINIMAL, "created_at": "yesterday"}),
            "an enormous creation": community_reply({**MINIMAL, "created_at": 10**30}),
            "a text as rules": community_reply({**MINIMAL, "rules": "no rules"}),
            "a rule without a name": community_reply({**MINIMAL, "rules": [{"description": "x"}]}),
            "a rule that is no object": community_reply({**MINIMAL, "rules": ["x"]}),
            "a text as topic": community_reply({**MINIMAL, "primary_community_topic": "Baseball"}),
        }
        for name, body in unreadable.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = body
                reply = handle(community_request())
                self.assert_failure(reply, "parse_error", contacted=True)
                self.assertNotIn("yesterday", json.dumps(reply))


class TestFailures(CommunityTest):
    def test_no_reply_is_no_account(self):
        reply = handle(community_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(community_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(community_request()), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(community_request()), "error", contacted=True)


class TestArguments(CommunityTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in id_cases({"id": COMMUNITY_ID}).items():
            with self.subTest(name):
                reply = handle(make_request("community", args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, json.dumps(reply, ensure_ascii=False))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])


class TestMasking(CommunityTest):
    def test_cookie_values_in_a_community_are_masked(self):
        self.answer_with({**MINIMAL, "name": f"leaked {TOKEN} and {COOKIES}"})
        reply = handle(community_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["name"], "leaked [masked] and [masked]")

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(community_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])


if __name__ == "__main__":
    unittest.main()
