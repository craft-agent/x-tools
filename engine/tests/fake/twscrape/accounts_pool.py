"""The fake account pool: twscrape's cookie account, kept in a real SQLite database the way twscrape keeps it."""

import contextlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import db


class NoAccountError(Exception):
    """No account is usable."""


@dataclass
class Account:
    username: str
    active: bool
    cookies: dict[str, str] = field(default_factory=dict)
    locks: dict[str, datetime] = field(default_factory=dict)
    error_msg: str | None = None


class AccountsPool:
    """Opens a connection for every call through `db.aiosqlite.connect`, so the database must be shared."""

    def __init__(self, db_file="accounts.db", raise_when_no_account=False, wait_timeout=None, wait_interval=5.0):
        self._db_file = db_file

    @contextlib.contextmanager
    def _connection(self):
        with contextlib.closing(db.aiosqlite.connect(self._db_file)) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, cookies TEXT, active BOOLEAN, "
                "locks TEXT DEFAULT '{}', error_msg TEXT)"
            )
            yield connection
            connection.commit()

    async def add_account_cookies(self, username: str, cookies: str):
        parsed = dict(part.strip().split("=", 1) for part in cookies.split(";") if "=" in part)
        if not parsed.get("auth_token") or not parsed.get("ct0"):
            raise ValueError("Cookies must include auth_token and ct0")
        with self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO accounts (username, cookies, active, locks, error_msg) "
                "VALUES (?, ?, true, '{}', NULL)",
                (username, json.dumps(parsed)),
            )

    async def get_all(self) -> list[Account]:
        with self._connection() as connection:
            rows = connection.execute("SELECT username, cookies, active, locks, error_msg FROM accounts").fetchall()
        return [
            Account(
                username,
                bool(active),
                json.loads(cookies),
                {queue: datetime.fromisoformat(until).replace(tzinfo=timezone.utc)
                 for queue, until in json.loads(locks).items()},
                error_msg,
            )
            for username, cookies, active, locks, error_msg in rows
        ]

    async def mark_inactive(self, username: str, error_msg: str | None):
        with self._connection() as connection:
            connection.execute(
                "UPDATE accounts SET active = false, error_msg = ? WHERE username = ?", (error_msg, username)
            )

    async def lock_until(self, username: str, queue: str, unlock_at: int, req_count=0):
        until = datetime.fromtimestamp(unlock_at, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        with self._connection() as connection:
            row = connection.execute("SELECT locks FROM accounts WHERE username = ?", (username,)).fetchone()
            locks = {**json.loads(row[0]), queue: until}
            connection.execute("UPDATE accounts SET locks = ? WHERE username = ?", (json.dumps(locks), username))
