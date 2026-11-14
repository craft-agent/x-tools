"""The bridge as a process: one request on standard input, one line on standard output, exit 0 when a reply was written."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

from support import ENGINE, FAKE, BridgeTest, bridge, make_request, reply_of, run_bridge

COMMON_FIELDS = {"ok", "fingerprint", "contacted", "session", "warnings"}


class TestProcess(BridgeTest):
    def test_a_success_is_one_line_and_exit_zero(self):
        process = run_bridge(make_request(args={"return": {"a": 1}}))
        self.assertEqual(process.returncode, 0)
        self.assertTrue(process.stdout.endswith(b"\n"))
        self.assertEqual(len(process.stdout.splitlines()), 1)
        self.assertEqual(process.stderr, b"")
        self.assertEqual(set(reply_of(process)), COMMON_FIELDS | {"data"})

    def test_a_failure_is_one_line_and_exit_zero_too(self):
        reply = reply_of(run_bridge(make_request(args={"raise": "ApiError"})))
        self.assertEqual(set(reply), COMMON_FIELDS | {"kind", "error"})

    def test_data_that_json_cannot_hold_is_written_as_text(self):
        patch = (
            "import datetime\n"
            "async def when(api, args):\n"
            "    return {'at': datetime.datetime(2026, 1, 2, 3, 4, 5)}\n"
            "bridge.OPERATIONS['when'] = when"
        )
        reply = reply_of(run_bridge(make_request("when"), patch=patch))
        self.assert_ok(reply, {"at": "2026-01-02 03:04:05"}, contacted=True)

    def test_non_ascii_data_survives(self):
        reply = reply_of(run_bridge(make_request(args={"return": "日本語 ✓"})))
        self.assertEqual(reply["data"], "日本語 ✓")

    def test_check_through_bridge_py_itself(self):
        """The file the engine call runs, with no harness around it."""
        with tempfile.TemporaryDirectory() as work:
            process = subprocess.run(
                [sys.executable, "-B", str(ENGINE / "bridge.py")],
                input=json.dumps(make_request("check")).encode(),
                capture_output=True,
                cwd=work,
                env={**os.environ, "PYTHONPATH": str(FAKE)},
                timeout=60,
            )
        self.assert_ok(reply_of(process), {"twscrape_version": "0.21.0"}, contacted=False)

    def test_a_crash_before_a_reply_exits_non_zero_with_a_short_message(self):
        patch = "bridge.handle = lambda request: 1 / 0"
        process = run_bridge(make_request(), patch=patch)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(process.stdout, b"")
        self.assertIn(b"ZeroDivisionError", process.stderr)
        self.assertLess(len(process.stderr), 400)

    def test_a_line_that_masking_broke_is_replaced_by_a_plain_failure(self):
        """A cookie value of `"` turns every quote of the line into a mask, which is no longer JSON."""
        reply = bridge.handle(make_request(cookies='auth_token="; ct0=cc', args={"return": 1}))
        line = bridge.render(reply)
        self.assert_failure(json.loads(line), "error", contacted=True)
        self.assertEqual(json.loads(line)["fingerprint"], reply["fingerprint"])


if __name__ == "__main__":
    unittest.main()
