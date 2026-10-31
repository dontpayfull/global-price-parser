"""Read localized unit forms immediately after a price."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from ._data import load_data
from .types import Per

_UNITS = load_data("units.json")
UNIT_FORMS: dict[str, str] = _UNITS["global"]
LANGUAGE_UNIT_FORMS: dict[str, dict[str, str]] = _UNITS["language"]


def strip(s: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", s) if not unicodedata.category(char).startswith("M"))


PLAIN: dict[str, str | None] = {}
for _form, _unit in UNIT_FORMS.items():
    _plain = strip(_form)
    if _plain == _form:
        continue
    PLAIN[_plain] = _unit if _plain not in PLAIN or PLAIN[_plain] == _unit else None


@dataclass(frozen=True)
class PerReading:
    per: Per
    length: int


def lookup(form: str, languages: list[str]) -> str | None:
    meanings = {LANGUAGE_UNIT_FORMS.get(language, {}).get(form) for language in languages} - {None}
    if len(meanings) > 1:
        return None
    return next(iter(meanings), None) or UNIT_FORMS.get(form) or PLAIN.get(form)


def _unit_char(char: str) -> bool:
    return unicodedata.category(char)[0] in "LM" or char in "²³"


def read_per(after: str, languages: list[str]) -> PerReading | None:
    prefix = re.match(r" ?/ ?(?:([0-9]{1,4}) ?)?", after)
    if not prefix:
        return None
    start = prefix.end()
    end = start
    while end < len(after) and _unit_char(after[end]):
        end += 1
    if end == start:
        return None
    def boundary(pos: int) -> bool:
        return pos == len(after) or not (unicodedata.category(after[pos])[0] in "LM" or "0" <= after[pos] <= "9")

    # The greedy unit and its optional dot backtrack until the regex boundary succeeds.
    # Superscript digits are unit characters, but are not forbidden at that boundary.
    while end > start:
        if end < len(after) and after[end] == "." and boundary(end + 1):
            end += 1
            break
        if boundary(end):
            break
        end -= 1
    if end == start:
        return None
    raw = after[start:end].lower()
    unit = lookup(raw, languages) or (lookup(raw[:-1], languages) if raw.endswith(".") else None)
    if not unit:
        return None
    return PerReading(Per(unit, int(prefix.group(1)) if prefix.group(1) else 1), end)
