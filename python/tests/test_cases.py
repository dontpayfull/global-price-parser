"""Run every shared reference case against the Python public API."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from global_price_parser import parse_price, parse_prices, read_page_signals
from global_price_parser import _prepare, looks_like_html
from global_price_parser.evidence import build_evidence
from global_price_parser.html import extract_html
from global_price_parser.parse import read_prices
from global_price_parser.types import Options

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(__file__).resolve().parents[1] / "src" / "global_price_parser"


def reference_cases() -> list[Any]:
    cases = []
    directory = ROOT / "spec" / "cases"
    if not directory.is_dir():
        return [pytest.param(None, marks=pytest.mark.skip(reason="Shared reference cases are not shipped in the sdist"))]
    for path in sorted(directory.glob("*.jsonl")):
        for line, text in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            cases.append(pytest.param(json.loads(text), id=f"{path.name}:{line}"))
    return cases


def snake_case(key: str) -> str:
    return re.sub(r"([A-Z])", lambda match: "_" + match[1].lower(), key)


def extracted_text(input: str, options: dict[str, Any]) -> str:
    prepared = _prepare(input, Options(**options))
    evidence = build_evidence(Options(**options), prepared.signals)
    visible = read_prices(prepared.extracted.text, evidence, prepared.extracted.struck or None)
    html = options.get("html")
    if html is None:
        html = looks_like_html(input)
    if any(candidate.has_currency for candidate in visible) or not html:
        return prepared.extracted.text
    hidden = extract_html(input, keep_hidden=True)
    if any(candidate.has_currency for candidate in read_prices(hidden.text, evidence, hidden.struck)):
        return hidden.text
    return prepared.extracted.text


def reference_price(price: Any, text: str) -> dict[str, Any]:
    result = price.to_dict()
    result["index"] = len(text[:price.index].encode("utf-16-le", errors="surrogatepass")) // 2
    return result


@pytest.mark.parametrize("case", reference_cases())
def test_reference_case(case: dict[str, Any]) -> None:
    options = {snake_case(key): value for key, value in case.get("options", {}).items()}
    if case["fn"] == "readPageSignals":
        actual = read_page_signals(case["input"], **options).to_dict()
    else:
        text = extracted_text(case["input"], options)
        if case["fn"] == "parsePrice":
            result = parse_price(case["input"], **options)
            actual = reference_price(result, text) if result is not None else None
        elif case["fn"] == "parsePrices":
            actual = [reference_price(price, text) for price in parse_prices(case["input"], **options)]
        else:
            pytest.fail(f"Unknown reference function: {case['fn']}")
    assert actual == case["expected"]


@pytest.mark.parametrize("suffix", [".2", ".A", ".́"])
def test_optional_unit_dot_backtracks_at_boundary(suffix: str) -> None:
    price = parse_price("$10/kg" + suffix)
    assert price is not None
    assert price.per is not None
    assert price.per.to_dict() == {"unit": "kilogram", "quantity": 1}
    assert price.raw == "$10/kg"


@pytest.mark.parametrize("language, form, unit", [("in", "j", "hour"), ("sh", "м", "month")])
def test_canonical_language_is_used_for_units(language: str, form: str, unit: str) -> None:
    price = parse_price("$10/" + form, language=language, country="US")
    assert price is not None
    assert price.per is not None
    assert price.per.to_dict() == {"unit": unit, "quantity": 1}


@pytest.mark.parametrize("language, currency", [("en-BU", "MMK"), ("en-DD", "EUR")])
def test_deprecated_region_is_canonicalized(language: str, currency: str) -> None:
    price = parse_price("25", language=language)
    assert price is not None
    assert price.currency == currency
    assert price.currency_sure is True
    assert price.decided_by == "hint.language"


def test_nonstandard_json_constants_use_the_malformed_json_fallback() -> None:
    page = '<script type="application/ld+json">{"priceCurrency":" CAD ","invalid":NaN}</script>'
    assert read_page_signals(page).to_dict() == {"currency": [], "country": [], "language": None}


def test_packaged_data_matches_shared_data() -> None:
    shared = ROOT / "data"
    copies = PACKAGE / "data"
    if not shared.is_dir():
        pytest.skip("Shared data directory is not shipped in the sdist")
    assert sorted(path.name for path in copies.glob("*.json")) == sorted(path.name for path in shared.glob("*.json"))
    for path in sorted(shared.glob("*.json")):
        assert (copies / path.name).read_bytes() == path.read_bytes(), path.name



def test_notice_is_shipped_in_the_distribution_and_package() -> None:
    notice = Path(__file__).resolve().parents[1] / "NOTICE"
    assert (PACKAGE / "data" / "NOTICE").read_bytes() == notice.read_bytes()
    if (ROOT / "NOTICE").is_file():
        assert notice.read_bytes() == (ROOT / "NOTICE").read_bytes()
