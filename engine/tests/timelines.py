"""Fake timeline pages for the `search`, `conversation` and `thread` operations: JSON shaped as X's answers, behind `.json()`."""


class Reply:
    """A reply of X's, as far as the bridge reads it: an object with `.json()`."""

    def __init__(self, body: dict):
        self.body = body

    def json(self) -> dict:
        return self.body


def tweet_object(id: int) -> dict:
    return {"__typename": "Tweet", "rest_id": str(id)}


def tweet_entry(id: int, prefix: str = "tweet") -> dict:
    """An entry that holds the tweet `id`, with the id in its entry id as X writes it."""
    return {
        "entryId": f"{prefix}-{id}",
        "sortIndex": str(id),
        "content": {
            "entryType": "TimelineTimelineItem",
            "itemContent": {"itemType": "TimelineTweet", "tweet_results": {"result": tweet_object(id)}},
        },
    }


def user_entry(id: int, prefix: str = "user") -> dict:
    """An entry that holds the user `id`, with the id in its entry id as X writes it in a people search."""
    return {
        "entryId": f"{prefix}-{id}",
        "sortIndex": str(id),
        "content": {
            "entryType": "TimelineTimelineItem",
            "itemContent": {
                "itemType": "TimelineUser",
                "user_results": {"result": {"__typename": "User", "rest_id": str(id)}},
            },
        },
    }


def module_entry(*ids: int) -> dict:
    """A module entry, which twscrape's `_gql_entries` leaves out, holding the tweets `ids`."""
    return {
        "entryId": "module-1",
        "content": {
            "entryType": "TimelineTimelineModule",
            "items": [{"item": {"itemContent": {"tweet_results": {"result": tweet_object(id)}}}} for id in ids],
        },
    }


def cursor_entry(value: str, cursor_type: str = "Bottom") -> dict:
    return {
        "entryId": f"cursor-{cursor_type.lower()}-1",
        "content": {"entryType": "TimelineTimelineCursor", "value": value, "cursorType": cursor_type},
    }


def page(*entries: dict) -> Reply:
    """A page whose timeline lists `entries` in one `TimelineAddEntries` instruction."""
    instructions = [{"type": "TimelineAddEntries", "entries": list(entries)}]
    return Reply({"data": {"search_by_raw_query": {"search_timeline": {"timeline": {"instructions": instructions}}}}})
