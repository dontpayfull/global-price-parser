"""Find normalized price numbers, their currencies, signs, units and ranges."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .currency import TokenMatch, is_letter, token_after, token_before
from .types import Per
from .units import read_per

NUMBER = re.compile(r"(?:(?<![0-9.,])[.,](?=[0-9]{1,2}(?![0-9.,'])))?[0-9]+(?:(?:[.,']|| (?=[0-9]{3}(?![0-9])))[0-9]+)*(?:[.,]-{1,2}(?![0-9])| [0-9]{2}(?![0-9]|[.,][0-9]))?")
PERCENT = re.compile(r"^ ?[%‰]")
MAX_GAP = 2


@dataclass
class Found:
    number: str
    num_start: int
    num_end: int
    token: TokenMatch | None
    minus: int
    start: int
    end: int
    range: str | None
    per: Per | None


@dataclass(frozen=True)
class Raw:
    number: str
    num_start: int
    num_end: int
    left: TokenMatch | None
    right: TokenMatch | None
    minus_num: int
    minus_tok: int


def skip_spaces_back(text: str, pos: int) -> int:
    p = pos
    while p > 0 and pos - p < MAX_GAP and text[p - 1] == " ":
        p -= 1
    return p


def skip_spaces(text: str, pos: int) -> int:
    p = pos
    while p < len(text) and p - pos < MAX_GAP and text[p] == " ":
        p += 1
    return p


def scan(text: str, languages: list[str] | None = None) -> list[Found]:
    raws: list[Raw] = []
    for match in NUMBER.finditer(text):
        num_start, num_end = match.span()
        if PERCENT.match(text[num_end:num_end + 2]):
            continue
        if num_start > 0 and (is_letter(text[num_start - 1]) or "0" <= text[num_start - 1] <= "9") and not token_before(text, num_start):
            continue

        def dash_before(pos: int) -> int:
            q = pos - 1 if pos > 0 and text[pos - 1] == " " else pos
            return q - 1 if q > 0 and text[q - 1] == "-" else -1

        def free_dash(dash: int) -> bool:
            return dash == 0 or bool(re.match(r"[\s:(\-]", text[dash - 1]))

        minus_num = -1
        left: TokenMatch | None = None
        dash = dash_before(num_start)
        if dash >= 0:
            before_dash = token_before(text, skip_spaces_back(text, dash))
            if before_dash:
                left, minus_num = before_dash, dash
            elif free_dash(dash):
                minus_num = dash
        if not left:
            left = token_before(text, skip_spaces_back(text, minus_num if minus_num >= 0 else num_start))
        minus_tok = -1
        if left and minus_num < 0:
            d = dash_before(left.start)
            if d >= 0 and free_dash(d):
                minus_tok = d
        right = token_after(text, skip_spaces(text, num_end))
        raws.append(Raw(match[0], num_start, num_end, left, right, minus_num, minus_tok))

    claimed: set[int] = set()
    found: list[Found] = []
    for i, raw in enumerate(raws):
        def free(token: TokenMatch | None) -> bool:
            return token is not None and token.start not in claimed

        right = raw.right if free(raw.right) else None
        if right and i + 1 < len(raws):
            following = raws[i + 1]
            if following.left and following.left.start == right.start:
                before = right.start - raw.num_end
                after = following.num_start - right.end
                if after < before or (after == before == 0 and not following.right):
                    right = None
        token: TokenMatch | None = None
        if free(raw.left) and not raw.left.weak:
            token = raw.left
        elif right and not right.weak:
            token = right
        elif free(raw.left):
            token = raw.left
        elif right:
            token = right
        if token:
            claimed.add(token.start)
        minus = raw.minus_tok if token is raw.left and raw.minus_tok >= 0 else raw.minus_num
        start = min(raw.num_start, token.start if token else raw.num_start, minus if minus >= 0 else raw.num_start)
        end = max(raw.num_end, token.end if token else 0)
        unit = read_per(text[end:end + 24], languages or [])
        found.append(Found(
            raw.number, raw.num_start, raw.num_end, token, minus, start,
            end + unit.length if unit else end, None, unit.per if unit else None,
        ))

    # A range shares the same currency, but its separator is not a minus sign.
    for a, b in zip(found, found[1:]):
        gap_end = min(b.num_start, b.token.start if b.token else b.num_start) if b.minus >= 0 else b.start
        gap = text[a.end:gap_end]
        tight = bool(re.fullmatch(r"[-~]", gap))
        spaced = bool(re.fullmatch(r" *[-~] *", gap))
        even = bool(re.fullmatch(r" +[-~] +", gap))
        if not (((tight or even) and (a.token or b.token)) or (spaced and a.token and not a.token.weak)):
            continue
        if b.minus >= 0:
            b.start = min(b.num_start, b.token.start if b.token else b.num_start)
            b.minus = -1
        a.range, b.range = "from", "to"
        if a.token and a.token.weak and b.token and not b.token.weak and a.token.start < a.num_start:
            a.token = None
            a.start = min(a.minus, a.num_start) if a.minus >= 0 else a.num_start
        if not a.token and b.token:
            a.token = b.token
        elif a.token and not b.token:
            b.token = a.token
    return found
