import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { parsePrice, parsePrices, readPageSignals } from '../src/index'

const short = (p: ReturnType<typeof parsePrice>) => p && `${p.amount} ${p.currency}${p.currencySure ? '' : '?'}${p.struck ? ' struck' : ''}`
const all = (html: string, options = {}) => parsePrices(html, options).map(p => short(p))

describe('HTML fragments', () => {
  it('reads cents in <sup>', () => {
    expect(short(parsePrice('<span>$19<sup>99</sup></span>'))).toBe('19.99 USD?')
    expect(short(parsePrice('<span><sup>$</sup>19<sup>99</sup></span>'))).toBe('19.99 USD?')
    expect(short(parsePrice('<span>12<sup>99</sup> €</span>'))).toBe('12.99 EUR')
    expect(short(parsePrice('<span>1.299<sup>00</sup> €</span>'))).toBe('1299.00 EUR')
    expect(parsePrice('<span>$59<sup>99</sup></span>')!.raw).toBe('$59.99')
  })

  it('does not take a footnote or m² for cents', () => {
    expect(short(parsePrice('From $999<sup>1</sup>'))).toBe('999.00 USD?')
    const p = parsePrice('<span>29,99 €/m<sup>2</sup></span>')!
    expect([p.amount, p.per]).toEqual(['29.99', { unit: 'square-meter', quantity: 1 }])
  })

  it('joins a price split over several elements', () => {
    expect(short(parsePrice('<span>1.299</span><span>,00</span><span>€</span>'))).toBe('1299.00 EUR')
    expect(short(parsePrice('<span class="a-price-whole">19<span class="a-price-decimal">.</span></span><span class="a-price-fraction">99</span><span>€</span>'))).toBe('19.99 EUR')
  })

  it('marks struck prices and prefers the one that is not struck', () => {
    expect(all('<del>$59.99</del> <ins>$39.99</ins>')).toEqual(['59.99 USD? struck', '39.99 USD?'])
    expect(short(parsePrice('<s>$59.99</s> $39.99'))).toBe('39.99 USD?')
    expect(short(parsePrice('<span style="text-decoration: line-through">€59</span> €39'))).toBe('39.00 EUR')
  })

  it('skips hidden text, scripts and styles', () => {
    const html = '<span class="sr-only">$19.99</span><span aria-hidden="true">$19<sup>99</sup></span><script>var p = "$5.00"</script><style>.x{}</style>'
    expect(all(html)).toEqual(['19.99 USD?'])
    expect(all('<div hidden>€10</div><div style="display:none">€11</div><div>€12</div>')).toEqual(['12.00 EUR'])
  })

  it('reads the visible copy that is aria-hidden, and skips the screen-reader copy', () => {
    const amazon = '<span class="a-price"><span class="a-offscreen">€28.97</span><span aria-hidden="true"><span class="a-price-symbol">€</span><span class="a-price-whole">28<span class="a-price-decimal">.</span></span><span class="a-price-fraction">97</span></span></span>'
    expect(all(amazon)).toEqual(['28.97 EUR'])
    const ikea = '<span aria-hidden="true"><span class="pipcom-price__currency">CHF</span><span>59</span><span><span>.</span>95</span></span><span class="pipcom-price__sr-text">Preis CHF 59.95</span>'
    expect(all(ikea)).toEqual(['59.95 CHF'])
  })

  it('reads a screen-reader-only fragment when it is all there is', () => {
    expect(short(parsePrice('<span class="a-offscreen">€28.97</span>'))).toBe('28.97 EUR')
  })

  it('keeps block elements apart', () => {
    expect(all('<li>€10</li><li>20 €</li>')).toEqual(['10.00 EUR', '20.00 EUR'])
  })

  it('decodes entities', () => {
    expect(short(parsePrice('<b>1&nbsp;299,00&nbsp;&euro;</b>'))).toBe('1299.00 EUR')
    expect(short(parsePrice('<b>&#36;5</b>'))).toBe('5.00 USD?')
  })
})

describe('page signals', () => {
  const page = (head: string, body: string) => `<!doctype html><html${head.startsWith(' ') ? head : ''}><head>${head.startsWith(' ') ? '' : head}</head><body>${body}</body></html>`

  it('takes the active Shopify currency, never the base one', () => {
    const html = page('<script>Shopify.currency = {"active":"CAD","rate":"1.37"}; Shopify.currency.base = "USD";</script>', '<span>$25.00</span>')
    const p = parsePrice(html)!
    expect([p.currency, p.currencySure, p.decidedBy]).toEqual(['CAD', true, 'page.platform:shopify'])
  })

  it('reads the Shopify PayPal meta tag', () => {
    const html = page('<meta id="in-context-paypal-metadata" data-locale="en_US" data-currency="AUD">', '$49')
    expect(parsePrice(html)!.currency).toBe('AUD')
  })

  it('reads JSON-LD, including ProductGroup and Offers with a capital O', () => {
    const ld = '<script type="application/ld+json">{"@type":"ProductGroup","hasVariant":[{"@type":"Product","Offers":{"@type":"Offer","price":"25","priceCurrency":"NZD"}}]}</script>'
    const p = parsePrice(page(ld, '$25'))!
    expect([p.currency, p.decidedBy]).toEqual(['NZD', 'page.jsonld'])
  })

  it('reads og:price:currency and microdata', () => {
    expect(parsePrice(page('<meta property="og:price:currency" content="SGD">', '$9'))!.currency).toBe('SGD')
    expect(parsePrice(page('', '<span itemprop="price">9</span><meta itemprop="priceCurrency" content="HKD"><b>$9</b>'))!.currency).toBe('HKD')
  })

  it('a page signal cannot overrule a clear symbol', () => {
    const p = parsePrice(page('<meta property="og:price:currency" content="USD">', '<b>25 €</b>'))!
    expect([p.currency, p.decidedBy]).toEqual(['EUR', 'symbol'])
  })

  it('platform beats JSON-LD left on USD by a currency switcher', () => {
    const html = page('<script>Shopify.currency = {"active":"CAD"};</script><script type="application/ld+json">{"offers":{"priceCurrency":"USD"}}</script>', '$25')
    expect(parsePrice(html)!.currency).toBe('CAD')
  })

  it('uses <html lang> with a region, not og:locale', () => {
    const html = '<html lang="en-RO"><head><meta property="og:locale" content="en_GB"></head><body>1.299,99 lei</body></html>'
    const p = parsePrice(html)!
    expect([p.currency, p.currencySure, p.decidedBy]).toEqual(['RON', true, 'page.lang'])
  })

  it('uses the hreflang of the page itself', () => {
    const head = `<link rel="canonical" href="https://shop.example.com/fr-ca/p/1">
      <link rel="alternate" hreflang="en-us" href="https://shop.example.com/en-us/p/1">
      <link rel="alternate" hreflang="fr-ca" href="https://shop.example.com/fr-ca/p/1">
      <link rel="alternate" hreflang="x-default" href="https://shop.example.com/p/1">`
    const signals = readPageSignals(page(head, ''))
    expect(signals.country[0]).toEqual({ source: 'url.hreflang', country: 'CA' })
  })

  it('reads country from the URL path and domain, but not from generic domains', () => {
    expect(parsePrice('$25', { url: 'https://www.example.com/en-ca/p/1' })!.currency).toBe('CAD')
    expect(parsePrice('$25', { url: 'https://www.example.com.au/p/1' })!.currency).toBe('AUD')
    expect(parsePrice('$25', { url: 'https://brand.co/p/1' })!).toMatchObject({ currency: 'USD', decidedBy: 'default' })
    expect(parsePrice('$25', { url: 'https://example.com/it/' })!.decidedBy).toBe('default')
  })

  it('a ?currency= in the URL counts', () => {
    expect(parsePrice('$25', { url: 'https://shop.example.com/p/1?currency=CAD' })!.currency).toBe('CAD')
  })

  it('gives a lone number the page currency', () => {
    const p = parsePrice(page('<meta property="product:price:currency" content="EUR">', '<span class="price">19,99</span>'))!
    expect([p.amount, p.currency]).toEqual(['19.99', 'EUR'])
  })
})

describe('DOM input (jsdom)', () => {
  const dom = new JSDOM(`<!doctype html><html lang="en-CA"><head>
    <script type="application/ld+json">{"@type":"Product","offers":{"price":"59.99","priceCurrency":"CAD"}}</script>
    </head><body><div id="price"><del>$79.99</del> <span>$59<sup>99</sup></span></div>
    <div id="other" style="display:none">$1.00</div></body></html>`, { url: 'https://shop.example.ca/p/1' })
  const doc = dom.window.document

  it('reads an element and the signals of its page', () => {
    const p = parsePrice(doc.getElementById('price')!)!
    expect([p.amount, p.currency, p.currencySure, p.decidedBy, p.struck]).toEqual(['59.99', 'CAD', true, 'page.jsonld', false])
    expect(parsePrices(doc.getElementById('price')!).map(x => [x.amount, x.struck])).toEqual([['79.99', true], ['59.99', false]])
  })

  it('reads a whole document and skips hidden elements', () => {
    expect(parsePrices(doc).map(x => x.amount)).toEqual(['79.99', '59.99'])
  })

  it('reads the signals of a document', () => {
    const s = readPageSignals(doc)
    expect(s.currency[0]).toEqual({ source: 'page.jsonld', currency: 'CAD' })
    expect(s.country.map(c => c.source)).toEqual(['page.lang', 'url.tld'])
  })
})
