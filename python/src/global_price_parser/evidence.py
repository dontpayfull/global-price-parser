"""Build ordered currency evidence and unit-reading languages."""

from __future__ import annotations

import re

from ._locale import LIKELY_REGION, REGION_LANGUAGE, parse_locale
from .currency import is_currency_code, is_region
from .resolve import Evidence
from .types import Options, PageSignals, Signal


def region_of_tag(tag: str) -> str | None:
    locale = parse_locale(tag)
    region = locale.region if locale else None
    if not region or not re.fullmatch(r"[A-Z]{2}", region) or not is_region(region):
        return None
    return region


def likely_region(tag: str) -> str | None:
    locale = parse_locale(tag)
    if not locale:
        return None
    script_key = f"{locale.language}-{locale.script}" if locale.script else locale.language
    region = locale.region or LIKELY_REGION.get(script_key) or LIKELY_REGION.get(locale.language)
    return region if region and is_region(region) else None


def build_evidence(options: Options, page: PageSignals | None) -> Evidence:
    entries: list[Signal] = []
    currency = options.currency.upper() if options.currency is not None else None
    if currency and is_currency_code(currency):
        entries.append(Signal("hint.currency", currency=currency))
    country = options.country.upper() if options.country is not None else None
    if country and is_region(country):
        entries.append(Signal("hint.country", country="GB" if country == "UK" else country))
    lang_region = region_of_tag(options.language) if options.language else None
    if lang_region:
        entries.append(Signal("hint.language", country=lang_region))
    if page:
        entries.extend(page.currency)
        entries.extend(page.country)
    if options.language and not lang_region:
        likely = likely_region(options.language)
        if likely:
            entries.append(Signal("hint.language", country=likely, likely=True))
    return Evidence(entries, languages_of(options, page, entries))


def languages_of(options: Options, page: PageSignals | None, entries: list[Signal]) -> list[str]:
    out: dict[str, None] = {}
    tag = options.language if options.language is not None else page.language if page else None
    if tag:
        locale = parse_locale(tag)
        if locale:
            out[locale.language] = None
    country = next((entry.country for entry in entries if entry.country), None)
    if country:
        language = REGION_LANGUAGE.get(country)
        if language:
            out[language] = None
    return list(out)
