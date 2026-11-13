"""The fake database module: `aiosqlite.connect` is looked up when a connection opens, as in twscrape.

It opens a plain `sqlite3` connection, so a name that is a URI creates a file unless `uri=True` is passed.
"""

import sqlite3
import types

aiosqlite = types.SimpleNamespace(connect=sqlite3.connect)
