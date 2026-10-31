import { describe, expect, it } from 'vitest'
import { REGION_CURRENCIES } from '../src/data/currencies'
import { parsePrice } from '../src/index'

// Every amount is formatted by the runtime's Intl (CLDR) in every country's own locale,
// then parsed back. This covers separators, grouping (incl. Indian), symbol position,
// special spaces, minus signs, bidi marks and native digits (Arabic, Bengali, Devanagari...).
const AMOUNTS = [0.5, 1.23, 12, 1299, 1299.5, 123456.78, 1234567.891, -249.8]
const DISPLAYS = ['symbol', 'narrowSymbol', 'code'] as const

function expected(value: number, currency: string, locale: string): string {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const s = Math.abs(value).toFixed(digits)
  return value < 0 && Number(s) !== 0 ? `-${s}` : s
}

function localeOf(region: string): string {
  const max = new Intl.Locale(`und-${region}`).maximize()
  return `${max.language}-${max.script ? `${max.script}-` : ''}${region}`
}

// The strings come from the runtime's own CLDR: an old one (Node 18) writes some currencies
// differently from the data in this package, so the test needs a recent one.
const RECENT_CLDR = Number(process.versions.cldr ?? 0) >= 46

describe.skipIf(!RECENT_CLDR)('Intl round trip', () => {
  it('reads back every country\'s own currency, in its own locale, with the country as hint', () => {
    const failures: string[] = []
    let count = 0
    for (const [region, currencies] of Object.entries(REGION_CURRENCIES)) {
      const currency = currencies[0]!
      const locale = localeOf(region)
      for (const display of DISPLAYS) {
        for (const value of AMOUNTS) {
          const text = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display }).format(value)
          const want = expected(value, currency, locale)
          const p = parsePrice(text, { country: region })
          count++
          if (!p || p.amount !== want || p.currency !== currency)
            failures.push(`${locale} ${display} ${JSON.stringify(text)} -> ${p ? `${p.amount} ${p.currency}` : 'null'} (want ${want} ${currency})`)
        }
      }
    }
    expect(failures.slice(0, 40), `${failures.length} of ${count} failed`).toEqual([])
  })

  it('reads back foreign currencies written as ISO codes in every locale, without hints', () => {
    const failures: string[] = []
    let count = 0
    const foreign = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'INR', 'KWD', 'BRL']
    for (const region of Object.keys(REGION_CURRENCIES)) {
      const locale = localeOf(region)
      for (const currency of foreign) {
        for (const value of AMOUNTS) {
          const text = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code' }).format(value)
          const want = expected(value, currency, locale)
          const p = parsePrice(text)
          count++
          if (!p || p.amount !== want || p.currency !== currency || !p.currencySure)
            failures.push(`${locale} ${JSON.stringify(text)} -> ${p ? `${p.amount} ${p.currency}` : 'null'} (want ${want} ${currency})`)
        }
      }
    }
    expect(failures.slice(0, 40), `${failures.length} of ${count} failed`).toEqual([])
  })

  it('reads the amount right even without any hint', () => {
    const failures: string[] = []
    let count = 0
    for (const [region, currencies] of Object.entries(REGION_CURRENCIES)) {
      const currency = currencies[0]!
      const locale = localeOf(region)
      for (const value of AMOUNTS) {
        const text = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'symbol' }).format(value)
        const p = parsePrice(text)
        count++
        if (!p) {
          failures.push(`${locale} ${JSON.stringify(text)} -> null`)
          continue
        }
        // Without a hint the currency may be a default (¥ = JPY in China); the number must still be right.
        const want = expected(value, currency, locale)
        if (Number(p.amount) !== Number(want))
          failures.push(`${locale} ${JSON.stringify(text)} -> ${p.amount} ${p.currency} (want ${want})`)
      }
    }
    expect(failures.slice(0, 40), `${failures.length} of ${count} failed`).toEqual([])
  })
})
