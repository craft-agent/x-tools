"""What the `trends` tests share: the timeline ids, the Explore replies as X writes them and the invalid arguments."""

from timelines import Reply

TRENDS_ARGS = {"category": "trending", "count": 20, "cursor": None}
TIMELINE_IDS = {
    "trending": "VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=",
    "news": "VGltZWxpbmU6DAC2CwABAAAABG5ld3MAAA==",
    "sports": "VGltZWxpbmU6DAC2CwABAAAABnNwb3J0cwAA",
    "entertainment": "VGltZWxpbmU6DAC2CwABAAAADWVudGVydGFpbm1lbnQAAA==",
}


def trend_object(name: object, **fields) -> dict:
    """The `itemContent` of a trend named `name`, with `fields` beside the name."""
    return {"__typename": "TimelineTrend", "itemType": "TimelineTrend", "name": name, **fields}


def trend_entry(name: object, **fields) -> dict:
    """A top-level entry that holds one trend."""
    return {
        "entryId": f"trend-{name}",
        "content": {"entryType": "TimelineTimelineItem", "itemContent": trend_object(name, **fields)},
    }


def module_entry(*contents: dict, entry_id: str = "stories-1") -> dict:
    """A module entry whose items hold `contents`."""
    items = [{"entryId": f"{entry_id}-{n}", "item": {"itemContent": content}} for n, content in enumerate(contents)]
    return {"entryId": entry_id, "content": {"entryType": "TimelineTimelineModule", "items": items}}


def request_param_url(*params: tuple[str, object]) -> dict:
    """A `trend_url` whose endpoint options hold `params` as `{key, value}` pairs."""
    return {
        "url": "twitter://search/?src=trend_click",
        "urtEndpointOptions": {"requestParams": [{"key": key, "value": value} for key, value in params]},
    }


def explore_page(*entries: dict) -> Reply:
    """A reply whose `data.timeline.timeline` lists `entries` in one `TimelineAddEntries` instruction."""
    instructions = [{"type": "TimelineClearCache"}, {"type": "TimelineAddEntries", "entries": list(entries)}]
    return Reply({"data": {"timeline": {"timeline": {"instructions": instructions}}}})


# Replies with no timeline in `data.timeline.timeline`, which the bridge cannot read.
UNREADABLE_BODIES = {
    "no data": {},
    "null data": {"data": None},
    "no timeline": {"data": {}},
    "a text timeline": {"data": {"timeline": "none"}},
    "no inner timeline": {"data": {"timeline": {}}},
    "a null inner timeline": {"data": {"timeline": {"timeline": None}}},
    "a list as inner timeline": {"data": {"timeline": {"timeline": []}}},
}
# The limits themselves, which are taken.
LIMIT_ARGS = {
    "a count of 1": {"count": 1},
    "a count of 50": {"count": 50},
    "a cursor of 2000 characters": {"cursor": "c" * 2000},
    "a cursor of 1 character": {"cursor": "c"},
}


def trends_cases() -> dict[str, tuple[dict, str | None]]:
    """Invalid arguments of `trends`, each with the value a reply must not echo."""
    valid = TRENDS_ARGS
    return {
        "no arguments": ({}, None),
        "an extra key": ({**valid, "id": "12345"}, "12345"),
        "a missing cursor": ({key: value for key, value in valid.items() if key != "cursor"}, None),
        "no category": ({**valid, "category": None}, None),
        "a number as category": ({**valid, "category": 1}, None),
        "twscrape's name for sports": ({**valid, "category": "sport"}, None),
        "another category": ({**valid, "category": "Politics-secret"}, "Politics-secret"),
        "a count of 0": ({**valid, "count": 0}, None),
        "a count of 51": ({**valid, "count": 51}, None),
        "a boolean count": ({**valid, "count": True}, None),
        "a text count": ({**valid, "count": "7"}, None),
        "an empty cursor": ({**valid, "cursor": ""}, None),
        "a cursor of 2001 characters": ({**valid, "cursor": "c" * 2001}, "c" * 2001),
        "a number as cursor": ({**valid, "cursor": 5}, None),
    }
