# Global Price Parser for Python

Read exact amounts and ISO 4217 currencies from international text or HTML.
No runtime dependencies. Python 3.9 or newer.

```sh
pip install global-price-parser
```

```python
from global_price_parser import parse_price, parse_prices, read_page_signals

price = parse_price("1.299,00 €")
print(price.amount, price.currency, price.currency_sure)
# 1299.00 EUR True

price = parse_price("$25", url="https://shop.example.ca/p/1")
print(price.amount, price.currency, price.decided_by)
# 25.00 CAD url.tld

print([(p.amount, p.currency) for p in parse_prices("Was $30, now $25")])
# [('30.00', 'USD'), ('25.00', 'USD')]

print(read_page_signals('<html lang="fr-CA"></html>').to_dict())
# {'currency': [], 'country': [{'source': 'page.lang', 'country': 'CA'}], 'language': 'fr-CA'}
```

`parse_price` returns a frozen `Price` dataclass or `None`. `parse_prices`
returns only prices carrying their own currency symbol, code or word.
Both accept keyword-only `currency`, `country`, `language`, `url`, `page`
and `html` options. HTML is detected automatically unless `html` is set.
`page` supplies separate HTML for currency evidence. `read_page_signals`
accepts an HTML string and an optional keyword-only `url`.

Python fields use snake_case; `to_dict()` returns the reference camelCase
JSON shape. `amount` is the exact decimal string; `value` is a float.
`index` counts Python characters in the extracted text, not HTML offsets.

Only standard absolute HTTP(S) URLs are read; DOM input is TypeScript only.
URLs are inspected locally, with no network requests.

[Documentation and examples](https://www.dontpayfull.com/labs/global-price-parser/)

## Development

```sh
python3 scripts/sync_data.py
python3 -m venv .venv
.venv/bin/pip install -q -e . pytest
.venv/bin/pytest -q
```

The tests compare every shared `spec/cases/*.jsonl` case with the TypeScript
reference and verify that the packaged JSON data matches `../data`.

---

<p align="center">
Made with ❤️ by the <a href="https://www.dontpayfull.com">DontPayFull</a> team<br>
<sub>Coupon codes and deals for 20,000+ online stores</sub>
</p>
