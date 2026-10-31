"""Parse international prices from plain text or HTML strings."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .evidence import build_evidence
from .html import Extracted, extract_html
from .normalize import DECIMAL_MARK
from .parse import Candidate, read_prices
from .signals import read_page_signals
from .types import Options, PageSignals, Per, Price, Signal

__all__ = ["parse_price", "parse_prices", "read_page_signals", "Price", "PageSignals", "Signal", "Per"]
__version__ = "0.1.0"


@dataclass(frozen=True)
class Prepared:
    extracted: Extracted
    signals: PageSignals | None


def looks_like_html(s: str) -> bool:
    return bool(re.search(r"</?[a-z][^<>]*>", s, re.IGNORECASE | re.ASCII))


def _prepare(input: str, options: Options) -> Prepared:
    if not isinstance(input, str):
        raise TypeError("input must be a string")
    if options.page is not None and not isinstance(options.page, str):
        raise TypeError("page must be an HTML string")
    html = options.html if options.html is not None else looks_like_html(input)
    extracted = extract_html(input) if html else Extracted(input.replace(DECIMAL_MARK, ""), [])
    page = options.page if options.page is not None else input if html else None
    signals = (read_page_signals(page, url=options.url) if page is not None
               else read_page_signals("", url=options.url) if options.url else None)
    return Prepared(extracted, signals)


def _candidates(input: str, options: Options) -> list[Candidate]:
    prepared = _prepare(input, options)
    extracted = prepared.extracted
    evidence = build_evidence(options, prepared.signals)
    found = read_prices(extracted.text, evidence, extracted.struck or None)
    html = options.html if options.html is not None else looks_like_html(input)
    if any(candidate.has_currency for candidate in found) or not html:
        return found
    all_text = extract_html(input, keep_hidden=True)
    hidden = read_prices(all_text.text, evidence, all_text.struck)
    return hidden if any(candidate.has_currency for candidate in hidden) else found


def parse_prices(
    input: str, *, currency: str | None = None, country: str | None = None,
    language: str | None = None, url: str | None = None, page: str | None = None,
    html: bool | None = None,
) -> list[Price]:
    """Return every price carrying its own currency symbol, code or word."""
    options = Options(currency=currency, country=country, language=language, url=url, page=page, html=html)
    return [candidate.price for candidate in _candidates(input, options) if candidate.has_currency]


def parse_price(
    input: str, *, currency: str | None = None, country: str | None = None,
    language: str | None = None, url: str | None = None, page: str | None = None,
    html: bool | None = None,
) -> Price | None:
    """Pick the first unstruck currency-bearing price, or a lone number."""
    options = Options(currency=currency, country=country, language=language, url=url, page=page, html=html)
    all_candidates = _candidates(input, options)
    priced = [candidate for candidate in all_candidates if candidate.has_currency]
    pick = next((candidate for candidate in priced if not candidate.price.struck), None)
    if pick is None:
        pick = priced[0] if priced else all_candidates[0] if len(all_candidates) == 1 else None
    return pick.price if pick else None
