// Writes spec/cases/*.jsonl: inputs with the exact output of this (reference) TypeScript
// implementation. The ports in other languages (python/, php/) must return the same.
// Run after `npm run build`: node scripts/gen-cases.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrice, parsePrices, readPageSignals } from '../dist/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'spec/cases')
mkdirSync(out, { recursive: true })

function write(name, cases) {
  const lines = cases.map(c => JSON.stringify(c))
  writeFileSync(join(out, `${name}.jsonl`), `${lines.join('\n')}\n`)
  console.log(`${name}: ${cases.length} cases`)
}

function both(input, options) {
  const c = options ? { input, options } : { input }
  return [
    { fn: 'parsePrice', ...c, expected: parsePrice(input, options) },
    { fn: 'parsePrices', ...c, expected: parsePrices(input, options) },
  ]
}

// 1. Every quoted string with a digit in the test files, with no options.
const seen = new Set()
const fromTests = []
for (const f of readdirSync(join(root, 'tests')).filter(f => f.endsWith('.ts'))) {
  const src = readFileSync(join(root, 'tests', f), 'utf8')
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    let s = m[1] ?? m[2]
    try { s = JSON.parse(`"${s.replace(/\\'/g, '\'').replace(/"/g, '\\"')}"`) }
    catch { continue }
    if (!/\d/.test(s) || s.length > 400 || seen.has(s))
      continue
    seen.add(s)
    fromTests.push(...both(s))
  }
}
write('from-tests', fromTests)

// 2. Options, page signals and HTML, written by hand.
const page = (head, body, attrs = '') => `<!doctype html><html${attrs}><head>${head}</head><body>${body}</body></html>`
const curated = [
  ...both('$25', { country: 'CA' }),
  ...both('$25', { currency: 'AUD' }),
  ...both('$25', { currency: 'EUR' }),
  ...both('$25', { language: 'en-NZ' }),
  ...both('$25', { language: 'es' }),
  ...both('$25', { language: 'zh-Hant' }),
  ...both('$25', { language: 'sr-Latn' }),
  ...both('$25', { language: 'en-840' }),
  ...both('$25', { language: 'en_CA' }),
  ...both('$25', { language: 'en-UK' }),
  ...both('£25', { language: 'en-UK' }),
  ...both('Rp 25.000', { language: 'in' }),
  ...both('$25', { language: 'en-BU' }),
  ...both('$25', { language: 'sh-YU' }),
  ...both('25 €', { language: 'cnr' }),
  ...both('25 din.', { language: 'cnr-RS' }),
  ...both('$25', { language: 'prs' }),
  ...both('25 ریال', { language: 'prs-IR' }),
  ...both('25 FC', { language: 'swc' }),
  ...both('$10/kg.2'),
  ...both('kr 299', { country: 'NO' }),
  ...both('kr 299', { url: 'https://www.shop.example.dk/p/1' }),
  ...both('699,-', { url: 'https://www.shop.example.no/p/1' }),
  ...both('19,99', { currency: 'EUR' }),
  ...both('19,99', { country: 'DE' }),
  ...both('$25', { url: 'https://shop.example.ca/p/1' }),
  ...both('$25', { url: 'https://www.example.com/en-ca/p/1' }),
  ...both('$25', { url: 'https://www.example.com.au/p/1' }),
  ...both('$25', { url: 'https://brand.co/p/1' }),
  ...both('$25', { url: 'https://example.com/it/' }),
  ...both('$25', { url: 'https://shop.example.com/p/1?currency=CAD' }),
  ...both('$25', { url: 'https://shop.example.com/p/1?country=MX' }),
  ...both('¥12.50'),
  ...both('¥12,800', { country: 'CN' }),
  ...both('29,99 €/m', { language: 'ro' }),
  ...both('199 lei/lună', { language: 'ro-RO' }),
  ...both('$9.99/mo', { language: 'en-US' }),
  ...both('1.234', { currency: 'KWD' }),
  ...both('1.234', { currency: 'EUR' }),
  ...both('<span>12,99</span>', { html: true, currency: 'EUR' }),
  ...both('1 < 2 and 3 > 2 cost $5', { html: false }),
  ...both(page('<script>Shopify.currency = {"active":"CAD","rate":"1.37"}; Shopify.currency.base = "USD";</script>', '<span>$25.00</span>')),
  ...both(page('<meta id="in-context-paypal-metadata" data-locale="en_US" data-currency="AUD">', '$49')),
  ...both(page('<script type="application/ld+json">{"@type":"ProductGroup","hasVariant":[{"@type":"Product","Offers":{"@type":"Offer","price":"25","priceCurrency":"NZD"}}]}</script>', '$25')),
  ...both(page('<meta property="og:price:currency" content="SGD">', '$9')),
  ...both(page('', '<span itemprop="price">9</span><meta itemprop="priceCurrency" content="HKD"><b>$9</b>')),
  ...both(page('<meta property="og:price:currency" content="USD">', '<b>25 €</b>')),
  ...both(page('<script>Shopify.currency = {"active":"CAD"};</script><script type="application/ld+json">{"offers":{"priceCurrency":"USD"}}</script>', '$25')),
  ...both(page('<meta property="og:locale" content="en_GB">', '1.299,99 lei', ' lang="en-RO"')),
  ...both(page('<meta property="product:price:currency" content="EUR">', '<span class="price">19,99</span>')),
  ...both(page('<script>var BCData = {"product_attributes":{},"current_currency_code":"NZD"};</script>', '$30')),
  ...both(page('<script>dataLayer.push({"event":"view_item","ecommerce":{"currency":"MXN","value":25}});</script>', '$25')),
  ...both(page('<script>gtag("event", "view_item", {"currency": "CLP", "value": 25000});</script>', '$25.000')),
  ...both(page('<script>fbq("track", "ViewContent", {"currency": "NOK", "value": 299});</script>', 'kr 299')),
  ...both(page('<script>var prestashop = {"currency":{"iso_code":"CHF","sign":"CHF"},"country":{"iso_code":"CH"}};</script>', '29.90')),
  ...both(page('', '<span>$59</span>', ' lang="en-CA"')),
  ...both(page('<link rel="canonical" href="https://shop.example.com/fr-ca/p/1"><link rel="alternate" hreflang="en-us" href="https://shop.example.com/en-us/p/1"><link rel="alternate" hreflang="fr-ca" href="https://shop.example.com/fr-ca/p/1">', '$25')),
  ...both('<del>$59.99</del> <ins>$39.99</ins>'),
  ...both('<span style="text-decoration: line-through">€59</span> €39'),
  ...both('<span class="sr-only">$19.99</span><span aria-hidden="true">$19<sup>99</sup></span><script>var p = "$5.00"</script>'),
  ...both('<div hidden>€10</div><div style="display:none">€11</div><div style="visibility: hidden">€12</div><div>€13</div>'),
  ...both('<span class="a-offscreen">€28.97</span>'),
  ...both('<li>€10</li><li>20 €</li>'),
  ...both('<b>1&nbsp;299,00&nbsp;&euro;</b> <i>&#36;5</i> <u>&#x20AC;7</u>'),
  ...both('<span>29,99 €/m<sup>2</sup></span>'),
  ...both('From $999<sup>1</sup>'),
  ...both('<span>1.299</span><span>,00</span><span>€</span>'),
  // Found by the release reviews (CodeRabbit, Codex, Grok, Antigravity, Cursor).
  ...['10 toString', '10 valueOf', '10 __proto__', '10 constructor', '€10/constructor', '€10/toString',
    'see p. 12', 'see r. 12', '500р', '100 р', 'Kettlebell 10 Kg, now $25.00', '10 kg.', 'Heater 10 kW for €199.00',
    'Speaker 90 dB, $49.99', '100 km', '10 km 19,99 €', 'Livraison le 15: 29,90 €', 'Abholung um 10: 19,99 €',
    'W 2024 r. cena 99 zł', '100 fr', 'Vote $25', 'Cable 6 ft, now $19.99', 'rm 10', 'RM 10', '100 KM',
    '😀 10 €', '😀😀 10 €', '💰 25 €', 'Size L 19,99 €', 'Größe M 19,99 € (statt 29,99 €)', '-L 12', '-R 249.80',
    '123', '$123', '1 299 Ft', '25 din.', '25 дин.', 'Tk 500', 'S/ 49.90', 'RD$ 1,500',
    '.99 EUR', '$.99', '-.50 €', 'v1.5', '𝟙𝟚.𝟝𝟘 EUR', '19,9999 €', '¥1.23', '100 kr.', '2$19.99', '2 $19.99',
    '10 € 20', '10 € 20 €', '10 - 20 €', 'Item 2 -$5.00', 'Total - 5 €'].flatMap(x => both(x)),
  ...both('500р', { country: 'RU' }),
  ...both('100 KM', { country: 'BA' }),
  ...both('12 L', { currency: 'EUR' }),
  ...both('300 L', { url: 'https://www.emag.ro/p/1' }),
  ...both('$25', { language: 'en' }),
  ...both('25', { language: 'es' }),
  ...both('100 kr', { language: 'sv' }),
  ...both('$1.50', { country: 'CO' }),
  ...both('¥1.23', { currency: 'JPY' }),
  ...['https://www.example.com/fr/ca/p/1', 'https://www.example.com/de/ch/p/1', 'https://www.example.com/es/ar/p/1',
    'https://x.example/pt/br/', 'https://x.example/ca/fr/', 'https://x.example/us/en/', 'https://shop.example.com/do/it',
    'https://x.example/in/to/', 'https://x.example/en-gb/p', 'https://x.example/uk/en/', 'ftp://shop.example.ca/p/1',
    'file://shop.example.ca/a', 'https://shop.example.ag/p/1', 'https://shop.example.ck/', 'https://shop.example.pw/']
    .flatMap(url => both('$25', { url })),
  ...both('$25', { page: '<script type="application/ld+json">[{"priceCurrency":"CAD"},{"priceCurrency":"USD"}]</script>' }),
  ...both('<p>$25</p><!-- <meta property="og:price:currency" content="CAD"> -->'),
  ...both('<p>$25</p><script>var x = \'<meta property="og:price:currency" content="CAD">\'</script>'),
  ...both('$25', { url: 'https://example.com/p?locale=ca', page: '<link rel="alternate" hreflang="en-US" href="https://example.com/p?locale=us"><link rel="alternate" hreflang="en-CA" href="https://example.com/p?locale=ca">' }),
  ...both('$25', { url: 'https://example.com/ca/p?utm=x', page: '<link rel="alternate" hreflang="en-CA" href="https://example.com/ca/p"><link rel="alternate" hreflang="en-US" href="https://example.com/us/p">' }),
  ...both('$25', { url: 'https://example.com/p?utm=x', page: '<link rel="alternate" hreflang="en-CA" href="https://example.com/p?l=ca"><link rel="alternate" hreflang="en-US" href="https://example.com/p?l=us">' }),
  ...['<span>٣٤<sup>٥٠</sup> ر.س</span>', '<span>٣٤<sup>١</sup> ر.س</span>', '<span>19<sup>99 €</sup></span>',
    '<span>$999<sup>1,2</sup></span>', '<span>$999<sup>1-2</sup></span>', '<span>1.299<sup>.00</sup> €</span>',
    '<div><span>Pack of 2</span><span class="a-offscreen">$19.99</span></div>',
    '<div><span>2 items (5 stars)</span><span class="a-offscreen">$19.99</span></div>',
    '<span>$</span>&nbsp;&nbsp;&nbsp;<span>25</span>', '<div>\n  <span>$</span>\n  <span>299</span>\n  <span>00</span>\n</div>',
    '<p>&#55357;&#56832; 10 €</p>', '<p>&#xD800; 10 €</p>', '<b>&#x1F600; 10 €</b>', '<b>&#99999999; 25 EUR</b>',
    '<html lang="&constructor;"><body>$5</body></html>', '<span>&amp;euro; 25</span>', '<b>&tostring; 25 €</b>',
    `<nav>${'İ'.repeat(20)}</nav><script>var a=1</script><p>1.299,90 TL</p>`, `<script>${'İ'.repeat(9)}</script>$10<div>`,
    '<script>var s = "</script> $100.00";</script> $5.00', '<SCRIPT>x</SCRIPT >$7', '<script>a</scripture>$8</script>$9',
    '💰<del>$5</del> $25', '<div>12</div><sup>99</sup><span>€</span>'].flatMap(x => both(x)),
  // Second review round.
  ...['<span title="<b>$999</b>">$25</span>', '<del title="x < y">$999</del><span>$25</span>',
    '<span hidden title="x < y">$999</span><span>$25</span>', '<a href=\'x>y\'>$5</a>', '<' + 'a'.repeat(300), 'a < b, 5 €', '1<2 €',
    '<template><template></template><script>Shopify.currency={"active":"CAD"}</script></template>$25',
    '<template><p>$999</p></template><p>$25</p>', '<svg><svg></svg><text>$999</text></svg>$25',
    '<script>const x="<!--";</script><meta property="product:price:currency" content="CAD">$25',
    '<!-- a --><p>$5</p><!--> <p>$6</p><!---> <p>$7</p><!-- open', '<!doctype html><![CDATA[ $9 ]]><p>$8</p>',
    '<span>10€</span><span>20€</span>', '10€20€', 'Size L 10-20 €', 'Size L 10 - 20 €', 'Size L 2 -$5.00',
    '<script>Shopify.currency={"active":"CAD"}; BCData={"current_currency_code":"EUR"}</script><meta id="in-context-paypal-metadata" data-currency="USD">$25',
    '<span>19,99<sup>a</sup> €</span>', '<span>19<sup>99*</sup> €</span>', '<span>19,99<sup>*</sup> €</span>', '<span>19<sup>99†</sup> €</span>',
    '<b><i><sup>1<sub>2</sub></sup></i></b> $3', '<sup>a<sup>b</sup>c</sup>$4'].flatMap(x => both(x)),
  ...both('$25', { url: 'https://x.example/p?locale=ca', page: '<link rel="canonical" href="https://x.example/p"><link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="?locale=ca">' }),
  ...both('$25', { url: 'https://x.example/p', page: '<link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="/p">' }),
  ...both('$25', { page: '<script>var a = "<!--";</script><meta property="og:price:currency" content="CAD"><p>$25</p><!-- footer -->' }),
  ...both('$25', { page: '<script>var s = "</script"; var t = "<meta property=og:price:currency content=CAD>";</script>$25' }),
  ...both('$25', { page: '<script>var s = "</script"; var t = "<template>"; Shopify.currency = {"active":"CAD"};</script>$25' }),
]
write('curated', curated)

// 3. readPageSignals on the pages above.
const signals = curated
  .filter(c => c.fn === 'parsePrice' && /<html/.test(c.input))
  .map(c => ({ fn: 'readPageSignals', input: c.input, expected: readPageSignals(c.input) }))
for (const url of ['https://www.example.com/en-au/p/1?currency=AUD', 'https://www.example.com/fr/ca/p/1', 'https://x.example/do/it', 'ftp://shop.example.ca/p'])
  signals.push({ fn: 'readPageSignals', input: '', options: { url }, expected: readPageSignals('', { url }) })
for (const input of ['<html lang="0"></html>', '<html lang="en-CA\n"></html>', '<html lang="&constructor;"></html>',
  `<script type="application/ld+json">${'['.repeat(600)}{"priceCurrency":"CAD"}${']'.repeat(600)}</script>`,
  '<script type="application/ld+json">{"name":"\uD800","priceCurrency":" CAD "}</script>',
  ...["template", "noscript", "textarea", "title"].map(t => `<${t}><script>Shopify.currency = {"active":"CAD"}</script></${t}>`),
  '<script>const example = "<template>"; Shopify.currency = {"active":"CAD"};</script>',
  '<script>var t = "<title>"; Shopify.currency = {"active":"NZD"};</script><title>Shop</title><meta property="og:price:currency" content="NZD">',
  '<span itemprop="priceCurrency">CAD</span><span itemprop=pricecurrency content=" EUR "></span>',
  '<script type="application/ld+json">{"priceCurrency":"CAD"}', '<script>Shopify.currency = {"active":"CAD"}',
  `<script>checkoutConfig = {"a":"${'😀'.repeat(11000)}","currencyCode":"CAD"};</script>`,
  '<meta content="CAD" property="og:price:currency" data-x="a>b"><link rel="alternate" hreflang="fr-CA" href="https://x.example/">'])
  signals.push({ fn: 'readPageSignals', input, expected: readPageSignals(input) })
write('signals', signals)

// 4. Intl round trip: every country's currency in its own locale, as symbol, narrow symbol
//    and code, with and without the country. The strings come from this Node's CLDR.
const regions = JSON.parse(readFileSync(join(root, 'data/currencies.json'), 'utf8')).regions
const AMOUNTS = [0.5, 1.23, 12, 1299, 1299.5, 123456.78, 1234567.891, -249.8]
const localeOf = (region) => {
  const max = new Intl.Locale(`und-${region}`).maximize()
  return `${max.language}-${max.script ? `${max.script}-` : ''}${region}`
}
const roundtrip = []
for (const [region, currencies] of Object.entries(regions)) {
  const currency = currencies[0]
  const locale = localeOf(region)
  for (const display of ['symbol', 'narrowSymbol', 'code']) {
    for (const value of AMOUNTS) {
      const text = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display }).format(value)
      roundtrip.push({ fn: 'parsePrice', input: text, options: { country: region }, expected: parsePrice(text, { country: region }) })
      if (display === 'symbol')
        roundtrip.push({ fn: 'parsePrice', input: text, expected: parsePrice(text) })
    }
  }
}
write('roundtrip', roundtrip)
