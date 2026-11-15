"""What the `community`, `community_posts` and `community_members` tests share: a made-up community id, the replies
that hold no community and the invalid arguments."""

from timelines import Reply

COMMUNITY_ID = "1501272736215322629"
POSTS_ARGS = {"id": COMMUNITY_ID, "ranking": "Relevance", "count": 20, "cursor": None}
MEMBERS_ARGS = {"id": COMMUNITY_ID, "count": 20, "cursor": None}
# The replies that give no community to this account: no `data`, a null or empty result, an unavailable community.
NO_COMMUNITY_BODIES = {
    "no data": {},
    "null data": {"data": None},
    "no community results": {"data": {}},
    "null community results": {"data": {"communityResults": None}},
    "no result": {"data": {"communityResults": {}}},
    "a null result": {"data": {"communityResults": {"result": None}}},
    "an empty result": {"data": {"communityResults": {"result": {}}}},
    "an unavailable community": {
        "data": {"communityResults": {"result": {"__typename": "CommunityUnavailable", "reason": "Suspended"}}}
    },
}
# A result of a type that is no community, which the bridge cannot read.
UNREADABLE_REPLY = Reply({"data": {"communityResults": {"result": {"__typename": "Tweet", "rest_id": "1"}}}})
# The limits themselves, which are taken.
LIMIT_ARGS = {
    "an id of 1 digit": {"id": "7"},
    "an id of 20 digits": {"id": "7" * 20},
    "a count of 1": {"count": 1},
    "a count of 50": {"count": 50},
    "a cursor of 2000 characters": {"cursor": "c" * 2000},
    "a cursor of 1 character": {"cursor": "c"},
}


def id_cases(valid: dict) -> dict[str, tuple[dict, str | None]]:
    """Invalid arguments around `valid` (which holds an id), each with the value a reply must not echo."""
    return {
        "no arguments": ({}, None),
        "an extra key": ({**valid, "direction": "followers"}, "followers"),
        "no id": ({**valid, "id": None}, None),
        "a number as id": ({**valid, "id": int(COMMUNITY_ID)}, None),
        "an empty id": ({**valid, "id": ""}, None),
        "an id of 21 digits": ({**valid, "id": "1" * 21}, "1" * 21),
        "an id with letters": ({**valid, "id": "15x0"}, "15x0"),
        "an id with other digits": ({**valid, "id": "١٥٠٠"}, "١٥٠٠"),
    }


def page_cases(valid: dict) -> dict[str, tuple[dict, str | None]]:
    """Invalid arguments around `valid` (which holds an id, a count and a cursor), each with the value not to echo."""
    return {
        **id_cases(valid),
        "a missing cursor": ({key: value for key, value in valid.items() if key != "cursor"}, None),
        "a count of 0": ({**valid, "count": 0}, None),
        "a count of 51": ({**valid, "count": 51}, None),
        "a boolean count": ({**valid, "count": True}, None),
        "a text count": ({**valid, "count": "7"}, None),
        "an empty cursor": ({**valid, "cursor": ""}, None),
        "a cursor of 2001 characters": ({**valid, "cursor": "c" * 2001}, "c" * 2001),
        "a number as cursor": ({**valid, "cursor": 5}, None),
    }


def posts_cases() -> dict[str, tuple[dict, str | None]]:
    """Invalid arguments of `community_posts`: those of a page, and a ranking that is none of the two."""
    return {
        **page_cases(POSTS_ARGS),
        "no ranking": ({**POSTS_ARGS, "ranking": None}, None),
        "a ranking of another name": ({**POSTS_ARGS, "ranking": "Top-secret"}, "Top-secret"),
        "a number as ranking": ({**POSTS_ARGS, "ranking": 1}, None),
    }
