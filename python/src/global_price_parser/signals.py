"""Read ordered currency and country evidence from HTML strings and URLs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, parse_qsl, quote, urljoin, urlsplit

from ._locale import LANGUAGES
from .currency import is_currency_code, is_region
from .evidence import region_of_tag
from .html import decode_entities, parse_attributes
from .markup import tokenize
from .types import PageSignals, Signal

Rule = tuple[str, str, str, int]
PLATFORM: list[Rule] = [
    ("shopify", r"Shopify\.currency\s*=\s*\{", r'''^[^}]{0,500}?["']active["']\s*:\s*["']([A-Z]{3})["']''', 600),
    ("bigcommerce", r"BCData\s*=\s*\{", r'''["'](?:current|active)_currency_code["']\s*:\s*["']([A-Z]{3})["']''', 4000),
    ("prestashop", r"prestashop\s*=\s*\{", r'''["']currency["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{3})["']''', 20000),
    ("vtex", r"__RUNTIME__", r'''["']culture["']\s*:\s*\{[^}]{0,500}?["']currency["']\s*:\s*["']([A-Z]{3})["']''', 20000),
    ("magento", r"checkoutConfig", r'''["']currencyCode["']\s*:\s*["']([A-Z]{3})["']''', 20000),
    ("woocommerce", r"woocs_current_currency\s*=\s*\{", r'''^[^}]{0,500}?["']name["']\s*:\s*["']([A-Z]{3})["']''', 600),
    ("woocommerce", r"(?:woo_multi_currency_params|wcml_mc_settings)\s*=\s*\{", r'''^[^}]{0,500}?["']current_currency["']\s*:\s*["']([A-Z]{3})["']''', 600),
]
TRACKING: list[Rule] = [
    ("datalayer", r"dataLayer\.push\s*\(\s*\{", r'''["']?ecommerce["']?\s*:\s*\{[^}]{0,500}?["']?currency(?:Code)?["']?\s*:\s*["']([A-Z]{3})["']''', 2600),
    ("gtag", r'''gtag\s*\(\s*["'](?:event|set|config)["']''', r'''^[^)]{0,2000}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']''', 2100),
    ("fbq", r'''fbq\s*\(\s*["']track["']\s*,\s*["'](?:ViewContent|AddToCart|InitiateCheckout|Purchase)["']\s*,\s*\{''', r'''^[^}]{0,500}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']''', 600),
    ("klaviyo", r"\$currency_code", r'''^["']?\s*:\s*["']([A-Z]{3})["']''', 40),
]
PLATFORM_COUNTRY: list[Rule] = [
    ("shopify", r"Shopify\.country\s*=\s*", r'''^["']([A-Z]{2})["']''', 8),
    ("prestashop", r"prestashop\s*=\s*\{", r'''["']country["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{2})["']''', 20000),
]
GENERIC_TLDS = set("ac ad ag ai am as bz cc cd ck co cx dj fm gg gl gs im io ki la ly me ms nf nr nu pw sc sh sr st su tk to tv vc ws".split())
SITE_LANGUAGES = set("ar bg cs da de el en es et fi fr he hr hu id it ja ko lt lv ms nb nl no pl pt ro ru sk sl sr sv th tr uk vi zh".split())
PATH_WORDS = set("am an as at be by do go he id if in is it me my no of on or so to up us we".split())
JS_SPACE = "\t\n\v\f\r                  　﻿"
JSON_TOKEN = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\[\]:,]')


def trim_space(value: str) -> str:
    return value.strip(JS_SPACE)


@dataclass(frozen=True)
class PageSource:
    html: dict[str, str]
    body: dict[str, str]
    metas: list[dict[str, str]]
    links: list[dict[str, str]]
    json_ld: list[str]
    scripts: list[str]
    microdata_currency: list[str]


def source_from_html(page: str) -> PageSource:
    html: dict[str, str] | None = None
    body: dict[str, str] | None = None
    metas: list[dict[str, str]] = []
    links: list[dict[str, str]] = []
    json_ld: list[str] = []
    scripts: list[str] = []
    microdata_currency: list[str] = []
    inert = 0
    script_type = ""
    microdata = False
    for token in tokenize(page):
        if token.type != "text" and token.name == "template":
            inert = inert + 1 if token.type == "open" else max(0, inert - 1)
            continue
        if inert:
            continue
        if token.type == "text":
            if microdata:
                microdata_currency.append(trim_space(decode_entities(token.text)))
            microdata = False
            continue
        microdata = False
        if token.type == "raw":
            if token.name == "script":
                if script_type == "application/ld+json":
                    json_ld.append(token.text)
                elif not script_type or "javascript" in script_type or script_type == "module":
                    scripts.append(token.text)
            continue
        if token.type != "open" or (token.name not in ("html", "body", "meta", "link", "script")
                                    and not re.search("itemprop", token.attrs, re.I | re.ASCII)):
            continue
        attrs = parse_attributes(token.attrs)
        if token.name == "html":
            if html is None:
                html = attrs
        elif token.name == "body":
            if body is None:
                body = attrs
        elif token.name == "meta":
            metas.append(attrs)
        elif token.name == "link":
            links.append(attrs)
        elif token.name == "script":
            script_type = trim_space(attrs.get("type", "")).lower()
        if attrs.get("itemprop", "").lower() == "pricecurrency":
            if "content" in attrs:
                microdata_currency.append(trim_space(attrs["content"]))
            else:
                microdata = True
    return PageSource(html or {}, body or {}, metas, links, json_ld, scripts, microdata_currency)


def find_rule(rule: Rule, scripts: str) -> str | None:
    _, anchor, value, window = rule
    for tries, match in enumerate(re.finditer(anchor, scripts)):
        hit = re.search(value, scripts[match.end():match.end() + window])
        if hit:
            return hit[1]
        if tries >= 19:
            break
    return None


@dataclass
class JsonFrame:
    type: str
    state: str
    data: Any
    key: str | None = None


def parse_json(block: str) -> Any:
    """Validate iteratively, retaining only the tree visited by the depth-20 traversal."""
    stack: list[JsonFrame] = []
    root: Any = None
    root_state = "value"
    pos = 0
    while pos < len(block):
        if block[pos] in " \t\r\n":
            pos += 1
            continue
        value: Any = None
        if block[pos] == '"':
            value, pos = json.decoder.scanstring(block, pos + 1)
            token = '"'
        else:
            match = JSON_TOKEN.match(block, pos)
            if not match:
                raise ValueError("Invalid JSON token")
            token = match[0]
            pos = match.end()
        frame = stack[-1] if stack else None
        state = frame.state if frame else root_state
        kind = frame.type if frame else None
        if ((token == "}" and kind == "object" and state in ("keyOrEnd", "commaOrEnd"))
                or (token == "]" and kind == "array" and state in ("valueOrEnd", "commaOrEnd"))):
            stack.pop()
        elif token == ":" and kind == "object" and state == "colon":
            frame.state = "value"
        elif token == "," and state == "commaOrEnd":
            frame.state = "key" if kind == "object" else "value"
        elif token == '"' and kind == "object" and state in ("key", "keyOrEnd"):
            frame.key = value
            frame.state = "colon"
        elif state in ("value", "valueOrEnd") and token not in ("}", "]", ":", ","):
            if token in ("{", "["):
                value = ({} if token == "{" else []) if len(stack) <= 20 else None
            if frame:
                frame.state = "commaOrEnd"
                if isinstance(frame.data, dict):
                    frame.data[frame.key] = value
                elif isinstance(frame.data, list):
                    frame.data.append(value)
            else:
                root, root_state = value, "done"
            if token in ("{", "["):
                stack.append(JsonFrame("object" if token == "{" else "array",
                                       "keyOrEnd" if token == "{" else "valueOrEnd", value))
        else:
            raise ValueError("Invalid JSON structure")
    if root_state != "done" or stack:
        raise ValueError("Incomplete JSON document")
    return root


def collect_price_currency(node: Any, out: list[str], depth: int = 0) -> None:
    if depth > 20:
        return
    if isinstance(node, list):
        for value in node:
            collect_price_currency(value, out, depth + 1)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key.lower() == "pricecurrency" and isinstance(value, str):
                out.append(trim_space(value).upper())
            else:
                collect_price_currency(value, out, depth + 1)


def parse_url(href: str, base: str | None = None) -> SplitResult | None:
    """Read HTTP(S) URLs, with WHATWG backslashes and relative href resolution."""
    href = re.sub(r"[\t\n\r]", "", href.strip("".join(chr(cp) for cp in range(33))))
    # Backslashes are slashes in the authority/path, but not in queries/fragments.
    pieces = re.split(r"([?#])", href, maxsplit=1)
    href = pieces[0].replace(chr(92), "/") + "".join(pieces[1:])
    try:
        if base is not None:
            parent = parse_url(base)
            if parent is None:
                return None
            href = urljoin(parent.geturl(), href)
        result = urlsplit(href)
        host = result.hostname
        if result.scheme.lower() not in ("http", "https") or not host:
            return None
        if re.search(r'''[\s<>"{}|\\^`%]''', host):
            return None
        if result.port is not None and not 0 <= result.port <= 65535:
            return None
        host.encode("idna")
        segments: list[str] = []
        path_parts = (result.path or "/").split("/")
        for i, segment in enumerate(path_parts):
            dot = segment.lower().replace("%2e", ".")
            if dot in (".", ".."):
                if dot == ".." and len(segments) > 1:
                    segments.pop()
                if i == len(path_parts) - 1:
                    segments.append("")
            else:
                segments.append(segment)
        path = quote("/".join(segments) or "/", safe="/%:@!$&'()*+,;=-._~[]|")
        query = quote(result.query, safe="!$&()*+,;=:@/?%[]-._~`{}|^" + chr(92))
        return result._replace(path=path, query=query)
    except (ValueError, UnicodeError):
        return None


def url_key(href: str, base: str | None = None, with_query: bool = True) -> str | None:
    parsed = parse_url(href, base)
    if parsed is None:
        return None
    host = (parsed.hostname or "").encode("idna").decode("ascii").lower()
    query = "?" + parsed.query if with_query and parsed.query else ""
    return host.removeprefix("www.") + (parsed.path.rstrip("/") or "/") + query


def path_region(a: str, b: str) -> str | None:
    if a in PATH_WORDS and b in PATH_WORDS:
        return None
    lang_first = a in LANGUAGES and is_region(b)
    region_first = is_region(a) and b in LANGUAGES
    if lang_first and region_first:
        return (a if b in SITE_LANGUAGES and a not in SITE_LANGUAGES else b).upper()
    if lang_first:
        return b.upper()
    if region_first:
        return a.upper()
    return None


def url_signals(url: str) -> tuple[list[Signal], list[Signal]]:
    currency: list[Signal] = []
    country: list[Signal] = []
    parsed = parse_url(url)
    if parsed is None:
        return currency, country
    query: dict[str, str] = {}
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        query.setdefault(key, value)
    cur = query.get("currency", "").upper()
    if is_currency_code(cur):
        currency.append(Signal("url.query", currency=cur))
    ctry = query.get("country", "").upper()
    if re.fullmatch(r"[A-Z]{2}", ctry) and is_region(ctry):
        country.append(Signal("url.query", country=ctry))
    segs = [segment for segment in parsed.path.split("/") if segment][:2]
    pair = re.fullmatch(r"([a-z]{2})[-_]([a-z]{2})", segs[0] if segs else "", re.I | re.ASCII)
    region = None
    if pair and pair[1].lower() in LANGUAGES and is_region(pair[2]):
        region = pair[2].upper()
    elif len(segs) == 2 and all(re.fullmatch(r"[a-z]{2}", s, re.I | re.ASCII) for s in segs):
        region = path_region(segs[0].lower(), segs[1].lower())
    if region:
        country.append(Signal("url.path", country="GB" if region == "UK" else region))
    tld = (parsed.hostname or "").lower().split(".")[-1]
    if re.fullmatch(r"[a-z]{2}", tld) and tld not in GENERIC_TLDS and is_region(tld):
        country.append(Signal("url.tld", country="GB" if tld == "uk" else tld.upper()))
    return currency, country


def has_rel(link: dict[str, str], rel: str) -> bool:
    return rel in re.split(r"\s+", link.get("rel", "").lower())


def read_page_signals(page: str, *, url: str | None = None) -> PageSignals:
    """Read every currency and country signal, in reference priority order."""
    src = source_from_html(page)
    currency: list[Signal] = []
    country: list[Signal] = []

    def add_currency(source: str, code: str | None) -> None:
        c = trim_space(code or "").upper()
        if is_currency_code(c) and not any(s.source == source and s.currency == c for s in currency):
            currency.append(Signal(source, currency=c))

    scripts = "\n;\n".join(src.scripts)
    for rule in PLATFORM:
        add_currency(f"page.platform:{rule[0]}", find_rule(rule, scripts))
    paypal = next((m for m in src.metas if m.get("id") == "in-context-paypal-metadata"), {})
    add_currency("page.platform:shopify", paypal.get("data-currency"))
    add_currency("page.platform:shopware", src.html.get("data-currency-iso", src.body.get("data-currency-iso")))
    for rule in TRACKING:
        add_currency(f"page.tracking:{rule[0]}", find_rule(rule, scripts))
    for block in src.json_ld:
        found: list[str] = []
        try:
            collect_price_currency(parse_json(trim_space(block)), found)
        except RecursionError:
            # Never reinterpret valid deep JSON through the malformed-JSON fallback.
            continue
        except ValueError:
            found.extend(m[1].upper() for m in re.finditer(r'"priceCurrency"\s*:\s*"([A-Za-z]{3})"', block, re.I | re.ASCII))
        for code in found:
            add_currency("page.jsonld", code)
    for code in src.microdata_currency:
        add_currency("page.microdata", code)
    for meta in src.metas:
        prop = meta.get("property", meta.get("name", "")).lower()
        if prop in ("product:price:currency", "og:price:currency"):
            add_currency("page.meta", meta.get("content"))
    canonical = next((link.get("href") for link in src.links if has_rel(link, "canonical")), None)
    page_url = url if url is not None else canonical if canonical and url_key(canonical) else None
    from_currency, from_country = url_signals(page_url) if page_url else ([], [])
    currency.extend(from_currency)
    for rule in PLATFORM_COUNTRY:
        c = find_rule(rule, scripts)
        if c and is_region(c):
            country.append(Signal(f"page.platform:{rule[0]}", country=c))
    country.extend(s for s in from_country if s.source == "url.query")
    alternates = [link for link in src.links if has_rel(link, "alternate") and link.get("hreflang") and link["hreflang"] != "x-default"]
    matches: list[dict[str, str]] = []
    matched = False
    for with_query in (True, False):
        keys = (
            url_key(page_url, with_query=with_query) if page_url else None,
            url_key(canonical, page_url, with_query) if canonical else None,
        )
        for key in keys:
            found_links = [link for link in alternates if url_key(link.get("href", ""), page_url, with_query) == key] if key else []
            if found_links:
                if len({region_of_tag(link["hreflang"]) for link in found_links}) == 1:
                    matches = found_links
                matched = True
                break
        if matched:
            break
    hreflang_language = matches[0]["hreflang"] if matches else None
    hreflang_region = next((region for link in matches if (region := region_of_tag(link["hreflang"]))), None)
    if hreflang_region:
        country.append(Signal("url.hreflang", country=hreflang_region))
    lang = src.html.get("lang", src.html.get("xml:lang"))
    lang_region = region_of_tag(lang) if lang else None
    if lang_region:
        country.append(Signal("page.lang", country=lang_region))
    country.extend(s for s in from_country if s.source != "url.query")
    return PageSignals(currency, country, lang or hreflang_language or None)
