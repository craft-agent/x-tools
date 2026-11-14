"""Fake tweets for the `post` operation: made-up ids and handles, built with the fake twscrape's models."""

from datetime import datetime, timezone

from twscrape.models import (
    Media,
    MediaAnimated,
    MediaPhoto,
    MediaVideo,
    MediaVideoVariant,
    TextLink,
    Tweet,
    User,
    UserRef,
)

POST_ID = 1700000000000000001
QUOTE_ID = 1700000000000000002
PARENT_ID = 1700000000000000003

# Wed Jan 07 10:30:00 +0000 2026, as twscrape's `parsedate_to_datetime` makes it.
POSTED_AT = datetime(2026, 1, 7, 10, 30, tzinfo=timezone.utc)


def make_user(username: str = "ada_writes", id: int = 4001, displayname: str = "Ada Writes") -> User:
    return User(id=id, id_str=str(id), username=username, displayname=displayname)


def make_tweet(id: int = POST_ID, **fields) -> Tweet:
    """A tweet with every field set; `fields` replace any of them."""
    user = fields.get("user") or make_user()
    defaults = {
        "id": id,
        "id_str": str(id),
        "url": f"https://x.com/{user.username}/status/{id}",
        "date": POSTED_AT,
        "user": user,
        "lang": "en",
        "rawContent": "Notes on reading slowly.",
        "replyCount": 2,
        "retweetCount": 3,
        "likeCount": 40,
        "quoteCount": 1,
        "bookmarkedCount": 5,
        "viewCount": 1200,
        "media": Media(),
        "links": [],
        "possibly_sensitive": False,
    }
    return Tweet(**{**defaults, **fields})


def make_photo(url: str = "https://pbs.example.test/media/photo1.jpg") -> MediaPhoto:
    return MediaPhoto(url=url)


def make_video(duration: int = 12500, variants: list[MediaVideoVariant] | None = None) -> MediaVideo:
    """A video of `duration` milliseconds; by default two mp4 files and an HLS stream with the highest bitrate."""
    if variants is None:
        variants = [
            MediaVideoVariant("video/mp4", 256000, "https://video.example.test/low.mp4"),
            MediaVideoVariant("video/mp4", 2176000, "https://video.example.test/high.mp4"),
            MediaVideoVariant("application/x-mpegURL", 9000000, "https://video.example.test/stream.m3u8"),
        ]
    return MediaVideo(thumbnailUrl="https://pbs.example.test/media/thumb.jpg", variants=variants, duration=duration)


def make_gif() -> MediaAnimated:
    return MediaAnimated(
        thumbnailUrl="https://pbs.example.test/media/gif.jpg", videoUrl="https://video.example.test/loop.mp4"
    )


def make_reply_to(username: str = "grace_reads", id: int = 4002) -> UserRef:
    return UserRef(id=id, id_str=str(id), username=username, displayname="Grace Reads")


def make_link(url: str) -> TextLink:
    return TextLink(url=url, text=url.removeprefix("https://"), tcourl="https://t.co/abc123")
