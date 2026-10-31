"""Currency codes, decimal precision and longest-token matching."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from ._data import load_data

_CURRENCIES = load_data("currencies.json")
_TOKENS = load_data("tokens.json")
CURRENCY_CODES: set[str] = set(_CURRENCIES["codes"])
CURRENCY_DIGITS: dict[str, int] = _CURRENCIES["digits"]
REGION_CURRENCIES: dict[str, list[str]] = _CURRENCIES["regions"]
CURRENCY_TOKENS: dict[str, list[str]] = _TOKENS["tokens"]
WEAK_TOKENS: set[str] = set(_TOKENS["weak"])
MAX_TOKEN = max(3, *(len(token) for token in CURRENCY_TOKENS))


@dataclass(frozen=True)
class TokenMatch:
    text: str
    start: int
    end: int
    candidates: list[str]
    iso: bool
    weak: bool


def is_letter(char: str) -> bool:
    return bool(char) and unicodedata.category(char).startswith("L")


def is_alpha(candidate: str) -> bool:
    body = candidate[:-1] if candidate.endswith(".") else candidate
    return bool(body) and all(is_letter(char) for char in body)


NO_DOT: dict[str, str] = {}
WORDS: dict[str, str] = {}
for _token in CURRENCY_TOKENS:
    if len(_token) > 2 and _token.endswith(".") and _token[:-1] not in CURRENCY_TOKENS:
        NO_DOT[_token[:-1]] = _token
    if is_alpha(_token) and len(_token.removesuffix(".")) >= 3:
        WORDS.setdefault(_token.lower(), _token)


def decimals_of(code: str) -> int:
    return CURRENCY_DIGITS.get(code, 2)


def is_currency_code(code: str) -> bool:
    return code in CURRENCY_CODES


def currencies_of_region(region: str) -> list[str]:
    r = region.upper()
    return REGION_CURRENCIES.get("GB" if r == "UK" else r, [])


def is_region(region: str) -> bool:
    return bool(currencies_of_region(region))


def lookup(candidate: str) -> tuple[str, list[str], bool] | None:
    if re.fullmatch(r"[A-Z]{3}", candidate) and candidate in CURRENCY_CODES:
        return candidate, [candidate], True
    key = candidate if candidate in CURRENCY_TOKENS else NO_DOT.get(candidate)
    if key:
        return key, CURRENCY_TOKENS[key], False
    word = WORDS.get(candidate.lower()) if is_alpha(candidate) else None
    return (word, CURRENCY_TOKENS[word], False) if word else None


def make(text: str, start: int, end: int, found: tuple[str, list[str], bool]) -> TokenMatch:
    raw = text[start:end]
    weak = not found[2] and (found[0] in WEAK_TOKENS or bool(re.fullmatch(r"[A-Za-z]", raw)))
    return TokenMatch(raw, start, end, found[1], found[2], weak)


def token_before(text: str, end: int) -> TokenMatch | None:
    for length in range(min(MAX_TOKEN, end), 0, -1):
        start = end - length
        candidate = text[start:end]
        if is_letter(candidate[0]) and start > 0 and is_letter(text[start - 1]):
            continue
        found = lookup(candidate)
        if found:
            return make(text, start, end, found)
    return None


def token_after(text: str, start: int) -> TokenMatch | None:
    for length in range(min(MAX_TOKEN, len(text) - start), 0, -1):
        end = start + length
        candidate = text[start:end]
        if is_letter(candidate[-1]) and end < len(text) and is_letter(text[end]):
            continue
        found = lookup(candidate)
        if found:
            return make(text, start, end, found)
    return None
