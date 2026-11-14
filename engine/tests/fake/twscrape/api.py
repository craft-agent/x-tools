"""The fake API: it records how it was built, holds the pool and answers `tweet_details` from a script."""

from .accounts_pool import AccountsPool
from .models import Tweet

CONSTRUCTED: list[dict] = []
# The tweets `tweet_details` answers with, by id; an id that is not here is a tweet X does not give.
TWEETS: dict[int, Tweet] = {}
# The ids `tweet_details` was asked for, in order.
TWEET_DETAILS: list[int] = []


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
