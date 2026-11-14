"""What the `conversation` and `thread` tests share: made-up authors and post ids, the TweetDetail variables, and a base test."""

import json

from support import BridgeTest, handle, make_request
from timelines import page, tweet_entry
from tweets import POST_ID, make_tweet, make_user
from twscrape import api as fake_api

ADA, GRACE = make_user(), make_user("grace_reads", 4002, "Grace Reads")
POST = POST_ID
FOCAL = str(POST)
FIRST, SECOND, THIRD, FOURTH, FIFTH = (POST_ID + n for n in range(1, 6))
DETAIL_KV = {
    "focalTweetId": FOCAL,
    "with_rux_injections": True,
    "includePromotedContent": True,
    "withCommunity": True,
    "withQuickPromoteEligibilityTweetFields": True,
    "withBirdwatchNotes": True,
    "withVoice": True,
    "withV2Timeline": True,
}


def ids_of(posts: list[dict]) -> list[str]:
    return [post["id"] for post in posts]


class DetailTest(BridgeTest):
    def setUp(self):
        fake_api.TWEETS.clear()
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.TWEETS.clear)
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def tweet(self, id: int, reply_to: int | None = None, user=ADA, **fields) -> None:
        """Makes the tweet `id` known to twscrape, a reply to `reply_to` when given."""
        fake_api.TWEETS[id] = make_tweet(
            id, user=user, inReplyToTweetIdStr=None if reply_to is None else str(reply_to), **fields
        )

    def answer_with(self, *entries: dict) -> None:
        fake_api.GQL_REPLY = page(*entries)

    def answer_with_tweets(self, *ids: int, extra: tuple[dict, ...] = ()) -> None:
        """Scripts a page that lists the tweets `ids` in that order, then `extra` entries."""
        self.answer_with(*(tweet_entry(id) for id in ids), *extra)

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
                    self.assertNotIn(echoed, json.dumps(reply))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])
