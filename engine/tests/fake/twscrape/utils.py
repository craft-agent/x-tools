"""The fake utils: the two lookups of twscrape 0.21.0 that read a timeline's JSON, with the same contract."""

from typing import Any, Callable

_MISSING = object()


def find_obj(obj: Any, fn: Callable[[dict], bool]) -> Any | None:
    """The first dict, depth first, that `fn` accepts; None when `obj` is not a dict or holds none."""
    if not isinstance(obj, dict):
        return None
    if fn(obj):
        return obj
    for value in obj.values():
        for child in value if isinstance(value, list) else [value]:
            if found := find_obj(child, fn):
                return found
    return None


def get_by_path(obj: dict, key: str, default: Any = None) -> Any:
    """The value of the first `key` found, depth first, through dicts and lists; `default` when there is none."""
    for name, value in obj.items():
        if name == key:
            return value
        for child in value if isinstance(value, list) else [value]:
            if isinstance(child, dict) and (found := get_by_path(child, key, _MISSING)) is not _MISSING:
                return found
    return default
