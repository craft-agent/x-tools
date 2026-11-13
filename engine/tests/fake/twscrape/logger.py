"""The fake logger: loguru's `add`, `remove` and level methods, with twscrape's stderr sink installed at import."""

import sys

LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}


class Logger:
    """Sinks receive the message and a newline, as loguru's formatted records do."""

    def __init__(self):
        self.sinks: list[tuple] = []

    def add(self, sink, level="DEBUG", format=None):
        self.sinks.append((sink, LEVELS[level]))
        return len(self.sinks)

    def remove(self, handler_id=None):
        self.sinks.clear()

    def log(self, level: str, message: str):
        for sink, minimum in list(self.sinks):
            if LEVELS[level] >= minimum:
                sink(f"{message}\n")

    def info(self, message: str):
        self.log("INFO", message)

    def warning(self, message: str):
        self.log("WARNING", message)


logger = Logger()
logger.remove()
logger.add(sys.stderr.write, level="INFO")
