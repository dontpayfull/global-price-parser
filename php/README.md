# Global Price Parser for PHP

Read exact amounts, currencies and page signals from plain text or
HTML strings. Requires PHP 8.1+ and `ext-mbstring`; no network calls
or runtime packages.

```sh
composer require dontpayfull/global-price-parser
```

```php
require __DIR__ . '/vendor/autoload.php';

use DontPayFull\GlobalPriceParser\PriceParser;

$price = PriceParser::parsePrice('1.299,00 €');
echo $price->amount . ' ' . $price->currency;
// 1299.00 EUR

$price = PriceParser::parsePrice('$25', [
    'url' => 'https://shop.example.ca/p/1',
]);
echo $price->amount . ' ' . $price->currency;
// 25.00 CAD

$price->currencySure; // true
$price->decidedBy;    // 'url.tld'
$price->toArray();    // All fields, with the reference camelCase keys

$prices = PriceParser::parsePrices(
    '<del>$79.99</del> <ins>$59<sup>99</sup></ins>'
);
$prices[0]->amount; // '79.99'
$prices[0]->struck; // true
$prices[1]->amount; // '59.99'
$prices[1]->struck; // false

$signals = PriceParser::readPageSignals(
    '<html lang="en-CA">'
    . '<script>Shopify.currency={"active":"CAD"}</script></html>'
);
$signals->toArray();
// [
//     'currency' => [
//         ['source' => 'page.platform:shopify', 'currency' => 'CAD'],
//     ],
//     'country' => [['source' => 'page.lang', 'country' => 'CA']],
//     'language' => 'en-CA',
// ]
```

`parsePrice()` returns an immutable `Price` or `null`.
`parsePrices()` returns a list of `Price` objects that carry a
currency token. `readPageSignals()` returns immutable `PageSignals`
and `Signal` objects. All three expose `toArray()`.

Options use the same keys as the TypeScript library: `currency`,
`country`, `language`, `url`, `page` and `html`. The `page` option is
an HTML string. DOM nodes and computed styles are not supported.

`amount` is the exact decimal string; `value` is a float. `index`
counts Unicode code points in the extracted text, not UTF-8 bytes.
`ambiguous` and `per` are associative arrays or `null`.

Full documentation, signal priority and supported formats:
[Global Price Parser](https://www.dontpayfull.com/labs/global-price-parser/).

## Known differences

URLs require standard absolute HTTP(S) form, without backslashes.

## Development

From the repository root:

```sh
composer install
composer test
```

The tests read every case in `spec/cases/*.jsonl`, convert native
indices to UTF-16 units, and print a summary per reference file.
Shared CLDR JSON tables are loaded from `data/` and cached in memory.

Apache-2.0. See the repository's `LICENSE` and `NOTICE` for the
library and Unicode CLDR data terms.

---

<p align="center">
Made with ❤️ by the <a href="https://www.dontpayfull.com">DontPayFull</a> team<br>
<sub>Coupon codes and deals for 20,000+ online stores</sub>
</p>
