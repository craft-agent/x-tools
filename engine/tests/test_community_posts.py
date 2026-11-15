"""The `community_posts` operation: one page of a community's posts, as the compact posts and the next cursor."""

import unittest

from community_pages import COMMUNITY_ID, LIMIT_ARGS, NO_COMMUNITY_BODIES, POSTS_ARGS, UNREADABLE_REPLY, posts_cases
from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from test_masking import leaked
from timelines import Reply, community_reply, community_timeline_page, cursor_entry, tweet_entry
from tweets import POST_ID, make_tweet
from twscrape import AbortReqError
from twscrape import api as fake_api

FIRST, SECOND, THIRD = POST_ID, POST_ID + 1, POST_ID + 2
VARIABLES = {
    "displayLocation": "Community",
    "withCommunity": True,
    "includePromotedContent": False,
    "withQuickPromoteEligibilityTweetFields": True,
    "withVoice": True,
    "withV2Timeline": True,
}


def posts_request(**args) -> dict:
    return make_request("community_posts", args={**POSTS_ARGS, **args})


def post_ids(reply: dict) -> list[str]:
    return [post["id"] for post in reply["data"]["posts"]]


class CommunityPostsTest(BridgeTest):
    def setUp(self):
        fake_api.TWEETS.clear()
        fake_api.GQL_ITEMS.clear()
        fake_api.GQL_REPLY = None
        fake_api.GQL_ERROR = None
        self.addCleanup(fake_api.TWEETS.clear)
        self.addCleanup(setattr, fake_api, "GQL_REPLY", None)
        self.addCleanup(setattr, fake_api, "GQL_ERROR", None)

    def answer_with(self, *entries: dict, tweets: tuple[int, ...] = (), key: str = "ranked_community_timeline") -> None:
        """Scripts the page X answers with; `tweets` are the ids twscrape can parse."""
        for id in tweets:
            fake_api.TWEETS[id] = make_tweet(id)
        fake_api.GQL_REPLY = community_timeline_page(*entries, key=key)


class TestRequest(CommunityPostsTest):
    def test_a_page_is_one_request_with_the_variables_of_twscrapes_community_tweets(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        self.assertTrue(handle(posts_request(count=7))["ok"])
        kv = {"communityId": COMMUNITY_ID, "count": 7, "rankingMode": "Relevance", **VARIABLES}
        self.assertEqual(
            fake_api.GQL_ITEMS, [{"op": fake_api.OP_CommunityTweetsTimeline, "kv": kv, "ft": None, "toggles": None}]
        )

    def test_the_ranking_is_passed_through(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for ranking in ("Relevance", "Recency"):
            handle(posts_request(ranking=ranking))
        self.assertEqual([item["kv"]["rankingMode"] for item in fake_api.GQL_ITEMS], ["Relevance", "Recency"])

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(posts_request(cursor="from-before"))
        handle(posts_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])


class TestPage(CommunityPostsTest):
    def test_a_page_is_the_posts_and_the_next_cursor(self):
        self.answer_with(tweet_entry(FIRST), tweet_entry(SECOND), cursor_entry("next-page"), tweets=(FIRST, SECOND))
        reply = handle(posts_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"posts", "cursor"})
        self.assertEqual(reply["data"]["cursor"], "next-page")
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_posts_follow_the_entries_not_their_ids(self):
        self.answer_with(tweet_entry(SECOND), tweet_entry(THIRD), tweet_entry(FIRST), tweets=(FIRST, SECOND, THIRD))
        self.assertEqual(post_ids(handle(posts_request())), [str(SECOND), str(THIRD), str(FIRST)])

    def test_the_other_timeline_key_is_accepted(self):
        self.answer_with(tweet_entry(FIRST), cursor_entry("next"), tweets=(FIRST,), key="community_timeline")
        reply = handle(posts_request(ranking="Recency"))
        self.assertEqual((post_ids(reply), reply["data"]["cursor"]), ([str(FIRST)], "next"))

    def test_count_caps_the_posts(self):
        self.answer_with(
            tweet_entry(FIRST), tweet_entry(SECOND), tweet_entry(THIRD), cursor_entry("next"),
            tweets=(FIRST, SECOND, THIRD),
        )
        reply = handle(posts_request(count=2))
        self.assertEqual(post_ids(reply), [str(FIRST), str(SECOND)])
        self.assertEqual(reply["data"]["cursor"], "next")

    def test_the_top_cursor_is_ignored(self):
        self.answer_with(cursor_entry("above", "Top"), tweet_entry(FIRST), cursor_entry("below"), tweets=(FIRST,))
        self.assertEqual(handle(posts_request())["data"]["cursor"], "below")
        self.answer_with(cursor_entry("above", "Top"), tweet_entry(FIRST), tweets=(FIRST,))
        self.assertIsNone(handle(posts_request())["data"]["cursor"])

    def test_a_page_without_posts_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(posts_request()), {"posts": [], "cursor": None}, contacted=True)

    def test_a_reply_without_a_community_timeline_is_no_such_community(self):
        bodies = {
            **NO_COMMUNITY_BODIES,
            "a community without a timeline": community_reply({"__typename": "Community", "rest_id": "1"}).body,
            "a community with a null timeline": community_reply({"ranked_community_timeline": None}).body,
        }
        for name, body in bodies.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                self.assert_ok(handle(posts_request()), None, contacted=True)

    def test_a_result_of_another_type_is_a_parse_failure(self):
        fake_api.GQL_REPLY = UNREADABLE_REPLY
        self.assert_failure(handle(posts_request()), "parse_error", contacted=True)


class TestFailures(CommunityPostsTest):
    def test_no_reply_is_no_account(self):
        reply = handle(posts_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(posts_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(posts_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(posts_request()), "error", contacted=True)


class TestArguments(CommunityPostsTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        before = len(fake_api.CONSTRUCTED)
        for name, (args, echoed) in posts_cases().items():
            with self.subTest(name):
                reply = handle(make_request("community_posts", args=args))
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["session"])
                if echoed is not None:
                    self.assertNotIn(echoed, str(reply))
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.GQL_ITEMS, [])

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        for name, args in LIMIT_ARGS.items():
            with self.subTest(name):
                self.assertTrue(handle(posts_request(**args))["ok"])


class TestMasking(CommunityPostsTest):
    def test_cookie_values_in_a_post_or_the_cursor_are_masked(self):
        fake_api.TWEETS[FIRST] = make_tweet(FIRST, rawContent=f"leaked {TOKEN} and {COOKIES}")
        self.answer_with(tweet_entry(FIRST), cursor_entry(f"cursor-{CSRF}"))
        reply = handle(posts_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(reply["data"]["posts"][0]["text"], "leaked [masked] and [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(tweet_entry(FIRST), tweets=(FIRST,))
        handle(posts_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
