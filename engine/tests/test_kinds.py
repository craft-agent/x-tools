"""Every row of the contract's table of failure kinds, and the success reply, with its `contacted`."""

import math
import unittest

from support import COOKIES, CSRF, FINGERPRINT, TOKEN, BridgeTest, handle, make_request, reply_of, run_bridge

INVALID_REQUESTS = {
    "a list": [],
    "null": None,
    "a string": "check",
    "no op": {"cookies": COOKIES, "deadline": 5},
    "a number as op": make_request(op=1),
    "an unknown op": make_request(op="unregistered"),
    "args as a list": make_request(args=[]),
    "args as null": make_request(args=None),
    "no deadline": {"op": "check", "cookies": COOKIES, "refused": None, "args": {}},
    "a zero deadline": make_request(deadline=0),
    "a negative deadline": make_request(deadline=-1),
    "a string deadline": make_request(deadline="5"),
    "a boolean deadline": make_request(deadline=True),
    "a NaN deadline": make_request(deadline=math.nan),
    "an infinite deadline": make_request(deadline=math.inf),
    "a number as refused": make_request(refused=7),
}

UNUSABLE_COOKIES = {
    "none": None,
    "a number": 5,
    "an empty string": "",
    "no pairs": "garbage",
    "no ct0": f"auth_token={TOKEN}",
    "no auth_token": f"ct0={CSRF}",
    "an empty ct0": f"auth_token={TOKEN}; ct0=",
    "an empty quoted auth_token": f'auth_token=""; ct0={CSRF}',
}


class TestInvalidRequests(BridgeTest):
    def test_each_is_invalid_without_contact(self):
        for name, request in INVALID_REQUESTS.items():
            with self.subTest(name):
                reply = handle(request)
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["fingerprint"])
                self.assertIsNone(reply["session"])

    def test_text_that_is_not_json_is_invalid(self):
        for raw in ("", "not json", "{", b"\xff\xfe\x00bad"):
            with self.subTest(raw=raw):
                self.assert_failure(reply_of(run_bridge(raw)), "invalid_request", contacted=False)


class TestSetup(BridgeTest):
    def test_unusable_cookies_are_setup(self):
        for name, cookies in UNUSABLE_COOKIES.items():
            with self.subTest(name):
                reply = handle(make_request(cookies=cookies))
                self.assert_failure(reply, "setup", contacted=False)
                self.assertIsNone(reply["fingerprint"])

    def test_check_needs_usable_cookies_too(self):
        self.assert_failure(handle(make_request("check", cookies="garbage")), "setup", contacted=False)

    def test_quoted_values_are_read_as_the_engine_call_reads_them(self):
        reply = handle(make_request(cookies=f'auth_token="{TOKEN}"; ct0="{CSRF}"', args={"return": 1}))
        self.assert_ok(reply, 1, contacted=True)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)


class TestRefused(BridgeTest):
    def test_a_refused_session_is_not_contacted(self):
        reply = handle(make_request(refused=FINGERPRINT))
        self.assert_failure(reply, "refused", contacted=False)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)
        self.assertIsNone(reply["session"])

    def test_another_fingerprint_is_not_a_refusal(self):
        reply = handle(make_request(refused="0" * 16, args={"return": 1}))
        self.assert_ok(reply, 1, contacted=True)


class TestOperations(BridgeTest):
    def test_success_returns_data_and_the_session(self):
        reply = handle(make_request(args={"return": {"id": 1, "items": ["a", None]}}))
        self.assert_ok(reply, {"id": 1, "items": ["a", None]}, contacted=True)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})
        self.assertEqual(reply["warnings"], [])

    def test_no_account_when_twscrape_has_none_usable(self):
        for name, args in {
            "inactive": {"inactive": "suspended"},
            "locked": {"locks": {"UserTweets": 600}},
        }.items():
            with self.subTest(name):
                reply = handle(make_request(args={**args, "raise": "NoAccountError", "message": "No account"}))
                self.assert_failure(reply, "no_account", contacted=True)
                self.assertIsNotNone(reply["session"])

    def test_timeout_when_the_operation_outlives_the_deadline(self):
        reply = handle(make_request(deadline=0.2, args={"sleep": 5}))
        self.assert_failure(reply, "timeout", contacted=True)
        self.assertEqual(reply["session"]["active"], True)

    def test_x_errors(self):
        for name in ("AbortReqError", "ApiError", "GqlFeaturesOutdatedError", "XClIdParseError"):
            with self.subTest(name):
                reply = handle(make_request(args={"raise": name, "message": "X said no"}))
                self.assert_failure(reply, "x_error", contacted=True)
                self.assertEqual(reply["error"], f"{name}: X said no")
                self.assertIsNotNone(reply["session"])

    def test_parse_errors(self):
        for name in ("ParseError", "UserParseError"):
            with self.subTest(name):
                self.assert_failure(handle(make_request(args={"raise": name})), "parse_error", contacted=True)

    def test_anything_else_is_error(self):
        for name in ("ValueError", "KeyError", "RuntimeError"):
            with self.subTest(name):
                self.assert_failure(handle(make_request(args={"raise": name})), "error", contacted=True)


class TestWithoutTwscrape(BridgeTest):
    def test_an_operation_cannot_run_and_contacted_nothing(self):
        reply = reply_of(run_bridge(make_request(), fake=False))
        self.assert_failure(reply, "error", contacted=False)
        self.assertIn("twscrape", reply["error"])


if __name__ == "__main__":
    unittest.main()
