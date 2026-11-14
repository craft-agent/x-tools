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
# A post id: decimal digits only (not `\d`, which takes other scripts' digits), as X's ids are.
POST_ID = re.compile(r"[0-9]{1,20}")
VIDEO_MP4 = "video/mp4"
MILLISECONDS = 1000

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


def check_post_args(args: dict) -> None:
    """Raises `Failure("invalid_request")` unless `args.id` is a decimal string of 1 to 20 digits."""
    post_id = args.get("id")
    if not isinstance(post_id, str) or POST_ID.fullmatch(post_id) is None:
        raise Failure("invalid_request", "args.id is not a post id of 1 to 20 digits")


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

    Raises `Failure` for what twscrape or X answered, after the session report is in `reply`.
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
