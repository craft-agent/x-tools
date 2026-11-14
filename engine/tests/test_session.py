"""What the reply says of the session and of twscrape's warnings, and that nothing of the session reaches the disk."""

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from support import BridgeTest, handle, make_request, reply_of, run_bridge


def names_in(directory: Path) -> list[str]:
    return [entry.name for entry in directory.iterdir()]


class TestWarnings(BridgeTest):
    def test_at_most_ten_warnings_each_clipped_to_300(self):
        lines = [f"{index} " + "w" * 400 for index in range(15)]
        reply = handle(make_request(args={"warn": lines}))
        self.assertEqual(len(reply["warnings"]), 10)
        self.assertEqual([line[:2] for line in reply["warnings"]], [f"{index} " for index in range(10)])
        self.assertTrue(all(len(line) == 300 for line in reply["warnings"]))

    def test_warnings_reach_failures_too(self):
        reply = handle(make_request(args={"warn": ["rate limited"], "raise": "ApiError"}))
        self.assertEqual(reply["warnings"], ["rate limited"])

    def test_the_stderr_sink_is_replaced(self):
        process = run_bridge(make_request(args={"warn": ["a warning"]}))
        self.assertEqual(reply_of(process)["warnings"], ["a warning"])
        self.assertEqual(process.stderr, b"")

    def test_a_run_does_not_carry_the_warnings_of_the_last(self):
        handle(make_request(args={"warn": ["first"]}))
        self.assertEqual(handle(make_request(args={"return": 1}))["warnings"], [])

    def test_the_error_is_clipped_to_500(self):
        reply = handle(make_request(args={"raise": "ValueError", "message": "e" * 900}))
        self.assertEqual(len(reply["error"]), 500)


class TestSession(BridgeTest):
    def test_an_inactive_session_reports_its_error_clipped_to_200(self):
        reply = handle(make_request(args={"inactive": "x" * 400}))
        self.assertEqual(reply["session"], {"active": False, "error": "x" * 200, "locks": {}})

    def test_locks_are_reported_only_while_in_the_future_with_an_offset(self):
        reply = handle(make_request(args={"locks": {"UserTweets": 600, "SearchTimeline": -600}}))
        locks = reply["session"]["locks"]
        self.assertEqual(list(locks), ["UserTweets"])
        until = datetime.fromisoformat(locks["UserTweets"])
        self.assertEqual(until.utcoffset(), timedelta(0))
        self.assertTrue(locks["UserTweets"].endswith("+00:00"))
        self.assertGreater(until.timestamp(), datetime.now().timestamp() + 500)

    def test_the_session_is_reported_after_a_failure(self):
        reply = handle(make_request(args={"locks": {"UserTweets": 600}, "raise": "NoAccountError"}))
        self.assertEqual(list(reply["session"]["locks"]), ["UserTweets"])
        self.assertTrue(reply["session"]["active"])

    def test_the_session_is_reported_after_a_timeout(self):
        reply = handle(make_request(deadline=0.2, args={"inactive": "gone", "sleep": 5}))
        self.assertEqual(reply["kind"], "timeout")
        self.assertEqual(reply["session"]["error"], "gone")

    def test_a_run_does_not_see_the_session_of_the_last(self):
        handle(make_request(args={"inactive": "gone"}))
        self.assertEqual(handle(make_request(args={"return": 1}))["session"]["active"], True)


class TestNothingOnDisk(BridgeTest):
    def test_the_pool_creates_no_file_in_the_working_directory_or_the_temp_dir(self):
        with tempfile.TemporaryDirectory() as work:
            temp = Path(tempfile.gettempdir())
            before = set(names_in(temp))
            process = run_bridge(make_request(args={"inactive": "x", "locks": {"Q": 60}}), cwd=Path(work))
            self.assertEqual(reply_of(process)["session"]["active"], False)
            self.assertEqual(names_in(Path(work)), [])
            self.assertEqual([name for name in set(names_in(temp)) - before if "x-tools" in name], [])

    def test_the_connect_function_is_restored_after_a_run(self):
        from twscrape import db

        connect = db.aiosqlite.connect
        handle(make_request(args={"return": 1}))
        self.assertIs(db.aiosqlite.connect, connect)


if __name__ == "__main__":
    unittest.main()
