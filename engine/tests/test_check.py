"""The `check` operation and the short-circuits before the pool: they build no pool and need no twscrape."""

import unittest

from support import FINGERPRINT, BridgeTest, handle, make_request, reply_of, run_bridge
from twscrape import api as fake_api


class TestCheck(BridgeTest):
    def test_check_answers_ok_with_the_fingerprint_and_contacts_nothing(self):
        reply = handle(make_request("check"))
        self.assert_ok(reply, {"twscrape_version": "0.21.0"}, contacted=False)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)
        self.assertIsNone(reply["session"])
        self.assertEqual(reply["warnings"], [])

    def test_check_answers_ok_even_when_refused_equals_its_fingerprint(self):
        reply = handle(make_request("check", refused=FINGERPRINT))
        self.assert_ok(reply, {"twscrape_version": "0.21.0"}, contacted=False)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)

    def test_check_builds_no_pool(self):
        before = len(fake_api.CONSTRUCTED)
        handle(make_request("check"))
        handle(make_request("check", refused=FINGERPRINT))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)

    def test_a_refused_session_builds_no_pool(self):
        before = len(fake_api.CONSTRUCTED)
        self.assertEqual(handle(make_request(refused=FINGERPRINT))["kind"], "refused")
        self.assertEqual(len(fake_api.CONSTRUCTED), before)

    def test_a_pool_is_built_once_for_an_operation_with_the_one_session(self):
        before = len(fake_api.CONSTRUCTED)
        handle(make_request(args={"return": 1}))
        built = fake_api.CONSTRUCTED[before:]
        self.assertEqual(len(built), 1)
        self.assertTrue(built[0]["raise_when_no_account"])
        self.assertTrue(built[0]["pool"].startswith("file:x-tools-pool-"))
        self.assertIn("mode=memory", built[0]["pool"])


class TestWithoutTwscrape(BridgeTest):
    def test_check_without_twscrape_installed_is_an_error_that_contacted_nothing(self):
        reply = reply_of(run_bridge(make_request("check"), fake=False))
        self.assert_failure(reply, "error", contacted=False)
        self.assertEqual(reply["fingerprint"], FINGERPRINT)

    def test_refusal_needs_no_twscrape(self):
        reply = reply_of(run_bridge(make_request(refused=FINGERPRINT), fake=False))
        self.assert_failure(reply, "refused", contacted=False)

    def test_check_through_the_subprocess_reports_the_version(self):
        reply = reply_of(run_bridge(make_request("check")))
        self.assert_ok(reply, {"twscrape_version": "0.21.0"}, contacted=False)


if __name__ == "__main__":
    unittest.main()
