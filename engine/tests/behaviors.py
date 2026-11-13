"""The fake X operation the tests register on the bridge; its arguments script what it does.

Arguments, all optional and applied in this order: `warn` (lines for twscrape's logger), `inactive` (a message,
marks the session inactive), `locks` (queue → seconds from now, negative for the past), `sleep` (seconds),
`raise` (the name of a twscrape or builtin exception) with `message`, and `return` (the data).
"""

import asyncio
import builtins
import importlib
import time

OPERATION = "scripted"


def exception_named(name: str) -> type[Exception]:
    """The twscrape exception `name`, or the builtin one."""
    twscrape = importlib.import_module("twscrape")
    return getattr(twscrape, name, None) or getattr(builtins, name)


def install(bridge) -> None:
    """Registers the scripted operation on `bridge`."""

    @bridge.operation(OPERATION)
    async def scripted(api, args):
        logger = importlib.import_module("twscrape.logger").logger
        for line in args.get("warn", []):
            logger.warning(line)
        if "inactive" in args:
            await api.pool.mark_inactive(bridge.ACCOUNT, args["inactive"])
        for queue, seconds in args.get("locks", {}).items():
            await api.pool.lock_until(bridge.ACCOUNT, queue, int(time.time() + seconds))
        if "sleep" in args:
            await asyncio.sleep(args["sleep"])
        if "raise" in args:
            raise exception_named(args["raise"])(args.get("message", "boom"))
        return args.get("return")
