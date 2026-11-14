"""The bridge of the X engine: one operation per run, in the engine venv's interpreter.

The engine call writes one JSON request to standard input and reads one JSON reply
from standard output (the request and reply are fixed by the engine call in
``src/core/x/engine-call.ts``)::

    {"op": "check", "cookies": "auth_token=…; ct0=…", "refused": "<fingerprint>" | null,
     "deadline": 60, "args": {}}

Only reads exist here. The session is built from the cookies in this short-lived
process: twscrape keeps its account pool in SQLite, which is held in memory, so
nothing of the session is written to disk. Every string that leaves holds the
cookies, the ``auth_token`` and the ``ct0`` masked.
"""

import asyncio
import contextlib
import functools
import hashlib
import importlib
import importlib.metadata
import itertools
import json
import math
import re
import sqlite3
import sys
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

TWSCRAPE = "twscrape"
ACCOUNT = "reader"
MASK = "[masked]"
FINGERPRINT_LENGTH = 16
MAX_WARNINGS = 10
WARNING_LIMIT = 300
ERROR_LIMIT = 500
SESSION_ERROR_LIMIT = 200
# How long twscrape waits for an account that is busy before it gives up, and how often it looks.
WAIT_TIMEOUT_SECONDS = 10
WAIT_INTERVAL_SECONDS = 2
# The twscrape exceptions that mean X answered with an error (`ApiError` is an `AbortReqError`).
X_ERRORS = ("AbortReqError", "ApiError", "XClIdParseError")
PARSE_ERRORS = ("ParseError",)
# An X id (post or user): decimal digits only (not `\d`, which takes other scripts' digits).
MAX_ID_DIGITS = 20
DECIMAL_ID = re.compile(rf"[0-9]{{1,{MAX_ID_DIGITS}}}")
VIDEO_MP4 = "video/mp4"
MILLISECONDS = 1000
# The arguments of `search`, and what each may hold.
SEARCH_ARGS = frozenset({"query", "product", "count", "cursor"})
SEARCH_PRODUCTS = ("Latest", "Top", "Media")
MAX_QUERY_LENGTH = 600
MAX_COUNT = 50
MAX_CURSOR_LENGTH = 2000
SEARCH_QUERY_SOURCE = "typed_query"
SEARCH_TOGGLES = {"withArticleRichContentState": False}
BOTTOM_CURSOR = "Bottom"
SHOW_MORE_THREADS_CURSOR = "ShowMoreThreads"
# The arguments of `user_search`, and the product of the SearchTimeline request that finds accounts.
USER_SEARCH_ARGS = frozenset({"query", "count", "cursor"})
USER_SEARCH_PRODUCT = "People"
# The arguments of `conversation` and `thread`.
CONVERSATION_ARGS = frozenset({"id", "ranking", "cursor"})
CONVERSATION_RANKINGS = ("Likes", "Recency")
THREAD_ARGS = frozenset({"id"})
# The variables of a TweetDetail request that its two readings (`conversation`, `thread`) have in common.
DETAIL_VARIABLES = {
    "includePromotedContent": True,
    "withCommunity": True,
    "withQuickPromoteEligibilityTweetFields": True,
    "withBirdwatchNotes": True,
    "withVoice": True,
    "withV2Timeline": True,
}
# The `referrer` twscrape sends with each reading (`tweet_replies_raw`, `tweet_thread_raw`).
CONVERSATION_REFERRER = "tweet"
THREAD_REFERRER = "profile"
# The features `tweet_thread_raw` of twscrape 0.21.0 sends beside its defaults (twscrape keeps them inside the function).
THREAD_FEATURES = {
    "rweb_video_screen_enabled": False,
    "profile_label_improvements_pcf_label_in_post_enabled": True,
    "rweb_tipjar_consumption_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "premium_content_api_read_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": False,
    "responsive_web_grok_analyze_post_followups_enabled": True,
    "responsive_web_jetfuel_frame": False,
    "responsive_web_grok_share_attachment_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "responsive_web_grok_show_grok_translated_post": False,
    "responsive_web_grok_analysis_button_from_backend": True,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_grok_image_annotation_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}
# The argument of `user`: an X handle, without the `@` (not `\w`, which takes other scripts' letters).
USER_ARGS = frozenset({"handle"})
MAX_HANDLE_LENGTH = 15
HANDLE = re.compile(rf"[A-Za-z0-9_]{{1,{MAX_HANDLE_LENGTH}}}")
# The arguments of `timeline`, and what each may hold.
TIMELINE_ARGS = frozenset({"user_id", "tab", "count", "cursor"})
# The twscrape operation each tab of a profile's timeline reads (`user_tweets_raw`, `user_tweets_and_replies_raw`,
# `user_media_raw`), the variables it sends beside `userId` and `count` (twscrape keeps them inside the function),
# and the toggles of the one that sends any.
TIMELINE_OPERATIONS = {"posts": "OP_UserTweets", "replies": "OP_UserTweetsAndReplies", "media": "OP_UserMedia"}
TIMELINE_VARIABLES = {
    "posts": {
        "includePromotedContent": True,
        "withQuickPromoteEligibilityTweetFields": True,
        "withVoice": True,
        "withV2Timeline": True,
    },
    "replies": {
        "includePromotedContent": True,
        "withCommunity": True,
        "withVoice": True,
        "withV2Timeline": True,
    },
    "media": {
        "includePromotedContent": False,
        "withClientEventToken": False,
        "withBirdwatchNotes": False,
        "withVoice": True,
        "withV2Timeline": True,
    },
}
TIMELINE_TOGGLES = {"media": {"withArticlePlainText": False}}
# A timeline entry's id ends in the id of the post it holds: `tweet-<id>`, or `<prefix>-<id>` in a module.
ENTRY_POST_ID = re.compile(r"-([0-9]+)$")
# A people-search entry's id is `user-<id>`.
ENTRY_USER_ID = re.compile(r"^user-([0-9]+)$")
# What twscrape's `AbortReqError` says once X has answered 404 to a request three times, which X does to a
# search by an account whose phone is not verified (twscrape issue 367).
SEARCH_REFUSED_MARKER = "XClIdGen"
SEARCH_REFUSED_MESSAGE = (
    "X refused the search: X answers 404 to a search by an account whose phone is not verified"
)

Operation = Callable[[Any, dict], Awaitable[Any]]
ArgumentCheck = Callable[[dict], None]

# The operations that contact X: each gets an `API` whose pool holds the one session, and
# returns the JSON that becomes `data`.
OPERATIONS: dict[str, Operation] = {}
# The checks of an operation's arguments, which run before anything is contacted.
ARGUMENT_CHECKS: dict[str, ArgumentCheck] = {}

_warnings: list[str] = []
_secrets: list[str] = []


class Failure(Exception):
    """A failed request: the reply's `kind` and its message."""

    def __init__(self, kind: str, error: str):
        super().__init__(error)
        self.kind = kind
        self.error = error


def operation(name: str, check_args: ArgumentCheck | None = None) -> Callable[[Operation], Operation]:
    """Registers a coroutine function as the X operation `name`.

    `check_args`, when given, runs on the request's `args` before anything is contacted and raises
    `Failure("invalid_request")` for arguments the operation cannot take.
    """

    def register(function: Operation) -> Operation:
        OPERATIONS[name] = function
        if check_args is None:
            ARGUMENT_CHECKS.pop(name, None)
        else:
            ARGUMENT_CHECKS[name] = check_args
        return function

    return register


# Masking


def secrets_of(cookies: str) -> list[str]:
    """What must never leave: the cookie string, the `auth_token` value and the `ct0` value, longest first."""
    pairs = parse_cookies(cookies)
    found = {cookies, cookies.strip(), pairs.get("auth_token", ""), pairs.get("ct0", "")}
    return sorted((value for value in found if value), key=len, reverse=True)


def mask(text: str) -> str:
    """`text` with every secret of the run replaced by `[masked]`."""
    for secret in _secrets:
        text = text.replace(secret, MASK)
    return text


def safe(text: object, limit: int) -> str:
    """`text` masked, then clipped to `limit` characters (masked first, so a cut cannot leave part of a secret)."""
    return mask(str(text))[:limit]


def mask_value(value: Any) -> Any:
    """`value` with every string in it, keys included, masked."""
    if isinstance(value, str):
        return mask(value)
    if isinstance(value, dict):
        return {mask(str(key)): mask_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [mask_value(item) for item in value]
    return value


# Cookies


def parse_cookies(cookies: str) -> dict[str, str]:
    """`name → value` of a `;`-separated cookie string, as the engine call reads it.

    Names and values are trimmed, a value's surrounding double quotes dropped, and a later pair wins.
    """
    pairs: dict[str, str] = {}
    for part in cookies.split(";"):
        name, separator, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if separator and name:
            if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            pairs[name] = value
    return pairs


def session_cookies(cookies: object) -> tuple[dict[str, str], str]:
    """The session's cookies and its fingerprint; raises `Failure("setup")` when `auth_token` or `ct0` is missing."""
    pairs = parse_cookies(cookies) if isinstance(cookies, str) else {}
    token, csrf = pairs.get("auth_token", ""), pairs.get("ct0", "")
    if not token or not csrf:
        raise Failure("setup", "the cookies do not hold both auth_token and ct0")
    return pairs, hashlib.sha256(token.encode()).hexdigest()[:FINGERPRINT_LENGTH]


# Warnings


def record_warning(message: object) -> None:
    """The sink that replaces twscrape's stderr sink: keeps the first warnings, masked and clipped."""
    if len(_warnings) < MAX_WARNINGS:
        _warnings.append(safe(str(message).strip(), WARNING_LIMIT))


def capture_warnings(logger: Any) -> None:
    """Replaces the sinks of twscrape's logger with one that records warnings for the reply."""
    logger.remove()
    logger.add(record_warning, level="WARNING", format="{message}")


# The session


@contextlib.contextmanager
def shared_memory_pool():
    """Yields the name of an in-memory SQLite database that twscrape's own connections reach.

    A shared-cache in-memory database lives while one connection is open (the anchor, held for the
    whole call), and twscrape's connections reach it through URI filenames. A connection that was
    not opened with `uri=True` would create a file named like the URI, so the connect function is
    wrapped for the call and restored after it.
    """
    name = f"file:x-tools-pool-{uuid.uuid4().hex}?mode=memory&cache=shared"
    database = importlib.import_module(f"{TWSCRAPE}.db")
    connect = database.aiosqlite.connect
    anchor = sqlite3.connect(name, uri=True)
    database.aiosqlite.connect = functools.partial(connect, uri=True)
    try:
        yield name
    finally:
        database.aiosqlite.connect = connect
        anchor.close()


def future_locks(account: Any) -> dict[str, str]:
    """The queue locks of `account` that end after now, as ISO 8601 strings with a UTC offset."""
    now = datetime.now(timezone.utc)
    locks = {}
    for queue, until in (account.locks or {}).items():
        until = until if until.tzinfo else until.replace(tzinfo=timezone.utc)
        if until > now:
            locks[str(queue)] = until.isoformat()
    return locks


async def session_report(api: Any) -> dict | None:
    """What twscrape made of the session: active or not, its error, and the locks still ahead; None when unreadable."""
    try:
        accounts = await api.pool.get_all()
    except Exception:
        return None
    if not accounts:
        return {"active": False, "error": "the pool holds no account", "locks": {}}
    account = accounts[0]
    error = None if account.error_msg in (None, "None", "") else safe(account.error_msg, SESSION_ERROR_LIMIT)
    return {"active": bool(account.active), "error": error, "locks": future_locks(account)}


# Operations


def check() -> dict:
    """The local operation: the cookies were already checked, so it reports the engine's version and contacts nothing."""
    try:
        return {"twscrape_version": importlib.metadata.version(TWSCRAPE)}
    except importlib.metadata.PackageNotFoundError:
        raise Failure("error", "twscrape is not installed in the engine") from None


def check_id_arg(value: object, field: str, label: str) -> None:
    """Raises `Failure("invalid_request")` unless `value` is a decimal id string of 1 to 20 digits."""
    if not isinstance(value, str) or DECIMAL_ID.fullmatch(value) is None:
        raise Failure("invalid_request", f"args.{field} is not a {label} of 1 to {MAX_ID_DIGITS} digits")


def check_post_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args.id` is a decimal string of 1 to 20 digits."""
    check_id_arg(args.get("id"), "id", "post id")


def iso_utc(moment: datetime) -> str:
    """`moment` as an ISO 8601 string in UTC; a moment without a zone is taken as UTC."""
    moment = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat()


def video_url(video: Any) -> str | None:
    """The file of a video: its best mp4, else its best variant; None when it has no variant."""
    variants = [variant for variant in video.variants if variant.contentType == VIDEO_MP4] or video.variants
    best = max(variants, key=lambda variant: variant.bitrate, default=None)
    return best.url if best else None


def media_of(media: Any) -> list[dict]:
    """The photos, videos and animated gifs of a tweet's `Media` (in that order, as twscrape sorts them).

    twscrape carries neither a size nor an alt text, and gives a video's duration in milliseconds. A video with no
    file to point at is left out rather than given its thumbnail, which is an image.
    """
    return [
        *({"type": "photo", "url": photo.url, "duration_seconds": None} for photo in media.photos),
        *(
            {"type": "video", "url": url, "duration_seconds": video.duration / MILLISECONDS}
            for video in media.videos
            if (url := video_url(video)) is not None
        ),
        *({"type": "gif", "url": gif.videoUrl, "duration_seconds": None} for gif in media.animated),
    ]


def post_of(tweet: Any, with_quote: bool = True) -> dict:
    """The compact dict of a twscrape `Tweet` that the package's post shape is built from.

    The quoted tweet is one level only: a quote has neither `reply_to` nor `quote` of its own.
    """
    post = {
        "id": tweet.id_str,
        "url": tweet.url,
        "date": iso_utc(tweet.date),
        "user": {"id": tweet.user.id_str, "username": tweet.user.username, "displayname": tweet.user.displayname},
        "text": tweet.rawContent,
        "lang": tweet.lang,
        "replies": tweet.replyCount,
        "reposts": tweet.retweetCount,
        "likes": tweet.likeCount,
        "quotes": tweet.quoteCount,
        "bookmarks": tweet.bookmarkedCount,
        "views": tweet.viewCount,
        "media": media_of(tweet.media),
        "links": [link.url for link in tweet.links],
        "sensitive": tweet.possibly_sensitive,
    }
    if with_quote:
        replied_to = tweet.inReplyToUser
        post["reply_to"] = (
            {"id": tweet.inReplyToTweetIdStr, "username": replied_to.username if replied_to else None}
            if tweet.inReplyToTweetIdStr
            else None
        )
        post["quote"] = post_of(tweet.quotedTweet, with_quote=False) if tweet.quotedTweet else None
    return post


@operation("post", check_args=check_post_args)
async def read_post(api: Any, args: dict) -> dict | None:
    """One post by id: its compact dict, or None when X gives no tweet (missing, deleted or not visible)."""
    tweet = await api.tweet_details(int(args["id"]))
    return post_of(tweet) if tweet is not None else None


def check_cursor_arg(cursor: object) -> None:
    """Raises `Failure("invalid_request")` unless `cursor` is None or a text of 1 to 2000 characters."""
    if cursor is not None and (not isinstance(cursor, str) or not 1 <= len(cursor) <= MAX_CURSOR_LENGTH):
        raise Failure("invalid_request", f"args.cursor is not null or a text of 1 to {MAX_CURSOR_LENGTH} characters")


def check_count_arg(count: object) -> None:
    """Raises `Failure("invalid_request")` unless `count` is a whole number from 1 to `MAX_COUNT`."""
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= MAX_COUNT:
        raise Failure("invalid_request", f"args.count is not a whole number from 1 to {MAX_COUNT}")


def check_query_arg(query: object) -> None:
    """Raises `Failure("invalid_request")` unless `query` is a text of 1 to `MAX_QUERY_LENGTH` characters that is not blank."""
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_LENGTH:
        raise Failure("invalid_request", f"args.query is not a text of 1 to {MAX_QUERY_LENGTH} characters")


def check_search_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a query, a product, a count and a cursor.

    The messages name the argument and never repeat its value.
    """
    if set(args) != SEARCH_ARGS:
        raise Failure("invalid_request", "args does not hold exactly query, product, count and cursor")
    query, product, count, cursor = args["query"], args["product"], args["count"], args["cursor"]
    check_query_arg(query)
    if not isinstance(product, str) or product not in SEARCH_PRODUCTS:
        raise Failure("invalid_request", f"args.product is not one of {', '.join(SEARCH_PRODUCTS)}")
    check_count_arg(count)
    check_cursor_arg(cursor)


def in_timeline_order(api: Any, timeline: dict, items: list[Any], entry_id: re.Pattern = ENTRY_POST_ID) -> list[Any]:
    """`items` (tweets or users) as the timeline lists them: by the id each entry's id holds (`entry_id`'s first
    group), then the rest in their own order."""
    by_id = {item.id_str: item for item in items}
    ordered = []
    for entry in api._gql_entries(timeline):
        match = entry_id.search(str(entry.get("entryId"))) if isinstance(entry, dict) else None
        if match and (item := by_id.pop(match.group(1), None)) is not None:
            ordered.append(item)
    return [*ordered, *by_id.values()]


async def request_page(
    api: Any,
    operation_id: str,
    variables: dict,
    ft: dict | None = None,
    toggles: dict | None = None,
    parse: Callable[[Any], Any] | None = None,
    entry_id: re.Pattern = ENTRY_POST_ID,
) -> tuple[dict, list[Any]]:
    """The timeline and parsed items (in timeline order) of one `_gql_item` request; raises `NoAccountError` when none."""
    rep = await api._gql_item(operation_id, variables, ft=ft, toggles=toggles)
    if rep is None:
        raise importlib.import_module(TWSCRAPE).NoAccountError(
            f"No account available for queue {operation_id.split('/')[-1]}"
        )
    timeline = rep.json()
    parser = parse or importlib.import_module(f"{TWSCRAPE}.models").parse_tweets
    return timeline, in_timeline_order(api, timeline, list(parser(rep)), entry_id)


def paged_items(
    api: Any, timeline: dict, items: list[Any], count: int, key: str, shape: Callable[[Any], dict]
) -> dict:
    """One page of `items` under `key`, capped to `count`, with the bottom cursor when non-empty."""
    items = items[:count]
    cursor = api._get_cursor(timeline, BOTTOM_CURSOR) if items else None
    return {key: [shape(item) for item in items], "cursor": cursor}


def paged_posts(api: Any, timeline: dict, tweets: list[Any], count: int) -> dict:
    """One page of posts capped to `count`, with the bottom cursor when non-empty."""
    return paged_items(api, timeline, tweets, count, "posts", post_of)


async def read_users_page(
    api: Any, operation_id: str, variables: dict, count: int, ft: dict | None = None, toggles: dict | None = None
) -> dict:
    """One page of accounts from one `_gql_item` request: `{"users": [...], "cursor": str | None}`.

    The users are those X lists, in the order it lists them, as many as `count`; a page without users has no cursor.
    """
    parse_users = importlib.import_module(f"{TWSCRAPE}.models").parse_users
    timeline, users = await request_page(
        api, operation_id, variables, ft=ft, toggles=toggles, parse=parse_users, entry_id=ENTRY_USER_ID
    )
    return paged_items(api, timeline, users, count, "users", user_of)


def search_variables(args: dict, product: str) -> dict:
    """The variables of a SearchTimeline request for `args` (a query, a count and a cursor) in `product`."""
    variables = {
        "rawQuery": args["query"],
        "count": args["count"],
        "product": product,
        "querySource": SEARCH_QUERY_SOURCE,
    }
    if args["cursor"] is not None:
        variables["cursor"] = args["cursor"]
    return variables


@contextlib.contextmanager
def refusal_of_search():
    """Turns the 404 X answers to a search by an account without a verified phone into `Failure("search_refused")`."""
    twscrape = importlib.import_module(TWSCRAPE)
    try:
        yield
    except twscrape.AbortReqError as exc:
        if SEARCH_REFUSED_MARKER not in str(exc):
            raise
        raise Failure("search_refused", SEARCH_REFUSED_MESSAGE) from exc


@operation("search", check_args=check_search_args)
async def read_search(api: Any, args: dict) -> dict:
    """One page of X's search: `{"posts": [...], "cursor": str | None}`, in the order the timeline lists them.

    twscrape's own `search` pages inside a generator and asks X again for a page without items, so the one request
    is made here: a page is one read. An empty page has no cursor, since X keeps giving one past the end. Raises
    `Failure("search_refused")` when X answers 404 to the search, which it does for an account without a verified phone.
    """
    operation_id = importlib.import_module(f"{TWSCRAPE}.api").OP_SearchTimeline
    variables = search_variables(args, args["product"])
    with refusal_of_search():
        timeline, tweets = await request_page(api, operation_id, variables, toggles=SEARCH_TOGGLES)
    return paged_posts(api, timeline, tweets, args["count"])


def check_user_search_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a query, a count and a cursor.

    The messages name the argument and never repeat its value.
    """
    if set(args) != USER_SEARCH_ARGS:
        raise Failure("invalid_request", "args does not hold exactly query, count and cursor")
    check_query_arg(args["query"])
    check_count_arg(args["count"])
    check_cursor_arg(args["cursor"])


@operation("user_search", check_args=check_user_search_args)
async def read_user_search(api: Any, args: dict) -> dict:
    """One page of X's search for accounts: `{"users": [...], "cursor": str | None}`, in the timeline's order.

    The one request is made here, with the variables twscrape's `search_user` sends (but for `count`): twscrape pages
    inside a generator. The users are those X lists, as many as `count`; a page without users has no cursor. Raises
    `Failure("search_refused")` as `search` does, since X refuses both alike.
    """
    operation_id = importlib.import_module(f"{TWSCRAPE}.api").OP_SearchTimeline
    variables = search_variables(args, USER_SEARCH_PRODUCT)
    with refusal_of_search():
        return await read_users_page(api, operation_id, variables, args["count"], toggles=SEARCH_TOGGLES)


def check_conversation_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a post id, a ranking and a cursor.

    The messages name the argument and never repeat its value.
    """
    if set(args) != CONVERSATION_ARGS:
        raise Failure("invalid_request", "args does not hold exactly id, ranking and cursor")
    check_post_args(args)
    ranking = args["ranking"]
    if not isinstance(ranking, str) or ranking not in CONVERSATION_RANKINGS:
        raise Failure("invalid_request", f"args.ranking is not one of {', '.join(CONVERSATION_RANKINGS)}")
    check_cursor_arg(args["cursor"])


def check_thread_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a post id."""
    if set(args) != THREAD_ARGS:
        raise Failure("invalid_request", "args does not hold exactly id")
    check_post_args(args)


def detail_variables(post_id: str, referrer: str, with_rux_injections: bool) -> dict:
    """The variables of a TweetDetail request for the post `post_id`, as twscrape's readings of it send them."""
    return {
        "focalTweetId": post_id,
        "referrer": referrer,
        "with_rux_injections": with_rux_injections,
        **DETAIL_VARIABLES,
    }


async def read_detail_page(
    api: Any, variables: dict, ft: dict | None = None, toggles: dict | None = None
) -> tuple[dict, list[Any]]:
    """The timeline of one TweetDetail request and its tweets in the order the timeline lists them.

    A page is one request: twscrape's own readings page inside a generator.
    """
    operation_id = importlib.import_module(f"{TWSCRAPE}.api").OP_TweetDetail
    return await request_page(api, operation_id, variables, ft=ft, toggles=toggles)


def focal_of(tweets: list[Any], post_id: str) -> Any | None:
    """The tweet of `tweets` that is the post `post_id`, or None."""
    return next((tweet for tweet in tweets if tweet.id_str == post_id), None)


def parents_of(tweet: Any, tweets: list[Any]) -> list[Any]:
    """What `tweet` replies to, then what that replies to, and so on, as far as `tweets` holds it: nearest first."""
    by_id = {other.id_str: other for other in tweets}
    seen = {tweet.id_str}
    parents = []
    parent = by_id.get(tweet.inReplyToTweetIdStr)
    while parent is not None and parent.id_str not in seen:
        parents.append(parent)
        seen.add(parent.id_str)
        parent = by_id.get(parent.inReplyToTweetIdStr)
    return parents


def self_reply_to(tweet: Any, tweets: list[Any], used: set[str]) -> Any | None:
    """The first of `tweets` by the author of `tweet` that replies to it and is not in `used`, or None."""
    return next(
        (
            other
            for other in tweets
            if other.user.id_str == tweet.user.id_str
            and other.inReplyToTweetIdStr == tweet.id_str
            and other.id_str not in used
        ),
        None,
    )


@operation("conversation", check_args=check_conversation_args)
async def read_conversation(api: Any, args: dict) -> dict | None:
    """One page of the conversation of a post: `{"post", "ancestors", "replies", "cursor"}`, or None.

    `post` is the post itself, `ancestors` what it answers (root first) as far as the page holds it, and `replies`
    the direct replies in the order the timeline lists them. None when X gives no such post on a first page; on a
    continuing page the post is absent as a rule and `post` is None. The cursor is the one X gives to read on, and
    None once a page holds no reply.
    """
    api_module = importlib.import_module(f"{TWSCRAPE}.api")
    variables = {
        **detail_variables(args["id"], CONVERSATION_REFERRER, with_rux_injections=True),
        "rankingMode": args["ranking"],
    }
    if args["cursor"] is not None:
        variables["cursor"] = args["cursor"]
    toggles = getattr(api_module, "ARTICLE_FIELD_TOGGLES", None)
    timeline, tweets = await read_detail_page(api, variables, toggles=toggles)
    focal = focal_of(tweets, args["id"])
    if focal is None and args["cursor"] is None:
        return None
    replies = [tweet for tweet in tweets if tweet.inReplyToTweetIdStr == args["id"]]
    cursor = (
        (api._get_cursor(timeline, BOTTOM_CURSOR) or api._get_cursor(timeline, SHOW_MORE_THREADS_CURSOR))
        if replies
        else None
    )
    return {
        "post": post_of(focal) if focal is not None else None,
        "ancestors": [post_of(tweet) for tweet in reversed(parents_of(focal, tweets))] if focal is not None else [],
        "replies": [post_of(tweet) for tweet in replies],
        "cursor": cursor,
    }


@operation("thread", check_args=check_thread_args)
async def read_thread(api: Any, args: dict) -> dict | None:
    """The thread the author of a post wrote around it: `{"posts": [...]}`, oldest first, or None without the post.

    It runs up the post's parents while the same author wrote them (as far as the page holds them) and down the
    first reply by that author at each step, in the order the timeline lists them.
    """
    variables = detail_variables(args["id"], THREAD_REFERRER, with_rux_injections=False)
    _, tweets = await read_detail_page(api, variables, ft=THREAD_FEATURES)
    focal = focal_of(tweets, args["id"])
    if focal is None:
        return None
    author = focal.user.id_str
    own_parents = itertools.takewhile(lambda parent: parent.user.id_str == author, parents_of(focal, tweets))
    thread = [*reversed(list(own_parents)), focal]
    used = {tweet.id_str for tweet in thread}
    while (follow_up := self_reply_to(thread[-1], tweets, used)) is not None:
        thread.append(follow_up)
        used.add(follow_up.id_str)
    return {"posts": [post_of(tweet) for tweet in thread]}


def check_user_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a handle of 1 to 15 letters, digits or `_`.

    The message names the argument and never repeats its value.
    """
    if set(args) != USER_ARGS:
        raise Failure("invalid_request", "args does not hold exactly handle")
    handle = args["handle"]
    if not isinstance(handle, str) or HANDLE.fullmatch(handle) is None:
        raise Failure(
            "invalid_request", f"args.handle is not a handle of 1 to {MAX_HANDLE_LENGTH} letters, digits or underscores"
        )


def user_of(user: Any) -> dict:
    """The compact dict of a twscrape `User` that the package's profile shape is built from."""
    return {
        "id": user.id_str,
        "username": user.username,
        "displayname": user.displayname,
        "description": user.rawDescription,
        "location": user.location,
        "created": iso_utc(user.created),
        "followers": user.followersCount,
        "following": user.friendsCount,
        "posts": user.statusesCount,
        "media": user.mediaCount,
        "likes": user.favouritesCount,
        "listed": user.listedCount,
        "protected": user.protected,
        "verified": user.verified,
        "blue": user.blue,
        "blue_type": user.blueType,
        "links": [link.url for link in user.descriptionLinks],
        "avatar": user.profileImageUrl,
        "banner": user.profileBannerUrl,
        "pinned": [str(post_id) for post_id in user.pinnedIds],
    }


@operation("user", check_args=check_user_args)
async def read_user(api: Any, args: dict) -> dict | None:
    """One account by handle: its compact dict, or None when X shows none (missing, suspended or deactivated)."""
    user = await api.user_by_login(args["handle"])
    return user_of(user) if user is not None else None


def check_timeline_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args` holds exactly a user id, a tab, a count and a cursor.

    The messages name the argument and never repeat its value.
    """
    if set(args) != TIMELINE_ARGS:
        raise Failure("invalid_request", "args does not hold exactly user_id, tab, count and cursor")
    user_id, tab, count = args["user_id"], args["tab"], args["count"]
    check_id_arg(user_id, "user_id", "user id")
    if not isinstance(tab, str) or tab not in TIMELINE_OPERATIONS:
        raise Failure("invalid_request", f"args.tab is not one of {', '.join(TIMELINE_OPERATIONS)}")
    check_count_arg(count)
    check_cursor_arg(args["cursor"])


def has_media(tweet: Any) -> bool:
    """Whether `tweet` holds a photo, a video or an animated gif, as twscrape's `user_media` accepts it."""
    return bool(tweet.media and (tweet.media.photos or tweet.media.videos or tweet.media.animated))


@operation("timeline", check_args=check_timeline_args)
async def read_timeline(api: Any, args: dict) -> dict:
    """One page of an account's posts, replies or media: `{"posts": [...], "cursor": str | None}`.

    The one request is made here, with the operation and variables twscrape's own reading of the tab sends (but for
    `count`): twscrape pages inside a generator. The posts are those X lists, in the order it lists them, as many as
    `count`; the `media` tab keeps only the tweets that hold media. A page without posts has no cursor.
    """
    tab = args["tab"]
    operation_id = getattr(importlib.import_module(f"{TWSCRAPE}.api"), TIMELINE_OPERATIONS[tab])
    variables = {"userId": args["user_id"], "count": args["count"], **TIMELINE_VARIABLES[tab]}
    if args["cursor"] is not None:
        variables["cursor"] = args["cursor"]
    timeline, tweets = await request_page(api, operation_id, variables, toggles=TIMELINE_TOGGLES.get(tab))
    if tab == "media":
        tweets = [tweet for tweet in tweets if has_media(tweet)]
    return paged_posts(api, timeline, tweets, args["count"])


def failure_kind(exc: Exception, twscrape: Any) -> str:
    """The reply kind of an exception an operation raised."""
    if isinstance(exc, twscrape.NoAccountError):
        return "no_account"
    if isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, tuple(getattr(twscrape, name) for name in X_ERRORS)):
        return "x_error"
    if isinstance(exc, tuple(getattr(twscrape, name) for name in PARSE_ERRORS)):
        return "parse_error"
    return "error"


def failure_of(exc: Exception, twscrape: Any, deadline: float) -> Failure:
    """The `Failure` an exception of an operation maps to."""
    kind = failure_kind(exc, twscrape)
    if kind == "timeout":
        return Failure(kind, f"the operation did not finish within {deadline:g} seconds")
    return Failure(kind, f"{type(exc).__name__}: {exc}")


async def contact(reply: dict, operate: Operation, args: dict, cookies: dict[str, str], deadline: float) -> Any:
    """Runs `operate` against X with the session in an in-memory pool; fills `contacted` and `session` of `reply`.

    Raises `Failure` for what twscrape or X answered, after the session report is in `reply`; a `Failure` the
    operation raised itself (`search_refused`) is kept as it is.
    """
    twscrape = importlib.import_module(TWSCRAPE)
    capture_warnings(importlib.import_module(f"{TWSCRAPE}.logger").logger)
    with shared_memory_pool() as pool:
        api = twscrape.API(
            pool, raise_when_no_account=True, wait_timeout=WAIT_TIMEOUT_SECONDS, wait_interval=WAIT_INTERVAL_SECONDS
        )
        await api.pool.add_account_cookies(ACCOUNT, "; ".join(f"{name}={value}" for name, value in cookies.items()))
        reply["contacted"] = True
        try:
            data = await asyncio.wait_for(operate(api, args), timeout=deadline)
        except Exception as exc:
            reply["session"] = await session_report(api)
            if isinstance(exc, Failure):
                raise
            raise failure_of(exc, twscrape, deadline) from exc
        reply["session"] = await session_report(api)
        return data


# The request


def validate(request: object) -> tuple[str, dict, float, str | None]:
    """`(op, args, deadline, refused)` of a request; raises `Failure("invalid_request")`."""
    if not isinstance(request, dict):
        raise Failure("invalid_request", "the request is not a JSON object")
    op = request.get("op")
    if not isinstance(op, str) or (op != "check" and op not in OPERATIONS):
        raise Failure("invalid_request", f"unknown operation {op!r}")
    args = request.get("args", {})
    if not isinstance(args, dict):
        raise Failure("invalid_request", "args is not an object")
    if (check_args := ARGUMENT_CHECKS.get(op)) is not None:
        check_args(args)
    deadline = request.get("deadline")
    if not isinstance(deadline, (int, float)) or isinstance(deadline, bool) or not 0 < deadline < math.inf:
        raise Failure("invalid_request", "deadline is not a positive number")
    refused = request.get("refused")
    if refused is not None and not isinstance(refused, str):
        raise Failure("invalid_request", "refused is not a string or null")
    return op, args, float(deadline), refused


def answer(request: object, reply: dict) -> dict:
    """The `data` of a request; `reply` carries the common fields and is filled as the run goes."""
    op, args, deadline, refused = validate(request)
    cookies, reply["fingerprint"] = session_cookies(request.get("cookies"))
    if op == "check":
        return check()
    if refused == reply["fingerprint"]:
        raise Failure("refused", "X refused this session earlier; the cookies have not changed")
    try:
        return asyncio.run(contact(reply, OPERATIONS[op], args, cookies, deadline))
    except Failure:
        raise
    except Exception as exc:
        raise Failure("error", f"{type(exc).__name__}: {exc}") from exc


def handle(request: object) -> dict:
    """The reply to one request: validation, cookies, fingerprint, `check` or refusal, pool, deadline, session, failure kind.

    Every string in the reply has the secrets masked. Raises nothing for a request that can be answered.
    """
    _warnings.clear()
    cookies = request.get("cookies") if isinstance(request, dict) else None
    _secrets[:] = secrets_of(cookies) if isinstance(cookies, str) else []
    reply: dict = {"fingerprint": None, "contacted": False, "session": None}
    try:
        reply.update(ok=True, data=answer(request, reply))
    except Failure as failure:
        reply.update(ok=False, kind=failure.kind, error=safe(failure.error, ERROR_LIMIT))
    reply["warnings"] = list(_warnings)
    return mask_value(json.loads(json.dumps(reply, default=str)))


# The process


def render(reply: dict) -> str:
    """The reply as one line of JSON, masked as a whole; a line that masking broke is replaced by a plain failure."""
    line = mask(json.dumps(reply))
    try:
        json.loads(line)
    except ValueError:
        line = json.dumps(
            {
                "ok": False,
                "kind": "error",
                "error": "the reply could not be rendered",
                "fingerprint": reply["fingerprint"],
                "contacted": reply["contacted"],
                "session": None,
                "warnings": [],
            }
        )
    return line


def main() -> int:
    """Reads the request from standard input, writes the reply as one line, and exits 0.

    A crash before a reply can be written exits 1 with a short masked message on standard error.
    """
    try:
        try:
            request = json.loads(sys.stdin.buffer.read())
        except ValueError:
            request = None
        line = render(handle(request))
    except Exception as exc:
        sys.stderr.write(f"the bridge crashed: {safe(f'{type(exc).__name__}: {exc}', SESSION_ERROR_LIMIT)}\n")
        return 1
    sys.stdout.write(line + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
