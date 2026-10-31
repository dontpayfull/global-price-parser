"""Load the shared, generated CLDR tables shipped with the package."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=None)
def load_data(name: str) -> dict[str, Any]:
    with (Path(__file__).with_name("data") / name).open(encoding="utf-8") as source:
        return json.load(source)
