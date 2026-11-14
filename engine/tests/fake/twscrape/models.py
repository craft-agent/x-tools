"""The fake models: the fields of twscrape 0.21.0's `Tweet` and what it holds that the bridge reads, under its names."""

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class TextLink:
    url: str
    text: str | None = None
    tcourl: str | None = None


@dataclass
class UserRef:
    id: int
    id_str: str
    username: str
    displayname: str


@dataclass
class User:
    id: int
    id_str: str
    username: str
    displayname: str


@dataclass
class MediaPhoto:
    url: str


@dataclass
class MediaVideoVariant:
    contentType: str
    bitrate: int
    url: str


@dataclass
class MediaVideo:
    thumbnailUrl: str
    variants: list[MediaVideoVariant]
    duration: int


@dataclass
class MediaAnimated:
    thumbnailUrl: str
    videoUrl: str


@dataclass
class Media:
    photos: list[MediaPhoto] = field(default_factory=list)
    videos: list[MediaVideo] = field(default_factory=list)
    animated: list[MediaAnimated] = field(default_factory=list)


@dataclass
class Tweet:
    id: int
    id_str: str
    url: str
    date: datetime
    user: User
    lang: str
    rawContent: str
    replyCount: int
    retweetCount: int
    likeCount: int
    quoteCount: int
    bookmarkedCount: int
    media: Media
    links: list[TextLink]
    viewCount: int | None = None
    quotedTweet: "Tweet | None" = None
    inReplyToTweetIdStr: str | None = None
    inReplyToUser: UserRef | None = None
    possibly_sensitive: bool | None = None
