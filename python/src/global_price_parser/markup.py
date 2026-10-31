"""Linear HTML tokenization, including quoted attributes and raw-text elements."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterator

RAW_TEXT = set("script style textarea title noscript iframe noembed noframes".split())
RAW_CLOSE = {name: re.compile(r"</" + name + r"(?=[\t\n\f\r />])", re.I | re.ASCII) for name in RAW_TEXT}
SPACE = " \n\t\r\f"


@dataclass(frozen=True)
class Token:
    type: str
    name: str = ""
    attrs: str = ""
    self_closing: bool = False
    text: str = ""


@dataclass(frozen=True)
class Tag:
    name: str
    attrs: str
    self_closing: bool
    end: int


def is_letter(ch: str) -> bool:
    return "a" <= ch <= "z" or "A" <= ch <= "Z"


def read_tag(html: str, start: int) -> Tag | None:
    """Read just after `<` or `</`; an unfinished tag drops the rest of the page."""
    end = start
    n = len(html)
    while end < n and html[end] not in SPACE + "/>":
        end += 1
    name = html[start:end].lower()
    attrs_start = end
    while end < n:
        ch = html[end]
        if ch == ">":
            return Tag(name, html[attrs_start:end], end > attrs_start and html[end - 1] == "/", end + 1)
        end += 1
        if ch != "=":
            continue
        while end < n and html[end] in SPACE:
            end += 1
        if end < n and html[end] in "\"'":
            close = html.find(html[end], end + 1)
            if close < 0:
                return None
            end = close + 1
    return None


def read_at(html: str, lt: int) -> tuple[Token | None, int] | None:
    """Read markup at `<`, returning None only when the `<` is literal text."""
    n = len(html)
    ch = html[lt + 1:lt + 2]
    if html.startswith("<!--", lt):
        if html.startswith(">", lt + 4):
            return None, lt + 5
        if html.startswith("->", lt + 4):
            return None, lt + 6
        close = html.find("-->", lt + 4)
        return None, close + 3 if close >= 0 else n
    if ch in ("!", "?"):
        gt = html.find(">", lt + 2)
        return None, gt + 1 if gt >= 0 else n
    if ch == "/":
        following = html[lt + 2:lt + 3]
        if not following:
            return None
        if following == ">":
            return None, lt + 3
        if not is_letter(following):
            gt = html.find(">", lt + 2)
            return None, gt + 1 if gt >= 0 else n
        tag = read_tag(html, lt + 2)
        return (Token("close", tag.name), tag.end) if tag else (None, n)
    if not is_letter(ch):
        return None
    tag = read_tag(html, lt + 1)
    return (Token("open", tag.name, tag.attrs, tag.self_closing), tag.end) if tag else (None, n)


def tokenize(html: str) -> Iterator[Token]:
    text = pos = 0
    while (lt := html.find("<", pos)) >= 0:
        at = read_at(html, lt)
        if at is None:
            pos = lt + 1
            continue
        if lt > text:
            yield Token("text", text=html[text:lt])
        token, end = at
        pos = text = end
        if token is None:
            continue
        yield token
        if token.type == "open" and token.name in RAW_TEXT:
            close = RAW_CLOSE[token.name].search(html, pos)
            end = close.start() if close else len(html)
            yield Token("raw", token.name, text=html[pos:end])
            pos = text = end
    if text < len(html):
        yield Token("text", text=html[text:])
