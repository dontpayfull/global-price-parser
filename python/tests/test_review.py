"""Portability and bounded-time regressions from the release review."""

from __future__ import annotations

import os
from time import perf_counter

import pytest

# Shared CI machines are several times slower; a quadratic slip is still far above these limits.
SLOW = 10 if os.environ.get("CI") else 1

from global_price_parser import parse_price, parse_prices, read_page_signals
from global_price_parser.html import decode_entities
from global_price_parser.number import parse_number


@pytest.mark.parametrize("raw", ["1\n", "1.23\n", "10.-\n", "123"])
def test_number_end_anchors_and_internal_marker_count(raw: str) -> None:
    assert parse_number(raw) is None


def test_oversized_and_surrogate_numeric_entities_are_kept_as_written() -> None:
    text = "&#" + "9" * 10000 + "; &#xD800; &#55357;"
    assert decode_entities(text) == text


def test_backslashes_are_http_url_path_separators() -> None:
    url = "https:" + chr(92) * 2 + "shop.example.ca" + chr(92) + "p"
    price = parse_price("$25", url=url)
    assert price is not None
    assert price.currency == "CAD"
    assert price.decided_by == "url.tld"
    page = '<link rel="alternate" hreflang="en-CA" href="/p">'
    signals = read_page_signals(page, url=url)
    assert signals.country[0].to_dict() == {"source": "url.hreflang", "country": "CA"}


def test_valid_deep_json_does_not_use_the_malformed_json_fallback() -> None:
    block = "[" * 1500 + '{"priceCurrency":"CAD"}' + "]" * 1500
    signals = read_page_signals('<script type="application/ld+json">' + block + "</script>")
    assert signals.currency == []


@pytest.mark.parametrize("name", [
    "4mb-signals", "4mb-price", "short-scripts", "a-spaces", "a-tight",
    "quoted-attributes", "microdata", "prestashop", "many-prices",
])
def test_hostile_input_stays_under_half_a_second(name: str) -> None:
    if name in ("4mb-signals", "4mb-price"):
        text = ("<script>" + "x" * 1000 + "</script>") * 4000 + "<p>€ 5</p>"
        function = read_page_signals if name == "4mb-signals" else parse_price
    elif name == "short-scripts":
        text = "<script>var a=1;</script><p>word</p>" * 20000 + "<p>€ 5</p>"
        function = parse_price
    elif name == "a-spaces":
        text, function = "<a " * 16000, parse_price
    elif name == "a-tight":
        text, function = "<a" * 50000, parse_price
    elif name == "quoted-attributes":
        text, function = "<div " + '"' * 50000, parse_price
    elif name == "microdata":
        text, function = "<div itemprop=priceCurrency " * 1800, read_page_signals
    elif name == "prestashop":
        text = "<script>" + 'prestashop={"currency":{' * 2000 + "</script>$25"
        function = parse_price
    else:
        text, function = "$1; " * 16000, parse_prices
    started = perf_counter()
    result = function(text)
    elapsed = perf_counter() - started
    print(f"{name}: {elapsed:.6f} s")
    assert elapsed < 0.5 * SLOW, f"{name} took {elapsed:.6f} s"
    if name in ("4mb-price", "short-scripts"):
        assert result is not None and result.amount == "5.00" and result.currency == "EUR"
    elif name == "prestashop":
        assert result is not None and result.amount == "25.00"
    elif name == "many-prices":
        assert len(result) == 16000
    elif name in ("a-spaces", "a-tight", "quoted-attributes"):
        assert result is None
    else:
        assert result.currency == []


def short(input: str, **options: str) -> str | None:
    price = parse_price(input, **options)
    return f"{price.amount} {price.currency}{'' if price.currency_sure else '?'}" if price else None


def amounts(input: str) -> list[str]:
    return [price.amount for price in parse_prices(input)]


def test_second_round_quoted_attribute_values_may_hold_markup() -> None:
    assert short('<span title="<b>$999</b>">$25</span>') == "25.00 USD?"
    assert parse_price('<del title="x < y">$999</del><span>$25</span>').amount == "25.00"
    assert amounts('<span hidden title="x < y">$999</span><span>$25</span>') == ["25.00"]


def test_second_round_nested_templates_and_svg_are_inert() -> None:
    assert short('<template><template></template><script>Shopify.currency={"active":"CAD"}</script></template>$25') == "25.00 USD?"
    assert amounts('<svg><svg></svg><text>$999</text></svg>$25') == ["25.00"]


def test_second_round_script_strings_are_not_markup() -> None:
    assert short('<script>const x="<!--";</script><meta property="product:price:currency" content="CAD">$25') == "25.00 CAD"
    page = '<script>var s = "</script"; var t = "<meta property=og:price:currency content=CAD>";</script>$25'
    assert short("$25", page=page) == "25.00 USD?"


def test_second_round_page_hreflang_precedes_canonical_and_conflicts_are_uncertain() -> None:
    page = '<link rel="canonical" href="https://x.example/p"><link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="?locale=ca">'
    assert short("$25", url="https://x.example/p?locale=ca", page=page) == "25.00 CAD"
    both = '<link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="/p">'
    assert short("$25", url="https://x.example/p", page=both) == "25.00 USD?"


def test_second_round_noncontiguous_signals_of_one_source_are_combined() -> None:
    html = '<script>Shopify.currency={"active":"CAD"}; BCData={"current_currency_code":"EUR"}</script><meta id="in-context-paypal-metadata" data-currency="USD">$25'
    assert short(html) == "25.00 CAD?"
    price = parse_price(html)
    assert price.other_currencies == ["USD"]


def test_second_round_adjacent_prices_keep_their_own_symbols() -> None:
    assert amounts("<span>10€</span><span>20€</span>") == ["10.00", "20.00"]
    assert amounts("Pack of 2$19.99") == ["19.99"]


def test_second_round_size_letters_do_not_shape_ranges_or_eat_a_minus() -> None:
    assert amounts("Size L 10-20 €") == ["10.00", "20.00"]
    assert short("Size L 2 -$5.00") == "-5.00 USD?"


def test_second_round_raised_footnote_letters_and_marks_are_dropped() -> None:
    assert short("<span>19,99<sup>a</sup> €</span>") == "19.99 EUR"
    assert short("<span>19<sup>99*</sup> €</span>") == "19.99 EUR"


def test_second_round_script_windows_count_code_points() -> None:
    page = '<script>checkoutConfig = {"a":"' + "😀" * 11000 + '","currencyCode":"CAD"};</script>'
    assert read_page_signals(page).to_dict()["currency"] == [{"source": "page.platform:magento", "currency": "CAD"}]


@pytest.mark.parametrize("name, limit", [
    ("long-tag-name", 0.9), ("stray-closing-tags", 1.5), ("nested-sup", 1.5),
    ("unclosed-quoted-attributes", 1.5), ("comments-and-templates", 1.5),
])
def test_second_round_hostile_input_stays_linear(name: str, limit: float) -> None:
    if name == "long-tag-name":
        text = "<" + "a" * 100000
        function = lambda: parse_price(text, html=True)
    elif name == "stray-closing-tags":
        text = "<b><i>" * 20000 + "</u>" * 25000 + "$10"
        function = lambda: parse_price(text)
    elif name == "nested-sup":
        text = "<sup>a" * 10000 + "</sup>" * 10000 + " $10"
        function = lambda: parse_price(text)
    elif name == "unclosed-quoted-attributes":
        text = '<a title="x' * 20000 + "$10"
        function = lambda: parse_price(text)
    else:
        text = "<!--" * 30000 + "<template>" * 30000
        function = lambda: read_page_signals(text)
    started = perf_counter()
    function()
    elapsed = perf_counter() - started
    print(f"{name}: {elapsed:.6f} s")
    assert elapsed < limit * SLOW, f"{name} took {elapsed:.6f} s"


@pytest.mark.parametrize("depth", [1000, 10000])
def test_deep_valid_json_keeps_shallow_currency_evidence(depth: int) -> None:
    block = '{"priceCurrency":"CAD","deep":' + "[" * depth + "{}" + "]" * depth + "}"
    signals = read_page_signals('<script type="application/ld+json">' + block + "</script>")
    assert signals.to_dict()["currency"] == [{"source": "page.jsonld", "currency": "CAD"}]


def test_json_ld_currency_and_block_trim_bom_like_javascript() -> None:
    block = '﻿{"priceCurrency":"﻿CAD﻿"}﻿'
    signals = read_page_signals('<script type="application/ld+json">' + block + "</script>")
    assert signals.to_dict()["currency"] == [{"source": "page.jsonld", "currency": "CAD"}]


@pytest.mark.parametrize("suffix", ["²2", "³2"])
def test_unit_character_scan_backtracks_at_superscript_boundary(suffix: str) -> None:
    price = parse_price("$10/m" + suffix)
    assert price is not None and price.per is not None
    assert price.per.to_dict() == {"unit": "meter", "quantity": 1}
    assert price.raw == "$10/m"
