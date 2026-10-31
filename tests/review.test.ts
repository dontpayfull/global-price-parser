import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { parsePrice, parsePrices, readPageSignals } from '../src/index'

const short = (p: ReturnType<typeof parsePrice>) => p && `${p.amount} ${p.currency}${p.currencySure ? '' : '?'}`

describe('words and units are not currencies', () => {
  it('never reads built-in object keys as tokens or units', () => {
    expect(short(parsePrice('10 toString'))).toBe('10.00 null?')
    expect(short(parsePrice('10 __proto__'))).toBe('10.00 null?')
    expect(parsePrice('€10/constructor')!.per).toBeNull()
    expect(readPageSignals('<html lang="&constructor;"></html>').language).toBe('&constructor;')
  })

  it('does not take units, prepositions or page numbers for currencies', () => {
    expect(short(parsePrice('Kettlebell 10 Kg, now $25.00'))).toBe('25.00 USD?')
    expect(short(parsePrice('Heater 10 kW for €199.00'))).toBe('199.00 EUR')
    expect(short(parsePrice('100 km'))).toBe('100.00 null?')
    expect(short(parsePrice('Livraison le 15: 29,90 €'))).toBe('29.90 EUR')
    expect(short(parsePrice('see p. 12'))).toBe('12.00 null?')
    expect(short(parsePrice('W 2024 r. cena 99 zł'))).toBe('99.00 PLN')
    expect(short(parsePrice('Vote $25'))).toBe('25.00 USD?')
  })

  it('reads a short abbreviation only when something confirms it', () => {
    expect(short(parsePrice('100 KM'))).toBe('100.00 null?')
    expect(short(parsePrice('100 KM', { country: 'BA' }))).toBe('100.00 BAM')
    expect(short(parsePrice('500р', { country: 'RU' }))).toBe('500.00 RUB')
  })

  it('lets a real symbol win over a size letter', () => {
    expect(short(parsePrice('Size L 19,99 €'))).toBe('19.99 EUR')
    expect(parsePrices('Größe M 19,99 € (statt 29,99 €)').map(p => p.amount)).toEqual(['19.99', '29.99'])
    expect(short(parsePrice('12 L', { currency: 'EUR' }))).toBe('12.00 EUR')
  })

  it('keeps the shop spellings CLDR does not list', () => {
    expect(short(parsePrice('1 299 Ft'))).toBe('1299 HUF')
    expect(short(parsePrice('25 din.'))).toBe('25.00 RSD')
    expect(short(parsePrice('S/ 49.90'))).toBe('49.90 PEN')
  })
})

describe('hints and signals that cannot make a currency sure', () => {
  it('a language without region only guesses', () => {
    expect(short(parsePrice('$25', { language: 'en' }))).toBe('25.00 USD?')
    expect(short(parsePrice('$25', { language: 'en-CA' }))).toBe('25.00 CAD')
  })

  it('two currencies from the same source are not sure', () => {
    const p = parsePrice('<script type="application/ld+json">[{"priceCurrency":"USD"},{"priceCurrency":"CAD"}]</script>$25')!
    expect([p.currency, p.currencySure, p.otherCurrencies]).toEqual(['USD', false, ['CAD']])
  })

  it('ignores scripts that never run (inside template, noscript, textarea, title)', () => {
    for (const tag of ['template', 'noscript', 'textarea', 'title'])
      expect(readPageSignals(`<${tag}><script>Shopify.currency = {"active":"CAD"}</script></${tag}>`).currency).toEqual([])
    const html = '<script>const example = "<template>"; Shopify.currency = {"active":"CAD"};</script>'
    expect(readPageSignals(html).currency).toEqual([{ source: 'page.platform:shopify', currency: 'CAD' }])
  })

  it('reads language and region pairs in URL paths both ways', () => {
    const country = (url: string) => readPageSignals('', { url }).country.map(s => s.country)
    expect(country('https://x.example/fr/ca/p/1')).toEqual(['CA'])
    expect(country('https://x.example/de/ch/p/1')).toEqual(['CH'])
    expect(country('https://x.example/pt/br/')).toEqual(['BR'])
    expect(country('https://x.example/ca/fr/')).toEqual(['CA'])
    expect(country('https://x.example/us/en/')).toEqual(['US'])
    expect(country('https://x.example/do/it')).toEqual([])
    expect(country('ftp://shop.example.ca/p/1')).toEqual([])
  })
})

describe('HTML details', () => {
  it('reads cents in <sup> with native digits or a symbol inside, and drops footnotes', () => {
    expect(short(parsePrice('<span>٣٤<sup>٥٠</sup> ر.س</span>'))).toBe('34.50 SAR')
    expect(short(parsePrice('<span>٣٤<sup>١</sup> ر.س</span>'))).toBe('34.00 SAR')
    expect(short(parsePrice('<span>19<sup>99 €</sup></span>'))).toBe('19.99 EUR')
    expect(short(parsePrice('<span>$999<sup>1,2</sup></span>'))).toBe('999.00 USD?')
    expect(parsePrice('<span>1.299<sup>.00</sup> €</span>')!.ambiguous).toBeNull()
  })

  it('finds a screen-reader price next to other numbers', () => {
    const html = '<div><span>Pack of 2</span><span class="a-offscreen">$19.99</span></div>'
    expect(parsePrices(html).map(p => p.amount)).toEqual(['19.99'])
    const dom = new JSDOM('<div class="price"><span class="a-offscreen">€28.97</span></div>')
    expect(short(parsePrice(dom.window.document.querySelector('.price')!))).toBe('28.97 EUR')
  })

  it('collapses whitespace between elements, also runs of &nbsp;', () => {
    expect(short(parsePrice('<div>\n  <span>$</span>\n  <span>299</span>\n  <span>00</span>\n</div>'))).toBe('299.00 USD?')
    expect(short(parsePrice('<span>$</span>&nbsp;&nbsp;&nbsp;<span>25</span>'))).toBe('25.00 USD?')
  })

  it('does not decode DOM text twice', () => {
    const dom = new JSDOM('<span>&amp;euro; 25</span>')
    expect(parsePrice(dom.window.document.querySelector('span')!)!.currency).toBeNull()
  })

  it('keeps surrogate references as written and survives emoji', () => {
    expect(short(parsePrice('<p>&#55357;&#56832; 10 €</p>'))).toBe('10.00 EUR')
    const p = parsePrice('😀 10 €')!
    expect([p.raw, p.symbol, p.index]).toEqual(['10 €', '€', 3])
  })

  it('skips scripts on Turkish pages without losing what follows', () => {
    const html = `<nav>${'İ'.repeat(20)}</nav><script>var a=1</script><p>1.299,90 TL</p>`
    expect(short(parsePrice(html))).toBe('1299.90 TRY')
  })

  it('ignores a private-use character that looks like our decimal mark', () => {
    expect(parsePrice('$123')!.amount).toBe('123.00')
  })
})

describe('hostile input stays fast', () => {
  const fast = (f: () => unknown) => {
    const t0 = performance.now()
    f()
    return performance.now() - t0
  }

  it('handles markup built to make regexes backtrack', () => {
    expect(fast(() => readPageSignals('<div itemprop=priceCurrency '.repeat(1800)))).toBeLessThan(500)
    expect(fast(() => parsePrice(`<script>${'prestashop={"currency":{'.repeat(2000)}</script>$25`))).toBeLessThan(500)
    expect(fast(() => parsePrice('<a'.repeat(50000)))).toBeLessThan(500)
    expect(fast(() => parsePrice(`<div ${'"'.repeat(50000)}`))).toBeLessThan(500)
    expect(fast(() => parsePrice(`${'<script>var a=1;</script><p>word</p>'.repeat(20000)}<p>€ 5</p>`))).toBeLessThan(2000)
  })
})

describe('second review round', () => {
  const amounts = (input: string) => parsePrices(input).map(p => p.amount)

  it('reads tags the way a browser does: quoted values may hold < and >', () => {
    expect(short(parsePrice('<span title="<b>$999</b>">$25</span>'))).toBe('25.00 USD?')
    expect(parsePrice('<del title="x < y">$999</del><span>$25</span>')!.amount).toBe('25.00')
    expect(amounts('<span hidden title="x < y">$999</span><span>$25</span>')).toEqual(['25.00'])
  })

  it('keeps everything inside nested templates and svg out', () => {
    expect(short(parsePrice('<template><template></template><script>Shopify.currency={"active":"CAD"}</script></template>$25'))).toBe('25.00 USD?')
    expect(amounts('<svg><svg></svg><text>$999</text></svg>$25')).toEqual(['25.00'])
  })

  it('reads script text as script text: comments and closing tags in strings do not count', () => {
    expect(short(parsePrice('<script>const x="<!--";</script><meta property="product:price:currency" content="CAD">$25'))).toBe('25.00 CAD')
    expect(short(parsePrice('$25', { page: '<script>var s = "</script"; var t = "<meta property=og:price:currency content=CAD>";</script>$25' }))).toBe('25.00 USD?')
  })

  it('prefers the hreflang of the page URL over the canonical, and doubts conflicting ones', () => {
    const page = '<link rel="canonical" href="https://x.example/p"><link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="?locale=ca">'
    expect(short(parsePrice('$25', { url: 'https://x.example/p?locale=ca', page }))).toBe('25.00 CAD')
    const both = '<link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="/p">'
    expect(short(parsePrice('$25', { url: 'https://x.example/p', page: both }))).toBe('25.00 USD?')
  })

  it('counts every signal of one source, wherever it comes in the list', () => {
    const html = '<script>Shopify.currency={"active":"CAD"}; BCData={"current_currency_code":"EUR"}</script><meta id="in-context-paypal-metadata" data-currency="USD">$25'
    expect(short(parsePrice(html))).toBe('25.00 CAD?')
  })

  it('gives each of two glued prices its own symbol', () => {
    expect(amounts('<span>10€</span><span>20€</span>')).toEqual(['10.00', '20.00'])
    expect(amounts('Pack of 2$19.99')).toEqual(['19.99'])
  })

  it('does not let a size letter shape a range or eat a minus', () => {
    expect(amounts('Size L 10-20 €')).toEqual(['10.00', '20.00'])
    expect(short(parsePrice('Size L 2 -$5.00'))).toBe('-5.00 USD?')
  })

  it('drops footnote letters and marks in <sup>', () => {
    expect(short(parsePrice('<span>19,99<sup>a</sup> €</span>'))).toBe('19.99 EUR')
    expect(short(parsePrice('<span>19<sup>99*</sup> €</span>'))).toBe('19.99 EUR')
  })

  it('measures script windows in characters, as the ports do', () => {
    const html = `<script>checkoutConfig = {"a":"${'😀'.repeat(11000)}","currencyCode":"CAD"};</script>`
    expect(readPageSignals(html).currency).toEqual([{ source: 'page.platform:magento', currency: 'CAD' }])
  })

  it('stays linear on long tag names, stray closing tags and nested <sup>', () => {
    const fast = (f: () => unknown) => {
      const t0 = performance.now()
      f()
      return performance.now() - t0
    }
    expect(fast(() => parsePrice(`<${'a'.repeat(100000)}`, { html: true }))).toBeLessThan(300)
    expect(fast(() => parsePrice(`${'<b><i>'.repeat(20000)}${'</u>'.repeat(25000)}$10`))).toBeLessThan(500)
    expect(fast(() => parsePrice(`${'<sup>a'.repeat(10000)}${'</sup>'.repeat(10000)} $10`))).toBeLessThan(500)
    expect(fast(() => parsePrice(`${'<a title="x'.repeat(20000)}$10`, { html: true }))).toBeLessThan(500)
    expect(fast(() => readPageSignals(`${'<!--'.repeat(30000)}${'<template>'.repeat(30000)}`))).toBeLessThan(500)
  })
})
