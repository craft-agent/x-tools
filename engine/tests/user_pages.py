"""What the `user_search`, `follows` and `reposters` tests share: made-up user ids and a base test for user pages."""

import json

from support import BridgeTest, handle, make_request
from timelines import page
from tweets import make_user
from twscrape import api as fake_api

FIRST, SECOND, THIRD = 4001, 4002, 4003


def user_ids(reply: dict) -> list[str]:
    """The user ids in a paged users reply, in order."""
    return [user["id"] for user in reply["data"]["users"]]


class UserPageTest(BridgeTest):
    """A test case whose operation returns one page of users from `_gql_item`."""

    def setUp(self):
        fake_api.PEOPLE.clear()
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.PEOPLE.clear)
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def answer_with(self, *entries: dict, users: tuple[int, ...] = ()) -> None:
        """Scripts the page X answers with; `users` are the ids twscrape can parse."""
        for id in users:
            fake_api.PEOPLE[id] = make_user(username=f"user_{id}", id=id, displayname=f"User {id}")
        fake_api.GQL_REPLY = page(*entries)

    def assert_invalid_before_contact(self, op: str, invalid: dict[str, tuple[dict, str | None]]) -> None:
        """Checks that every case in `invalid` fails as `invalid_request` without constructing a pool or calling X."""
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in invalid.items():
            with self.subTest(name):
                reply = handle(make_request(op, args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["fingerprint"])
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, json.dumps(reply, ensure_ascii=False))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])
