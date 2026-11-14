"""The `post` operation: one tweet by id, as the compact dict the package's post shape is built from."""

import unittest
from datetime import datetime, timedelta, timezone

from support import COOKIES, CSRF, TOKEN, BridgeTest, handle, make_request
from tweets import (
    PARENT_ID,
    POST_ID,
    POSTED_AT,
    QUOTE_ID,
    make_gif,
    make_link,
    make_photo,
    make_reply_to,
    make_tweet,
    make_user,
    make_video,
)
from twscrape import api as fake_api
from twscrape.models import Media, MediaVideoVariant

QUOTE_AUTHOR = make_user("grace_reads", 4002, "Grace Reads")

POST_REPLY = {
    "id": str(POST_ID),
    "url": f"https://x.com/ada_writes/status/{POST_ID}",
    "date": "2026-01-07T10:30:00+00:00",
    "user": {"id": "4001", "username": "ada_writes", "displayname": "Ada Writes"},
    "text": "Notes on reading slowly.",
    "lang": "en",
    "replies": 2,
    "reposts": 3,
    "likes": 40,
    "quotes": 1,
    "bookmarks": 5,
    "views": 1200,
    "media": [],
    "links": [],
    "sensitive": False,
    "reply_to": None,
    "quote": None,
}


def post_request(post_id: object = str(POST_ID), **override) -> dict:
    return make_request("post", args={"id": post_id}, **override)


class PostTest(BridgeTest):
    def setUp(self):
        fake_api.TWEETS.clear()
        fake_api.TWEET_DETAILS.clear()
        self.addCleanup(fake_api.TWEETS.clear)

    def read(self, tweet) -> dict:
        fake_api.TWEETS[tweet.id] = tweet
        reply = handle(post_request(str(tweet.id)))
        self.assertTrue(reply["ok"], reply)
        return reply["data"]


class TestPost(PostTest):
    def test_a_full_tweet_is_the_compact_dict(self):
        fake_api.TWEETS[POST_ID] = make_tweet()
        self.assert_ok(handle(post_request()), POST_REPLY, contacted=True)
        self.assertEqual(fake_api.TWEET_DETAILS, [POST_ID])

    def test_a_tweet_X_does_not_give_is_null_data(self):
        reply = handle(post_request())
        self.assert_ok(reply, None, contacted=True)
        self.assertEqual(fake_api.TWEET_DETAILS, [POST_ID])

    def test_a_missing_view_count_is_null(self):
        self.assertIsNone(self.read(make_tweet(viewCount=None))["views"])

    def test_a_sensitive_flag_twscrape_does_not_know_is_null(self):
        self.assertIsNone(self.read(make_tweet(possibly_sensitive=None))["sensitive"])

    def test_links_are_the_expanded_urls(self):
        urls = ["https://example.test/a", "https://example.test/b"]
        self.assertEqual(self.read(make_tweet(links=[make_link(url) for url in urls]))["links"], urls)

    def test_the_date_is_iso_8601_in_utc_whatever_zone_twscrape_gave(self):
        zoned = POSTED_AT.astimezone(timezone(timedelta(hours=9)))
        self.assertEqual(self.read(make_tweet(date=zoned))["date"], "2026-01-07T10:30:00+00:00")
        naive = datetime(2026, 1, 7, 10, 30)
        self.assertEqual(self.read(make_tweet(date=naive))["date"], "2026-01-07T10:30:00+00:00")


class TestReplyAndQuote(PostTest):
    def test_a_reply_names_the_parent_and_its_author(self):
        data = self.read(make_tweet(inReplyToTweetIdStr=str(PARENT_ID), inReplyToUser=make_reply_to()))
        self.assertEqual(data["reply_to"], {"id": str(PARENT_ID), "username": "grace_reads"})

    def test_a_reply_whose_author_twscrape_could_not_find_still_names_the_parent(self):
        data = self.read(make_tweet(inReplyToTweetIdStr=str(PARENT_ID)))
        self.assertEqual(data["reply_to"], {"id": str(PARENT_ID), "username": None})

    def test_a_quote_is_one_level_without_reply_to_or_quote(self):
        inner = make_tweet(QUOTE_ID, user=QUOTE_AUTHOR, rawContent="The quoted words.", quotedTweet=make_tweet(9))
        quoted = self.read(make_tweet(quotedTweet=inner))["quote"]
        self.assertEqual(quoted["id"], str(QUOTE_ID))
        self.assertEqual(quoted["user"], {"id": "4002", "username": "grace_reads", "displayname": "Grace Reads"})
        self.assertEqual(quoted["text"], "The quoted words.")
        self.assertNotIn("quote", quoted)
        self.assertNotIn("reply_to", quoted)

    def test_a_tweet_without_a_quote_has_a_null_quote(self):
        self.assertIsNone(self.read(make_tweet())["quote"])


class TestMedia(PostTest):
    def test_photos_videos_and_gifs_each_have_their_type_and_url(self):
        media = Media(photos=[make_photo()], videos=[make_video()], animated=[make_gif()])
        self.assertEqual(
            self.read(make_tweet(media=media))["media"],
            [
                {"type": "photo", "url": "https://pbs.example.test/media/photo1.jpg", "duration_seconds": None},
                {"type": "video", "url": "https://video.example.test/high.mp4", "duration_seconds": 12.5},
                {"type": "gif", "url": "https://video.example.test/loop.mp4", "duration_seconds": None},
            ],
        )

    def test_a_video_is_its_best_mp4_even_when_a_stream_has_a_higher_bitrate(self):
        media = Media(videos=[make_video()])
        self.assertEqual(self.read(make_tweet(media=media))["media"][0]["url"], "https://video.example.test/high.mp4")

    def test_a_video_without_an_mp4_is_its_best_variant(self):
        variants = [
            MediaVideoVariant("application/x-mpegURL", 100, "https://video.example.test/a.m3u8"),
            MediaVideoVariant("application/x-mpegURL", 900, "https://video.example.test/b.m3u8"),
        ]
        media = Media(videos=[make_video(variants=variants)])
        self.assertEqual(self.read(make_tweet(media=media))["media"][0]["url"], "https://video.example.test/b.m3u8")

    def test_a_video_without_variants_is_left_out(self):
        media = Media(videos=[make_video(variants=[])])
        self.assertEqual(self.read(make_tweet(media=media))["media"], [])

    def test_every_photo_is_kept(self):
        media = Media(photos=[make_photo(f"https://pbs.example.test/media/p{n}.jpg") for n in range(4)])
        self.assertEqual(len(self.read(make_tweet(media=media))["media"]), 4)

    def test_a_quote_carries_its_own_media(self):
        inner = make_tweet(QUOTE_ID, user=QUOTE_AUTHOR, media=Media(photos=[make_photo()]))
        quoted = self.read(make_tweet(quotedTweet=inner))["quote"]
        self.assertEqual([item["type"] for item in quoted["media"]], ["photo"])


class TestArguments(PostTest):
    def test_an_invalid_id_is_rejected_before_anything_is_contacted(self):
        invalid = {
            "no id": None,
            "a number": POST_ID,
            "a boolean": True,
            "empty": "",
            "a sign": "-1",
            "a decimal point": "17.5",
            "letters": "abc",
            "a space": "1 2",
            "a newline": "123\n",
            "21 digits": "1" * 21,
            "other scripts' digits": "١٢٣",
            "a path": "../1",
        }
        before = len(fake_api.CONSTRUCTED)
        for name, post_id in invalid.items():
            with self.subTest(name):
                request = make_request("post", args={} if post_id is None else {"id": post_id})
                reply = handle(request)
                self.assert_failure(reply, "invalid_request", contacted=False)
                self.assertIsNone(reply["fingerprint"])
                self.assertIsNone(reply["session"])
        self.assertEqual(len(fake_api.CONSTRUCTED), before)
        self.assertEqual(fake_api.TWEET_DETAILS, [])

    def test_ids_of_1_to_20_digits_are_asked_for_as_numbers(self):
        for post_id in ("1", "0", "007", "9" * 20):
            with self.subTest(post_id):
                self.assert_ok(handle(post_request(post_id)), None, contacted=True)
        self.assertEqual(fake_api.TWEET_DETAILS, [1, 0, 7, int("9" * 20)])

    def test_check_still_takes_no_arguments(self):
        reply = handle(make_request("check", args={"id": "not a post id"}))
        self.assertTrue(reply["ok"], reply)


class TestMasking(PostTest):
    def test_a_cookie_value_inside_the_text_is_masked(self):
        text = f"leaked {TOKEN} and {CSRF} and {COOKIES}"
        data = self.read(make_tweet(rawContent=text))
        self.assertEqual(data["text"], "leaked [masked] and [masked] and [masked]")

    def test_a_cookie_value_in_a_name_a_link_or_a_quote_is_masked(self):
        user = make_user("ada_writes", displayname=f"Ada {TOKEN}")
        inner = make_tweet(QUOTE_ID, user=QUOTE_AUTHOR, rawContent=f"quoted {CSRF}")
        tweet = make_tweet(user=user, links=[make_link(f"https://example.test/?t={TOKEN}")], quotedTweet=inner)
        data = self.read(tweet)
        self.assertEqual(data["user"]["displayname"], "Ada [masked]")
        self.assertEqual(data["links"], ["https://example.test/?t=[masked]"])
        self.assertEqual(data["quote"]["text"], "quoted [masked]")


if __name__ == "__main__":
    unittest.main()
