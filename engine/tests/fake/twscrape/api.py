"""The fake API: it records how it was built, holds the pool and answers `tweet_details` and `_gql_item` from a script."""

from .accounts_pool import AccountsPool
from .models import Tweet
from .utils import find_obj, get_by_path

OP_SearchTimeline = "vLHjqbDv7TPFMBkIIO1nOA/SearchTimeline"
OP_TweetDetail = "dQDdKtt882nl-Km98FJGSQ/TweetDetail"
ARTICLE_FIELD_TOGGLES = {
    "withArticleRichContentState": True,
    "withArticlePlainText": False,
    "withArticleSummaryText": True,
    "withArticleVoiceOver": True,
    "withGrokAnalyze": False,
    "withDisallowedReplyControls": False,
}

CONSTRUCTED: list[dict] = []
# The tweets `tweet_details` answers with, by id; an id that is not here is a tweet X does not give.
# `parse_tweets` finds the tweets of a timeline here too.
TWEETS: dict[int, Tweet] = {}
# The ids `tweet_details` was asked for, in order.
TWEET_DETAILS: list[int] = []
# What `_gql_item` was asked, in order: `{"op", "kv", "ft", "toggles"}`.
GQL_ITEMS: list[dict] = []
# What `_gql_item` answers with: an object with `.json()`, or None as when no account is usable.
GQL_REPLY: object | None = None
# An exception `_gql_item` raises instead of answering.
GQL_ERROR: Exception | None = None


class API:
    """Builds the pool from a database name, as twscrape's API does."""

    def __init__(self, pool=None, debug=False, proxy=None, raise_when_no_account=False, wait_timeout=None,
                 wait_interval=5.0):
        CONSTRUCTED.append(
            {"pool": pool, "raise_when_no_account": raise_when_no_account, "wait_timeout": wait_timeout,
             "wait_interval": wait_interval}
        )
        self.pool = pool if isinstance(pool, AccountsPool) else AccountsPool(
            db_file=pool, raise_when_no_account=raise_when_no_account, wait_timeout=wait_timeout,
            wait_interval=wait_interval,
        )

    async def tweet_details(self, twid: int, kv=None) -> Tweet | None:
        TWEET_DETAILS.append(twid)
        return TWEETS.get(twid)

    async def _gql_item(self, op: str, kv: dict, ft: dict | None = None, toggles: dict | None = None):
        GQL_ITEMS.append({"op": op, "kv": kv, "ft": ft, "toggles": toggles})
        if GQL_ERROR is not None:
            raise GQL_ERROR
        return GQL_REPLY

    def _get_cursor(self, obj: dict, cursor_type="Bottom") -> str | None:
        cur = find_obj(obj, lambda x: x.get("cursorType") == cursor_type)
        value = cur.get("value") if cur else get_by_path(obj, "next_cursor")
        return value if isinstance(value, str) else None

    def _gql_entries(self, obj: dict) -> list:
        els = get_by_path(obj, "entries") or get_by_path(obj, "items_results") or []
        if els and "entryId" in (els[0] or {}):
            els = [
                x
                for x in els
                if not x["entryId"].startswith(("cursor-", "messageprompt-", "module-", "who-to-follow-"))
            ]
        return els
