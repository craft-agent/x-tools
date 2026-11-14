"""What the bridge tests share: made-up cookies, requests, and the bridge run in process or as a subprocess."""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
ENGINE = TESTS.parent
FAKE = TESTS / "fake"

TOKEN = "tok-4f2a9c1d77"
CSRF = "csrf-9d31e8b6c0"
COOKIES = f"auth_token={TOKEN}; ct0={CSRF}"
# The first 16 hex characters of SHA-256 of TOKEN.
FINGERPRINT = "c56a17eeb423c117"

HARNESS = f"""
import sys
sys.path[:0] = [{str(ENGINE)!r}, {str(TESTS)!r}]
import bridge, behaviors
behaviors.install(bridge)
{{patch}}
sys.exit(bridge.main())
"""

sys.path[:0] = [str(FAKE), str(ENGINE), str(TESTS)]

import bridge  # noqa: E402
import behaviors  # noqa: E402

behaviors.install(bridge)


def make_request(op: str = behaviors.OPERATION, **override) -> dict:
    """A valid request for `op`; `override` replaces its fields."""
    return {"op": op, "cookies": COOKIES, "refused": None, "deadline": 5, "args": {}, **override}


def handle(request: object) -> dict:
    """The reply to `request`, with the bridge run in this process against the fake twscrape."""
    return bridge.handle(request)


def run_bridge(
    stdin: object, *, fake: bool = True, patch: str = "", cwd: Path | None = None
) -> subprocess.CompletedProcess:
    """Runs the bridge with the scripted operation in a subprocess; `stdin` is a request, or raw text or bytes.

    `fake` puts the fake twscrape on the subprocess's path; without it twscrape is not installed.
    `patch` is code run before `bridge.main()`.
    """
    data = stdin if isinstance(stdin, (str, bytes)) else json.dumps(stdin)
    env = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    if fake:
        env["PYTHONPATH"] = str(FAKE)
    return subprocess.run(
        [sys.executable, "-c", HARNESS.format(patch=patch)],
        input=data.encode() if isinstance(data, str) else data,
        capture_output=True,
        cwd=cwd,
        env=env,
        timeout=60,
    )


def reply_of(process: subprocess.CompletedProcess) -> dict:
    """The one reply a finished bridge wrote; fails unless it exited 0 with exactly one line."""
    assert process.returncode == 0, process.stderr.decode()
    lines = process.stdout.decode().splitlines()
    assert len(lines) == 1, process.stdout
    return json.loads(lines[0])


class BridgeTest(unittest.TestCase):
    """Asserts on replies in the contract's terms."""

    def assert_failure(self, reply: dict, kind: str, *, contacted: bool) -> None:
        self.assertEqual((reply["ok"], reply["kind"], reply["contacted"]), (False, kind, contacted), reply)
        self.assertIsInstance(reply["error"], str)
        self.assertLessEqual(len(reply["error"]), 500)

    def assert_ok(self, reply: dict, data: object, *, contacted: bool) -> None:
        self.assertEqual((reply["ok"], reply["data"], reply["contacted"]), (True, data, contacted), reply)
