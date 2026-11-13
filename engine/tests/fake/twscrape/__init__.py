"""A stand-in for twscrape 0.21.0 that mirrors only the surface the bridge uses, under the real names."""

from .accounts_pool import AccountsPool, NoAccountError
from .api import API


class AbortReqError(Exception):
    """A request X answered with an error."""


class GqlFeaturesOutdatedError(AbortReqError):
    """twscrape's query features no longer match X's."""


class ApiError(AbortReqError):
    """X answered with errors and without data."""

    def __init__(self, msg: str, errors: list[str] | None = None):
        super().__init__(msg)
        self.errors = errors or []


class XClIdParseError(Exception):
    """twscrape could not read the transaction-id script."""


class ParseError(Exception):
    """X sent an object that twscrape can't parse."""


class UserParseError(ParseError):
    """X sent a user that twscrape can't parse."""
