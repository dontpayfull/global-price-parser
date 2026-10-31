"""Small BCP 47 reader backed by the reference's generated Intl tables."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ._data import load_data

LOCALES = load_data("locales.json")
LANGUAGES: set[str] = set(LOCALES["languages"])
LIKELY_REGION: dict[str, str] = LOCALES["likelyRegion"]
REGION_LANGUAGE: dict[str, str] = LOCALES["regionLanguage"]
NUMERIC_REGIONS: dict[str, str] = LOCALES["numericRegions"]
LANGUAGE_ALIASES: dict[str, str] = LOCALES["languageAliases"]
REGION_ALIASES: dict[str, str] = LOCALES["regionAliases"]


@dataclass(frozen=True)
class Locale:
    language: str
    script: str | None
    region: str | None


def parse_locale(tag: str) -> Locale | None:
    parts = tag.replace("_", "-").split("-")
    if not re.fullmatch(r"[A-Za-z]{2,3}|[A-Za-z]{5,8}", parts[0]):
        return None
    language = parts[0].lower()
    script = None
    region = None
    i = 1
    if i < len(parts) and re.fullmatch(r"[A-Za-z]{4}", parts[i]):
        script = parts[i].title()
        script = "Zinh" if script == "Qaai" else script
        i += 1
    if i < len(parts) and re.fullmatch(r"[A-Za-z]{2}|[0-9]{3}", parts[i]):
        region = parts[i].upper()
        region = NUMERIC_REGIONS.get(region, region)
        region = REGION_ALIASES.get(region, region)
        i += 1
    variants: set[str] = set()
    while i < len(parts) and re.fullmatch(r"[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}", parts[i]):
        variant = parts[i].lower()
        if variant in variants:
            return None
        variants.add(variant)
        i += 1
    extensions: set[str] = set()
    while i < len(parts):
        singleton = parts[i].lower()
        if not re.fullmatch(r"[a-z0-9]", singleton) or singleton in extensions:
            return None
        extensions.add(singleton)
        i += 1
        start = i
        pattern = r"[A-Za-z0-9]{1,8}" if singleton == "x" else r"[A-Za-z0-9]{2,8}"
        while i < len(parts) and re.fullmatch(pattern, parts[i]):
            i += 1
        if i == start:
            return None
        if singleton == "x" and i != len(parts):
            return None
    alias = LANGUAGE_ALIASES.get(language, language).split("-")
    language = alias[0]
    for part in alias[1:]:
        if len(part) == 4:
            script = script or part
        else:
            region = region or part
    return Locale(language, script, region)
