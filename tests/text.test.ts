import { describe, expect, it } from 'vitest'
import { parsePrice, parsePrices } from '../src/index'

const short = (text: string, options = {}) => {
  const p = parsePrice(text, options)
  return p && `${p.amount} ${p.currency}${p.currencySure ? '' : '?'}`
}

describe('common price formats', () => {
  it.each([
    ['1.299,00 €', '1299.00 EUR'],
    ['$1,299.00', '1299.00 USD?'],
    ['1 299,00 lei', '1299.00 RON?'],
    ['CHF 1\'299.–', '1299.00 CHF'],
    ['₹1,23,456.00', '123456.00 INR'],
    ['12,- €', '12.00 EUR'],
    ['¥1,299', '1299 JPY?'],
    ['-249,80 lei', '-249.80 RON?'],
    ['$25', '25.00 USD?'],
    ['1.299', '1299.00 null?'],
    ['US$ 1,299', '1299.00 USD'],
    ['R$ 1.299,90', '1299.90 BRL'],
    ['1 299,99 zł', '1299.99 PLN'],
    ['1299 Ft', '1299 HUF'],
    ['29.99 USD / month', '29.99 USD'],
    ['KWD 12.500', '12.500 KWD'],
    ['1.299 €', '1299.00 EUR'],
    ['€1.299', '1299.00 EUR'],
    ['kr 1.299,-', '1299.00 SEK?'],
    ['1.299,- kr', '1299.00 SEK?'],
    ['CA$25', '25.00 CAD'],
    ['25 CAD', '25.00 CAD'],
  ])('%s -> %s', (text, out) => {
    expect(short(text)).toBe(out)
  })

  it('ignores zero-width characters', () => {
    expect(short('\u200B25')).toBe('25.00 null?')
    expect(short('Price:\u200B 49,99 \u20AC')).toBe('49.99 EUR')
    expect(short('\uFEFF$\u200D25')).toBe('25.00 USD?')
  })

  it('uses a country hint for $', () => {
    expect(short('$25', { country: 'CA' })).toBe('25.00 CAD')
    expect(parsePrice('$25', { country: 'CA' })!.decidedBy).toBe('hint.country')
  })

  it('uses the domain of a URL for kr', () => {
    expect(short('kr 1.299', { url: 'https://www.elgiganten.dk/product/123' })).toBe('1299.00 DKK')
  })

  it('never lets a signal overrule a clear symbol', () => {
    const p = parsePrice('25 €', { currency: 'USD' })!
    expect(p.currency).toBe('EUR')
    expect(p.decidedBy).toBe('symbol')
  })

  it('records signals that the symbol cannot mean', () => {
    const p = parsePrice('$25', { currency: 'EUR' })!
    expect(p.currency).toBe('USD')
    expect(p.conflicts).toEqual(['hint.currency:EUR'])
  })

  it('lists the other currencies $ could mean', () => {
    const p = parsePrice('$25')!
    expect(p.otherCurrencies.slice(0, 4)).toEqual(['CAD', 'AUD', 'NZD', 'MXN'])
  })

  it('flags a lone 1.299 and gives the other reading', () => {
    expect(parsePrice('1.299')!.ambiguous).toEqual({ reason: 'separator', alternative: '1.299' })
    expect(parsePrice('1.299 €')!.ambiguous).toBeNull()
  })

  it('takes the currency whose decimals fit when only the default decided', () => {
    expect(short('¥1,299')).toBe('1299 JPY?')
    expect(short('¥12.50')).toBe('12.50 CNY?')
  })

  it('reads Arabic digits and separators', () => {
    expect(short('٣٤٫٥٠ ر.س')).toBe('34.50 SAR')
    expect(short('؜-‏١٬٢٣٤٬٥٦٧٫٨٩١ د.ك.‏')).toBe('-1234567.891 KWD')
  })

})

describe('several prices in a text', () => {
  const list = (text: string, options = {}) => parsePrices(text, options).map(p => `${p.amount} ${p.currency}`)

  it('keeps them apart', () => {
    expect(list('Was $59.99, now $39.99')).toEqual(['59.99 USD', '39.99 USD'])
    expect(list('10 € 20 €')).toEqual(['10.00 EUR', '20.00 EUR'])
  })

  it('ignores percentages and numbers without currency', () => {
    expect(list('20% off, item 12345, now 19,99 €')).toEqual(['19.99 EUR'])
  })

  it('reads ranges, and the dash is not a minus sign', () => {
    const r = parsePrices('$10 - $20')
    expect(r.map(p => [p.amount, p.range])).toEqual([['10.00', 'from'], ['20.00', 'to']])
    expect(parsePrices('10-20 €').map(p => [p.amount, p.currency, p.range])).toEqual([['10.00', 'EUR', 'from'], ['20.00', 'EUR', 'to']])
    expect(parsePrices('Item 2 -$5.00').map(p => p.amount)).toEqual(['-5.00'])
    expect(parsePrices('10 - 20 €').map(p => [p.amount, p.range])).toEqual([['10.00', 'from'], ['20.00', 'to']])
    expect(parsePrices('€10 – €20').map(p => p.raw)).toEqual(['€10', '€20'])
  })

  it('reads negative amounts', () => {
    expect(list('Discount: -€5.00')).toEqual(['-5.00 EUR'])
    expect(list('CHF-1\'234.50')).toEqual(['-1234.50 CHF'])
  })

  it('reads cents left after a space when a <sup> lost its markup', () => {
    expect(list('Was €5 99, now €3 99')).toEqual(['5.99 EUR', '3.99 EUR'])
    expect(list('€100 500 03')).toEqual(['100500.03 EUR'])
  })

  it('reads a minus sign one space away', () => {
    expect(list('- 40.99 USD')).toEqual(['-40.99 USD'])
    expect(list('USD - 40.99')).toEqual(['-40.99 USD'])
    expect(list('-50% off: your discount is - 40.99 USD')).toEqual(['-40.99 USD'])
  })

  it('reads the unit glued after a slash, in any language, as a fixed id', () => {
    const per = (text: string, options = {}) => parsePrices(text, options)[0]!.per
    expect(per('2,99 €/kg')).toEqual({ unit: 'kilogram', quantity: 1 })
    expect(per('1,49 €/100 g')).toEqual({ unit: 'gram', quantity: 100 })
    expect(per('14,98 €/l')).toEqual({ unit: 'liter', quantity: 1 })
    expect(per('29,99 €/m²')).toEqual({ unit: 'square-meter', quantity: 1 })
    expect(per('$3.49/lb')).toEqual({ unit: 'pound', quantity: 1 })
    expect(per('$9.99/mo')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('49,99 lei/lună')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('49,99 lei/luna')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('19,90 €/Monat')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('29,90 zł/miesiąc')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('1 990 ₽/мес.')).toEqual({ unit: 'month', quantity: 1 })
    expect(per('99 €/an', { language: 'fr' })).toEqual({ unit: 'year', quantity: 1 })
    expect(per('¥980/か月')).toEqual({ unit: 'month', quantity: 1 })
  })

  it('uses the language for forms that differ between languages', () => {
    const per = (text: string, options = {}) => parsePrices(text, options)[0]!.per
    expect(per('9 €/j', { language: 'fr' })).toEqual({ unit: 'day', quantity: 1 })
    expect(per('9 €/j', { language: 'de' })).toEqual({ unit: 'year', quantity: 1 })
    expect(per('9 €/j')).toBeNull()
    expect(per('9 €/m')).toEqual({ unit: 'meter', quantity: 1 })
  })

  it('reads common unit words even when the page declares the wrong language', () => {
    const per = (text: string, options = {}) => parsePrices(text, options)[0]!.per
    expect(per('49,99 lei/lună', { language: 'en' })).toEqual({ unit: 'month', quantity: 1 })
    expect(per('19,90 €/Monat', { language: 'en' })).toEqual({ unit: 'month', quantity: 1 })
  })

  it('does not read a language-dependent form when the language and the country disagree', () => {
    const per = (text: string, options = {}) => parsePrices(text, options)[0]!.per
    expect(per('9 €/j', { language: 'fr', country: 'FR' })).toEqual({ unit: 'day', quantity: 1 })
    expect(per('9 €/j', { language: 'de', country: 'FR' })).toBeNull()
    expect(per('9 €/j', { url: 'https://boutique.example.fr/p/1' })).toEqual({ unit: 'day', quantity: 1 })
  })

  it('ignores a slash followed by something that is not a unit', () => {
    expect(parsePrices('€10/Stück oder €20')[0]!.per).toBeNull()
    expect(parsePrices('$10 / $20').map(p => p.amount)).toEqual(['10.00', '20.00'])
  })

  it('gives the raw text and its position', () => {
    const [p] = parsePrices('Price: 1.299,00 € today')
    expect(p!.raw).toBe('1.299,00 €')
    expect(p!.index).toBe(7)
  })

  it('ignores single letters that are not confirmed as a currency', () => {
    expect(list('Size L 12')).toEqual([])
    expect(list('R 199', { country: 'ZA' })).toEqual(['199.00 ZAR'])
    expect(list('R199')).toEqual([])
  })
})
