"""The secrets never leave: the cookie string, the auth_token value and the ct0 value, in every part of a reply."""

import json
import unittest

from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request, reply_of, run_bridge

FORMS = {"the cookie string": COOKIES, "the auth_token value": TOKEN, "the ct0 value": CSRF}
MASK = "[masked]"


def leaked(reply: object) -> list[str]:
    """The secrets found in the reply's JSON, as written and as escaped."""
    text = json.dumps(reply) + json.dumps(reply, ensure_ascii=False)
    return [secret for secret in (COOKIES, TOKEN, CSRF) if secret in text]


class TestMasking(BridgeTest):
    def test_data_is_masked(self):
        data = {"nested": [{name: f"before {form} after" for name, form in FORMS.items()}], TOKEN: 1}
        reply = handle(make_request(args={"return": data}))
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["nested"][0]["the ct0 value"], f"before {MASK} after")
        self.assertEqual(reply["data"]["nested"][0]["the cookie string"], f"before {MASK} after")

    def test_errors_are_masked(self):
        for name, form in FORMS.items():
            for exception in ("ApiError", "ParseError", "ValueError"):
                with self.subTest(form=name, exception=exception):
                    reply = handle(make_request(args={"raise": exception, "message": f"failed with {form}"}))
                    self.assertEqual(leaked(reply), [])
                    self.assertIn(MASK, reply["error"])

    def test_warnings_are_masked(self):
        reply = handle(make_request(args={"warn": [f"warned about {form}" for form in FORMS.values()]}))
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["warnings"], [f"warned about {MASK}"] * 3)

    def test_the_session_error_is_masked(self):
        for name, form in FORMS.items():
            with self.subTest(name):
                reply = handle(make_request(args={"inactive": f"refused {form}"}))
                self.assertEqual(leaked(reply), [])
                self.assertEqual(reply["session"]["error"], f"refused {MASK}")

    def test_the_longest_is_masked_first(self):
        reply = handle(make_request(args={"return": f"{COOKIES}|{TOKEN}|{CSRF}"}))
        self.assertEqual(reply["data"], f"{MASK}|{MASK}|{MASK}")

    def test_the_cookies_are_masked_in_an_invalid_request_too(self):
        reply = handle(make_request(op=COOKIES))
        self.assert_failure(reply, "invalid_request", contacted=False)
        self.assertEqual(leaked(reply), [])

    def test_unusable_cookies_are_masked_in_a_setup_error(self):
        reply = handle(make_request(cookies=f"auth_token={TOKEN}"))
        self.assert_failure(reply, "setup", contacted=False)
        self.assertEqual(leaked(reply), [])

    def test_the_line_on_standard_output_is_masked(self):
        process = run_bridge(make_request(args={"return": list(FORMS.values()), "warn": [COOKIES]}))
        for secret in (COOKIES, TOKEN, CSRF):
            self.assertNotIn(secret.encode(), process.stdout)
            self.assertNotIn(secret.encode(), process.stderr)
        self.assertEqual(reply_of(process)["data"], [MASK] * 3)

    def test_a_crash_is_masked_on_standard_error(self):
        patch = f"bridge.render = lambda reply: (_ for _ in ()).throw(RuntimeError({COOKIES!r}))"
        process = run_bridge(make_request(), patch=patch)
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(process.stdout, b"")
        self.assertIn(MASK.encode(), process.stderr)
        for secret in (COOKIES, TOKEN, CSRF):
            self.assertNotIn(secret.encode(), process.stderr)


if __name__ == "__main__":
    unittest.main()
