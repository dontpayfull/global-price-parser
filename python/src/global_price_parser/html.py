"""The reference HTML string tokenizer, without DOM or CSS dependencies."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .markup import RAW_TEXT, tokenize
from .normalize import DECIMAL_MARK, ascii_digits

SKIP = set("script style noscript template head title svg iframe object textarea select".split())
VOID = set("area base br col embed hr img input link meta source track wbr".split())
BLOCK = set((
    "address article aside blockquote br dd div dl dt fieldset figcaption figure footer form "
    "h1 h2 h3 h4 h5 h6 header hr li main nav ol option p pre section table tbody td tfoot "
    "th thead tr ul button label"
).split())
STRUCK = {"del", "s", "strike"}
RAISED = {"sup", "sub"}
ENTITIES = {
    "nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'",
    "euro": "€", "pound": "£", "yen": "¥", "cent": "¢", "dollar": "$", "curren": "¤",
    "thinsp": " ", "ensp": " ", "emsp": " ", "minus": "−", "ndash": "–",
    "mdash": "—", "rsquo": "’", "lsquo": "‘", "sup2": "²", "sup3": "³", "middot": "·",
}
ATTRIBUTE = re.compile(r'''([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?''')
SCREEN_READER_ONLY = re.compile(
    r"(?:^|\s)(?:sr-only|sr-text|[\w-]*__sr-text|screen-reader-text|screenreader-only|"
    r"visually-?hidden|visuallyhidden|a-offscreen|aok-offscreen|offscreen|u-visually-hidden)(?:\s|\Z)",
    re.IGNORECASE | re.ASCII,
)
SPECIAL_SPACES = re.compile(r"[      - 　]{2,}")


@dataclass(frozen=True)
class Extracted:
    text: str
    struck: list[bool]


def decode_entities(s: str) -> str:
    def decode(match: re.Match[str]) -> str:
        body = match[1]
        if body[0] == "#":
            cp = int(body[2:], 16) if body[1].lower() == "x" else int(body[1:])
            return chr(cp) if 0 < cp <= 0x10FFFF and not 0xD800 <= cp <= 0xDFFF else match[0]
        return ENTITIES.get(body.lower(), match[0])
    return re.sub(r"&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]*);", decode, s, flags=re.IGNORECASE | re.ASCII)


def parse_attributes(src: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in ATTRIBUTE.finditer(src):
        value = next((item for item in match.groups()[1:] if item is not None), "")
        attrs[match[1].lower()] = decode_entities(value)
    return attrs


def is_hidden(attrs: dict[str, str]) -> bool:
    if "hidden" in attrs or SCREEN_READER_ONLY.search(attrs.get("class", "")):
        return True
    return bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", attrs.get("style", "").lower()))


def is_struck_style(attrs: dict[str, str]) -> bool:
    return bool(re.search(r"text-decoration(?:-line)?\s*:[^;]*line-through", attrs.get("style", ""), re.IGNORECASE))


class Writer:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.length = 0
        self.struck: list[bool] = []

    @property
    def text(self) -> str:
        return "".join(self.parts)

    def tail(self, n: int) -> str:
        parts: list[str] = []
        length = 0
        for part in reversed(self.parts):
            parts.append(part[-n:])
            length += len(parts[-1])
            if length >= n:
                break
        return "".join(reversed(parts))[-n:]

    def last(self) -> str:
        return self.parts[-1][-1] if self.parts else ""

    def push(self, s: str, struck: bool) -> None:
        if s:
            self.parts.append(s)
            self.length += len(s)
            self.struck.extend([struck] * len(s))

    def space(self, struck: bool) -> None:
        if self.length and not re.search(r"\s", self.last()):
            self.push(" ", struck)

    def block(self) -> None:
        if not self.length or self.last() == "\n":
            return
        while self.parts:
            part = self.parts[-1]
            kept = part.rstrip(" ")
            if kept == part:
                break
            self.length -= len(part) - len(kept)
            if kept:
                self.parts[-1] = kept
            else:
                self.parts.pop()
        del self.struck[self.length:]
        self.push("\n", False)

    def add_text(self, raw: str, struck: bool) -> None:
        collapsed = decode_entities(raw).replace(DECIMAL_MARK, "")
        collapsed = SPECIAL_SPACES.sub(" ", re.sub(r"[\t\n\r\f ]+", " ", collapsed))
        if collapsed == " ":
            self.space(struck)
        elif collapsed:
            if (not self.length or re.search(r"\s", self.last())) and collapsed.startswith(" "):
                collapsed = collapsed[1:]
            self.push(collapsed, struck)

    def raised(self, content: str, struck: bool) -> None:
        t = ascii_digits(re.sub(r"[*†‡§¶]+", " ", content.replace(DECIMAL_MARK, "")).strip())
        before = ascii_digits(self.tail(8))
        after_number = bool(re.search(r"[0-9]\Z", before))
        cents = re.fullmatch(r"([0-9]{2})(?:\s*([^0-9]+))?", t)
        if cents and after_number and not re.search(r"[.,][0-9]{1,2}\Z", before):
            self.push(DECIMAL_MARK + cents[1] + (" " + cents[2].strip() if cents[2] else ""), struck)
        elif re.fullmatch(r"[.,][0-9]{1,2}", t) and after_number:
            self.push(DECIMAL_MARK + t[1:], struck)
        elif t in ("2", "3") and before.endswith("m"):
            self.push("²" if t == "2" else "³", struck)
        elif (bool(t) and all("0" <= ch <= "9" or ch.isspace() or unicodedata.category(ch).startswith("P") for ch in t)
              or re.fullmatch(r"[a-z]?", t)) and content.strip() and after_number:
            self.space(struck)
        elif re.fullmatch(r"[0-9]+", t):
            self.push(f" {t} ", struck)
        elif t:
            self.push(t, struck)


@dataclass
class Frame:
    tag: str
    hidden: bool
    struck: bool
    raised: list[str] | None
    apart: bool = False


def extract_html(html: str, keep_hidden: bool = False) -> Extracted:
    writer = Writer()
    stack = [Frame("#root", False, False, None)]
    opened: dict[str, int] = {}

    def pop(at_end: bool) -> None:
        frame = stack.pop()
        opened[frame.tag] -= 1
        if frame.raised is not None and not frame.hidden and stack[-1].raised is None:
            writer.raised("".join(frame.raised), frame.struck)
        if at_end:
            return
        if frame.tag in BLOCK and not frame.hidden:
            writer.block()
        elif frame.apart:
            writer.space(frame.struck)

    for token in tokenize(html):
        current = stack[-1]
        if token.type == "text":
            if not current.hidden:
                if current.raised is not None:
                    current.raised.append(decode_entities(token.text))
                else:
                    writer.add_text(token.text, current.struck)
            continue
        if token.type == "raw":
            continue
        if token.type == "close":
            if not opened.get(token.name):
                continue
            while stack[-1].tag != token.name:
                pop(False)
            pop(False)
            continue
        tag = token.name
        if tag in RAW_TEXT:
            continue
        attrs = parse_attributes(token.attrs)
        if tag in BLOCK and not current.hidden:
            writer.block()
        if tag in VOID or token.self_closing:
            continue
        skip = tag in SKIP
        hidden = is_hidden(attrs)
        apart = keep_hidden and not skip and not current.hidden and hidden
        if apart:
            writer.space(current.struck)
        opened[tag] = opened.get(tag, 0) + 1
        stack.append(Frame(
            tag, current.hidden or skip or (not keep_hidden and hidden),
            current.struck or tag in STRUCK or is_struck_style(attrs),
            current.raised if current.raised is not None else [] if tag in RAISED else None, apart,
        ))
    while len(stack) > 1:
        pop(True)
    return Extracted(writer.text, writer.struck)
