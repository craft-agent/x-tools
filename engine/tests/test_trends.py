"""The `trends` operation: one page of X's Explore trends for a category, as compact trends and the next cursor."""

import unittest

from support import COOKIES, CSRF, TOKEN, handle, make_request
from test_masking import leaked
from timelines import Reply, cursor_entry
from trend_pages import (
    LIMIT_ARGS,
    TIMELINE_IDS,
    TRENDS_ARGS,
    UNREADABLE_BODIES,
    explore_page,
    module_entry,
    request_param_url,
    trend_entry,
    trend_object,
    trends_cases,
)
from twscrape import AbortReqError
from twscrape import api as fake_api
from user_pages import UserPageTest

SEARCH_URL = "twitter://search/?query=%23UFC334&src=trend_click"
STORY_URL = "twitter://trending/2112656968456475082"


def trends_request(**args) -> dict:
    return make_request("trends", args={**TRENDS_ARGS, **args})


def trends_of(reply: dict) -> list[dict]:
    return reply["data"]["trends"]


def names_of(reply: dict) -> list[str]:
    return [trend["name"] for trend in trends_of(reply)]


class TrendsTest(UserPageTest):
    def answer_with(self, *entries: dict) -> None:
        fake_api.GQL_REPLY = explore_page(*entries)


class TestRequest(TrendsTest):
    def test_each_category_is_one_request_with_the_variables_of_twscrapes_trends(self):
        self.answer_with(trend_entry("A"))
        for category, timeline_id in TIMELINE_IDS.items():
            with self.subTest(category):
                fake_api.GQL_ITEMS.clear()
                self.assertTrue(handle(trends_request(category=category, count=7))["ok"])
                kv = {"timelineId": timeline_id, "count": 7, "withQuickPromoteEligibilityTweetFields": True}
                self.assertEqual(
                    fake_api.GQL_ITEMS,
                    [{"op": fake_api.OP_GenericTimelineById, "kv": kv, "ft": None, "toggles": None}],
                )

    def test_the_cursor_is_asked_with_only_when_given(self):
        self.answer_with(trend_entry("A"))
        handle(trends_request(cursor="from-before"))
        handle(trends_request())
        self.assertEqual(fake_api.GQL_ITEMS[0]["kv"]["cursor"], "from-before")
        self.assertNotIn("cursor", fake_api.GQL_ITEMS[1]["kv"])


class TestTrends(TrendsTest):
    def test_a_classic_trend_holds_its_rank_context_grouped_trends_and_query(self):
        trend = trend_object(
            "#UFC334",
            rank="1",
            trend_metadata={"domain_context": "Trending in Sports", "meta_description": "12K posts"},
            grouped_trends=[{"name": "Topuria"}, {"name": 5}, {}, {"name": "Makhachev"}],
            social_context={"text": "ignored"},
            trend_url=request_param_url(("src", "trend_click"), ("query", "#UFC334")),
        )
        self.answer_with({"entryId": "trend-1", "content": {"itemContent": trend}})
        reply = handle(trends_request())
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(set(reply["data"]), {"trends", "cursor"})
        expected = {
            "name": "#UFC334",
            "rank": 1,
            "context": "Trending in Sports",
            "grouped": ["Topuria", "Makhachev"],
            "query": "#UFC334",
            "story_id": None,
        }
        self.assertEqual(trends_of(reply), [expected])
        self.assertEqual(reply["session"], {"active": True, "error": None, "locks": {}})

    def test_the_query_is_the_raw_query_parameter_too(self):
        self.answer_with(trend_entry("A", trend_url=request_param_url(("rawQuery", "raw words"))))
        self.assertEqual(trends_of(handle(trends_request()))[0]["query"], "raw words")

    def test_the_query_is_the_query_parameter_of_a_search_url(self):
        self.answer_with(trend_entry("A", trend_url={"url": SEARCH_URL, "urlType": "DeepLink"}))
        self.assertEqual(trends_of(handle(trends_request()))[0]["query"], "#UFC334")

    def test_a_trend_without_a_readable_query_has_none(self):
        urls = {
            "no link": None,
            "an empty request parameter": request_param_url(("query", "")),
            "a number as parameter": request_param_url(("query", 5)),
            "another key": request_param_url(("q", "x")),
            "a search url without a query": {"url": "twitter://search/?src=trend_click"},
            "another url": {"url": "https://x.com/search?query=x"},
            "a text link": "twitter://search/?query=x",
        }
        for name, url in urls.items():
            with self.subTest(name):
                self.answer_with(trend_entry("A", trend_url=url))
                self.assertIsNone(trends_of(handle(trends_request()))[0]["query"])

    def test_a_story_holds_its_id_and_no_query_or_context(self):
        link = {"url": STORY_URL, "urlType": "DeepLink"}
        story = trend_object(
            "Kalshi Surpasses",
            is_ai_trend=True,
            social_context={"text": "23 hours ago · Sports · 338 posts"},
            trend_metadata={"url": link},
            trend_url=link,
        )
        self.answer_with(module_entry(story))
        expected = {
            "name": "Kalshi Surpasses",
            "rank": None,
            "context": None,
            "grouped": [],
            "query": None,
            "story_id": "2112656968456475082",
        }
        reply = handle(trends_request())
        self.assertEqual(trends_of(reply), [expected])
        self.assertNotIn("338", str(reply["data"]))

    def test_a_rank_that_is_not_a_number_is_none(self):
        for rank in ("first", "", 3, None):
            with self.subTest(rank):
                self.answer_with(trend_entry("A", rank=rank))
                self.assertIsNone(trends_of(handle(trends_request()))[0]["rank"])

    def test_trends_of_entries_and_modules_come_in_the_order_x_lists_them(self):
        self.answer_with(
            trend_entry("first"),
            module_entry(trend_object("second"), trend_object("third")),
            trend_entry("fourth"),
        )
        self.assertEqual(names_of(handle(trends_request())), ["first", "second", "third", "fourth"])

    def test_other_content_is_skipped(self):
        tweet = {"entryId": "tweet-1", "content": {"itemContent": {"itemType": "TimelineTweet", "name": "tweet"}}}
        prompt = {"entryId": "prompt-1", "content": {"itemContent": {"itemType": "TimelinePrompt", "name": "prompt"}}}
        odd = {"entryId": "odd-1", "content": {"items": [None, {"item": None}, {"item": {}}]}}
        self.answer_with(tweet, prompt, odd, "text", {"content": "text"}, trend_entry("kept"))
        self.assertEqual(names_of(handle(trends_request())), ["kept"])

    def test_the_type_may_be_named_by_either_field(self):
        by_type = {"__typename": "TimelineTrend", "name": "by typename"}
        by_item = {"itemType": "TimelineTrend", "name": "by item type"}
        self.answer_with(module_entry(by_type, by_item))
        self.assertEqual(names_of(handle(trends_request())), ["by typename", "by item type"])

    def test_a_trend_without_a_text_name_is_skipped(self):
        self.answer_with(trend_entry(None), trend_entry(7), trend_entry("kept"))
        self.assertEqual(names_of(handle(trends_request())), ["kept"])

    def test_a_name_twice_is_kept_once_as_first_listed(self):
        later = module_entry(trend_object("same", rank="2"))
        self.answer_with(trend_entry("same", rank="1"), later, trend_entry("other"))
        reply = handle(trends_request())
        self.assertEqual(names_of(reply), ["same", "other"])
        self.assertEqual(trends_of(reply)[0]["rank"], 1)

    def test_count_caps_the_trends(self):
        self.answer_with(*(trend_entry(f"t{n}") for n in range(5)), cursor_entry("next"))
        reply = handle(trends_request(count=2))
        self.assertEqual(names_of(reply), ["t0", "t1"])
        self.assertEqual(reply["data"]["cursor"], "next")


class TestCursor(TrendsTest):
    def test_the_bottom_cursor_is_kept_and_the_top_one_ignored(self):
        self.answer_with(cursor_entry("up", "Top"), trend_entry("A"), cursor_entry("down", "Bottom"))
        self.assertEqual(handle(trends_request())["data"]["cursor"], "down")
        self.answer_with(cursor_entry("up", "Top"), trend_entry("A"))
        self.assertIsNone(handle(trends_request())["data"]["cursor"])

    def test_a_page_without_trends_has_no_cursor_though_X_gave_one(self):
        self.answer_with(cursor_entry("past-the-end"))
        self.assert_ok(handle(trends_request()), {"trends": [], "cursor": None}, contacted=True)
        self.answer_with(trend_entry(None), cursor_entry("past-the-end"))
        self.assert_ok(handle(trends_request()), {"trends": [], "cursor": None}, contacted=True)


class TestUnreadable(TrendsTest):
    def test_a_reply_without_the_timeline_is_a_parse_failure(self):
        for name, body in UNREADABLE_BODIES.items():
            with self.subTest(name):
                fake_api.GQL_REPLY = Reply(body)
                reply = handle(trends_request())
                self.assert_failure(reply, "parse_error", contacted=True)
                self.assertIn("trends the bridge cannot read", reply["error"])

    def test_a_timeline_without_instructions_is_an_empty_page(self):
        fake_api.GQL_REPLY = Reply({"data": {"timeline": {"timeline": {"instructions": "none"}}}})
        self.assert_ok(handle(trends_request()), {"trends": [], "cursor": None}, contacted=True)


class TestFailures(TrendsTest):
    def test_no_reply_is_no_account(self):
        reply = handle(trends_request())
        self.assert_failure(reply, "no_account", contacted=True)
        self.assertIsNotNone(reply["session"])

    def test_an_abort_is_an_x_error(self):
        fake_api.GQL_ERROR = AbortReqError("Blocked by Cloudflare: 403")
        reply = handle(trends_request())
        self.assert_failure(reply, "x_error", contacted=True)
        self.assertEqual(reply["error"], "AbortReqError: Blocked by Cloudflare: 403")

    def test_the_other_failures_keep_their_kinds(self):
        fake_api.GQL_ERROR = TimeoutError()
        self.assert_failure(handle(trends_request(count=1)), "timeout", contacted=True)
        fake_api.GQL_ERROR = ValueError("boom")
        self.assert_failure(handle(trends_request()), "error", contacted=True)


class TestArguments(TrendsTest):
    def test_an_invalid_argument_is_rejected_before_anything_is_contacted(self):
        self.assert_invalid_before_contact("trends", trends_cases())

    def test_the_limits_themselves_are_taken(self):
        self.answer_with(trend_entry("A"))
        for name, args in LIMIT_ARGS.items():
            with self.subTest(name):
                self.assertTrue(handle(trends_request(**args))["ok"])


class TestMasking(TrendsTest):
    def test_cookie_values_in_a_trend_or_the_cursor_are_masked(self):
        trend = trend_entry(
            f"leaked {TOKEN}", trend_metadata={"domain_context": f"in {COOKIES}"}, grouped_trends=[{"name": CSRF}]
        )
        self.answer_with(trend, cursor_entry(f"cursor-{CSRF}"))
        reply = handle(trends_request())
        self.assertEqual(leaked(reply), [])
        self.assertEqual(trends_of(reply)[0]["name"], "leaked [masked]")
        self.assertEqual(trends_of(reply)[0]["context"], "in [masked]")
        self.assertEqual(reply["data"]["cursor"], "cursor-[masked]")

    def test_the_request_the_bridge_sends_holds_no_cookie(self):
        self.answer_with(trend_entry("A"))
        handle(trends_request())
        self.assertEqual(leaked(fake_api.GQL_ITEMS), [])


if __name__ == "__main__":
    unittest.main()
