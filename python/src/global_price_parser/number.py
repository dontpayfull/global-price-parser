"""Read a normalized number using the reference two-decimals rule."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .normalize import DECIMAL_MARK

GROUP_ONLY = {" ", "'"}


@dataclass(frozen=True)
class NumberContext:
    three_decimals: bool = False
    currency_known: bool = False


@dataclass(frozen=True)
class AlternativeReading:
    reason: str
    integer: str
    fraction: str


@dataclass(frozen=True)
class NumberReading:
    integer: str
    fraction: str
    ambiguous: AlternativeReading | None = None


def strip_zeros(digits: str) -> str:
    return re.sub(r"^0+(?=[0-9])", "", digits) or "0"


def valid_grouping(groups: list[str], seps: list[str]) -> bool:
    if len(groups) < 2:
        return True
    if len(set(seps)) != 1:
        return False
    first, *rest = groups
    if not 1 <= len(first) <= 3:
        return False
    if all(len(group) == 3 for group in rest):
        return True
    return (
        seps[0] == "," and len(first) <= 2 and len(rest[-1]) == 3
        and all(len(group) == 2 for group in rest[:-1])
    )


def reading(int_groups: list[str], fraction: str) -> tuple[str, str]:
    return strip_zeros("".join(int_groups)), fraction


def parse_number(raw: str, ctx: NumberContext | None = None) -> NumberReading | None:
    ctx = ctx or NumberContext()
    s = raw
    dz = re.search(r"[.,]-{1,2}\Z", s)
    dash_zero = dz is not None
    if dz:
        s = s[:dz.start()]

    if DECIMAL_MARK in s:
        parts = s.split(DECIMAL_MARK)
        if len(parts) != 2:
            return None
        int_part, frac_part = parts
        if not re.fullmatch(r"[0-9][0-9.,' ]*", int_part) or not re.fullmatch(r"[0-9]+", frac_part):
            return None
        integer, fraction = reading([re.sub(r"[^0-9]", "", int_part)], frac_part)
        return NumberReading(integer, fraction)

    if re.fullmatch(r"[.,][0-9]+", s):
        return NumberReading("0", s[1:])

    parts = re.findall(r"[0-9]+|[.,' ]", s)
    if not parts or "".join(parts) != s or not re.match(r"[0-9]", s) or not re.search(r"[0-9]\Z", s):
        return None
    groups: list[str] = []
    seps: list[str] = []
    for i, part in enumerate(parts):
        is_digits = "0" <= part[0] <= "9"
        if is_digits != (i % 2 == 0):
            return None
        (groups if is_digits else seps).append(part)

    def done(result: tuple[str, str], amb: AlternativeReading | None = None) -> NumberReading:
        return NumberReading(result[0], "" if dash_zero else result[1], None if dash_zero else amb)

    if not seps:
        return done(reading(groups, ""))
    marks = [sep for sep in seps if sep not in GROUP_ONLY]
    kinds = set(marks)
    last, last_group = seps[-1], groups[-1]
    int_groups, int_seps = groups[:-1], seps[:-1]

    # Cents after a space, as when superscripts lose their markup.
    if last == " " and len(last_group) == 2 and not marks and valid_grouping(int_groups, int_seps):
        return done(reading(int_groups, last_group))
    if not kinds:
        return done(reading(groups, "")) if valid_grouping(groups, seps) else None
    if len(kinds) == 2:
        if last in GROUP_ONLY or marks.index(last) != len(marks) - 1:
            return None
        return done(reading(int_groups, last_group)) if valid_grouping(int_groups, int_seps) else None

    mark = marks[0]
    if last != mark:
        return done(reading(groups, "")) if valid_grouping(groups, seps) else None
    if len(marks) > 1:
        if valid_grouping(groups, seps):
            return done(reading(groups, ""))
        if len(last_group) != 3 and valid_grouping(int_groups, int_seps):
            return done(
                reading(int_groups, last_group),
                AlternativeReading("irregular-grouping", strip_zeros("".join(groups)), ""),
            )
        return None

    has_space_groups = any(sep in GROUP_ONLY for sep in seps)
    first = groups[0]
    if has_space_groups:
        return done(reading(int_groups, last_group)) if valid_grouping(int_groups, int_seps) else None
    if len(last_group) != 3 or first == "0" or len(first) > 3 or ctx.three_decimals:
        return done(reading(int_groups, last_group))
    as_thousands = reading(groups, "")
    if ctx.currency_known:
        return done(as_thousands)
    alt = reading(int_groups, last_group)
    return done(as_thousands, AlternativeReading("separator", alt[0], alt[1]))


def format_amount(integer: str, fraction: str, decimals: int, negative: bool = False) -> str:
    f = fraction
    if len(f) < decimals:
        f = f.ljust(decimals, "0")
    elif len(f) > decimals and re.fullmatch(r"0*", f[decimals:]):
        f = f[:decimals]
    body = f"{integer}.{f}" if f else integer
    return f"-{body}" if negative and re.search(r"[1-9]", body) else body
