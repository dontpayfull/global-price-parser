"""Normalize price digits, separators and invisible controls."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ._data import load_data

# The HTML reader inserts this before <sup>99</sup> cents.
DECIMAL_MARK = ""
DIGIT_ZEROS: list[int] = load_data("digits.json")["zeros"]
BIDI = re.compile(r"[؜​-‏‪-‮⁠⁦-⁩﻿]")
MINUS = re.compile(r"[−‒–—﹣－]")
SPACE = re.compile(r"[     - 　]")


@dataclass(frozen=True)
class Normalized:
    text: str
    map: list[int]


def digit_of(cp: int) -> str | None:
    if 0x30 <= cp <= 0x39:
        return chr(cp)
    if cp < 0x660:
        return None
    for zero in DIGIT_ZEROS:
        if zero <= cp <= zero + 9:
            return str(cp - zero)
        if zero > cp:
            break
    return None


def ascii_digits(s: str) -> str:
    """Convert Unicode decimal digits without changing anything else."""
    return "".join(digit_of(ord(char)) or char for char in s)


def normalize(input: str) -> Normalized:
    """Normalize without losing the original Python character offsets."""
    text: list[str] = []
    positions: list[int] = []
    for i, ch in enumerate(input):
        digit = digit_of(ord(ch))
        if digit is not None:
            out = digit
        elif ch == "٫":
            out = "."
        elif ch == "٬":
            out = ","
        elif BIDI.search(ch):
            out = ""
        elif MINUS.search(ch):
            out = "-"
        elif SPACE.search(ch):
            out = " "
        elif ch in ("’", "ʼ"):
            out = "'"
        else:
            out = ch
        for char in out:
            text.append(char)
            positions.append(i)
    positions.append(len(input))
    return Normalized("".join(text), positions)
