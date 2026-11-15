"""What the `list_posts` and `list_members` tests share: a made-up list id, valid arguments and the invalid ones."""

LIST_ID = "1700000000000000001"
VALID_ARGS = {"id": LIST_ID, "count": 20, "cursor": None}
# The replies that hold no timeline of the list's: no `data`, no `list`, a null or empty one.
NO_LIST_BODIES = {
    "no data": {},
    "null data": {"data": None},
    "no list": {"data": {}},
    "a null list": {"data": {"list": None}},
    "an empty list": {"data": {"list": {}}},
}
# The limits themselves, which are taken.
LIMIT_ARGS = {
    "an id of 1 digit": {"id": "7"},
    "an id of 20 digits": {"id": "7" * 20},
    "a count of 1": {"count": 1},
    "a count of 50": {"count": 50},
    "a cursor of 2000 characters": {"cursor": "c" * 2000},
    "a cursor of 1 character": {"cursor": "c"},
}


def invalid_cases() -> dict[str, tuple[dict, str | None]]:
    """Invalid arguments, each with the value a reply must not echo (None when there is none)."""
    missing = {key: value for key, value in VALID_ARGS.items() if key != "cursor"}
    return {
        "no arguments": ({}, None),
        "a missing cursor": (missing, None),
        "an extra key": ({**VALID_ARGS, "direction": "followers"}, "followers"),
        "no id": ({**VALID_ARGS, "id": None}, None),
        "a number as id": ({**VALID_ARGS, "id": int(LIST_ID)}, None),
        "an empty id": ({**VALID_ARGS, "id": ""}, None),
        "an id of 21 digits": ({**VALID_ARGS, "id": "1" * 21}, "1" * 21),
        "an id with letters": ({**VALID_ARGS, "id": "17x0"}, "17x0"),
        "an id with other digits": ({**VALID_ARGS, "id": "١٧٠٠"}, "١٧٠٠"),
        "a count of 0": ({**VALID_ARGS, "count": 0}, None),
        "a count of 51": ({**VALID_ARGS, "count": 51}, None),
        "a boolean count": ({**VALID_ARGS, "count": True}, None),
        "a text count": ({**VALID_ARGS, "count": "7"}, None),
        "an empty cursor": ({**VALID_ARGS, "cursor": ""}, None),
        "a cursor of 2001 characters": ({**VALID_ARGS, "cursor": "c" * 2001}, "c" * 2001),
        "a number as cursor": ({**VALID_ARGS, "cursor": 5}, None),
    }
