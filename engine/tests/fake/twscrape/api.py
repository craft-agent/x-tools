"""The fake API: it records how it was built and holds the pool."""

from .accounts_pool import AccountsPool

CONSTRUCTED: list[dict] = []


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
