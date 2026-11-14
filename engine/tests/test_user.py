"""The `user` operation: one account by handle, as the compact dict the package's profile shape is built from."""

import json
import unittest
from datetime import datetime, timedelta, timezone

from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from tweets import make_link
from twscrape import AbortReqError, ApiError, NoAccountError, ParseError
from twscrape import api as fake_api
from twscrape.models import User

CREATED_AT = datetime(2013, 5, 4, 9, 15, 30, tzinfo=timezone.utc)

USER_REPLY = {
    "id": "4001",
    "username": "ada_writes",
    "displayname": "Ada Writes",
    "description": "Notes on reading slowly.",
    "location": "Lisbon",
    "created": "2013-05-04T09:15:30+00:00",
    "followers": 1200,
    "following": 85,
    "posts": 3400,
    "media": 210,
    "likes": 9000,
    "listed": 14,
    "protected": False,
    "verified": False,
    "blue": True,
    "blue_type": "Business",
    "links": ["https://example.test/ada", "https://example.test/notes"],
    "avatar": "https://pbs.example.test/profile/ada.jpg",
    "banner": "https://pbs.example.test/banner/ada.jpg",
    "pinned": ["1700000000000000009", "1700000000000000008"],
}


def make_account(**fields) -> User:
    """A user with every field the reply shows set; `fields` replace any of them."""
    defaults = {
        "id": 4001,
        "id_str": "4001",
        "username": "ada_writes",
        "displayname": "Ada Writes",
        "rawDescription": "Notes on reading slowly.",
        "created": CREATED_AT,
        "followersCount": 1200,
        "friendsCount": 85,
        "statusesCount": 3400,
        "favouritesCount": 9000,
        "listedCount": 14,
        "mediaCount": 210,
        "location": "Lisbon",
        "profileImageUrl": "https://pbs.example.test/profile/ada.jpg",
        "profileBannerUrl": "https://pbs.example.test/banner/ada.jpg",
        "protected": False,
        "verified": False,
        "blue": True,
        "blueType": "Business",
        "descriptionLinks": [make_link("https://example.test/ada"), make_link("https://example.test/notes")],
        "pinnedIds": [1700000000000000009, 1700000000000000008],
    }
    return User(**{**defaults, **fields})


def user_request(account: object = "ada_writes", **override) -> dict:
    return make_request("user", args={"handle": account}, **override)


class UserTest(BridgeTest):
    def setUp(self):
        fake_api.USERS.clear()
        fake_api.USER_LOGINS.clear()
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.USERS.clear)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def read(self, account: User) -> dict:
        fake_api.USERS[account.username] = account
        reply = handle(user_request(account.username))
        self.assertTrue(reply["ok"], reply)
        return reply["data"]


class TestUser(UserTest):
    def test_an_account_is_the_compact_dict(self):
        fake_api.USERS["ada_writes"] = make_account()
        reply = handle(user_request())
        self.assert_ok(reply, USER_REPLY, contacted=True)
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})
        self.assertEqual(fake_api.USER_LOGINS, ["ada_writes"])

    def test_an_account_X_does_not_show_is_null_data(self):
        reply = handle(user_request("suspended_9"))
        self.assert_ok(reply, None, contacted=True)
        self.assertEqual(fake_api.USER_LOGINS, ["suspended_9"])

    def test_the_creation_date_is_iso_8601_in_utc_whatever_zone_twscrape_gave(self):
        zoned = CREATED_AT.astimezone(timezone(timedelta(hours=9)))
        self.assertEqual(self.read(make_account(created=zoned))["created"], "2013-05-04T09:15:30+00:00")
        naive = datetime(2013, 5, 4, 9, 15, 30)
        self.assertEqual(self.read(make_account(created=naive))["created"], "2013-05-04T09:15:30+00:00")

    def test_links_are_the_expanded_urls(self):
        links = [make_link("https://example.test/a"), make_link("https://example.test/b")]
        expanded = ["https://example.test/a", "https://example.test/b"]
        self.assertEqual(self.read(make_account(descriptionLinks=links))["links"], expanded)
        self.assertEqual(self.read(make_account(descriptionLinks=[]))["links"], [])

    def test_pinned_ids_are_text_so_a_large_id_keeps_every_digit(self):
        data = self.read(make_account(pinnedIds=[1700000000000000009]))
        self.assertEqual(data["pinned"], ["1700000000000000009"])
        self.assertEqual(self.read(make_account(pinnedIds=[]))["pinned"], [])

    def test_the_flags_and_the_banner_twscrape_does_not_know_are_null(self):
        data = self.read(
            make_account(protected=None, verified=None, blue=None, blueType=None, profileBannerUrl=None)
        )
        for key in ("protected", "verified", "blue", "blue_type", "banner"):
            self.assertIsNone(data[key], key)

    def test_the_id_is_text(self):
        data = self.read(make_account(id=1700000000000000001, id_str="1700000000000000001"))
        self.assertEqual(data["id"], "1700000000000000001")


class TestFailures(UserTest):
    def test_no_account_to_ask_with_is_no_account(self):
        fake_api.GQL_ERROR = NoAccountError("No account available for queue UserByScreenName")
        reply = handle(user_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_answer_of_X_with_an_error_is_an_x_error(self):
        for error in (AbortReqError("Blocked by Cloudflare: 403"), ApiError("rate limit")):
            with self.subTest(type(error).__name__):
                fake_api.GQL_ERROR = error
                reply = handle(user_request())
                self.assert_failure(reply, "x_error", contacted=True)
                self.assertEqual(reply["error"], f"{type(error).__name__}: {error}")

    def test_the_other_failures_keep_their_kinds(self):
        for error, kind in (
            (ParseError("odd user"), "parse_error"),
            (TimeoutError(), "timeout"),
            (ValueError("boom"), "error"),
        ):
            with self.subTest(kind):
                fake_api.GQL_ERROR = error
                self.assert_failure(handle(user_request()), kind, contacted=True)


class TestArguments(UserTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        invalid = {
            "no arguments": ({}, None),
            "an extra key": ({"handle": "ada_writes", "id": "1"}, None),
            "a number": ({"handle": 5}, None),
            "a list": ({"handle": ["ada_writes"]}, None),
            "null": ({"handle": None}, None),
            "empty": ({"handle": ""}, None),
            "16 characters": ({"handle": "a" * 16}, "a" * 16),
            "an at sign": ({"handle": "@ada_writes"}, "@ada_writes"),
            "a space": ({"handle": "ada writes"}, "ada writes"),
            "a newline": ({"handle": "ada\n"}, None),
            "a path": ({"handle": "../ada"}, "../ada"),
            "a dot": ({"handle": "ada.writes"}, "ada.writes"),
            "another script's letters": ({"handle": "ädä"}, "ädä"),
            "another script's digits": ({"handle": "١٢٣"}, "١٢٣"),
        }
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in invalid.items():
            with self.subTest(name):
                reply = handle(make_request("user", args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["fingerprint"])
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, json.dumps(reply))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.USER_LOGINS, [])

    def test_handles_of_1_to_15_letters_digits_and_underscores_are_taken(self):
        for name in ("a", "_", "7", "A_b9" * 3 + "xyz"):
            with self.subTest(name):
                self.assert_ok(handle(user_request(name)), None, contacted=True)
        self.assertEqual(fake_api.USER_LOGINS, ["a", "_", "7", "A_b9" * 3 + "xyz"])


class TestMasking(UserTest):
    def test_a_cookie_value_in_the_account_is_masked(self):
        account = make_account(
            displayname=f"Ada {TOKEN}",
            rawDescription=f"leaked {COOKIES}",
            location=CSRF,
            descriptionLinks=[make_link(f"https://example.test/?t={TOKEN}")],
        )
        data = self.read(account)
        self.assertEqual(leaked(data), [])
        self.assertEqual(data["displayname"], "Ada [masked]")
        self.assertEqual(data["description"], "leaked [masked]")
        self.assertEqual(data["links"], ["https://example.test/?t=[masked]"])

    def test_cookie_values_in_an_error_are_masked(self):
        fake_api.GQL_ERROR = AbortReqError(f"X said no to {COOKIES}")
        reply = handle(user_request())
        self.assertEqual(leaked(reply), [])
        self.assertIn("[masked]", reply["error"])

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        handle(user_request())
        self.assertEqual(leaked(fake_api.USER_LOGINS), [])


if __name__ == "__main__":
    unittest.main()
