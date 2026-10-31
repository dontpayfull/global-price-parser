import { decimalsOf } from './currency'
import { formatAmount, parseNumber } from './number'
import { DECIMAL_MARK, normalize } from './normalize'
import { resolveCurrency } from './resolve'
import type { Evidence } from './resolve'
import { scan } from './scan'
import type { Price } from './types'

export interface Candidate {
  price: Price
  /** The price text carries its own currency symbol or code. */
  hasCurrency: boolean
}

/** Every number in `text` read as a price, with its currency resolved against `evidence`. */
export function readPrices(text: string, evidence: Evidence, struck?: boolean[]): Candidate[] {
  const { text: norm, map } = normalize(text)
  const out: Candidate[] = []
  for (const f of scan(norm, evidence.languages)) {
    let res = resolveCurrency(f.token, evidence)
    // A weak token nothing confirmed (`L` in `Size L 19,99`) is not part of the price: read
    // the number alone, so the hints and the page can still give it a currency.
    const rejected = res.rejectedToken
    if (rejected)
      res = resolveCurrency(null, evidence)
    const token = rejected ? null : f.token
    // A minus before the rejected token still belongs to the number: `-R 249.80`.
    const minus = f.minus
    const reading = parseNumber(f.number, {
      currencyKnown: res.currency !== null,
      threeDecimals: res.currency !== null && res.sure && decimalsOf(res.currency) === 3,
    })
    if (!reading)
      continue
    // `¥1.23` cannot be yen (no decimals): when only the default decided, take the
    // first possible currency whose decimals fit the number.
    if (res.decidedBy === 'default' && res.currency && /[1-9]/.test(reading.fraction)
      && reading.fraction.length > decimalsOf(res.currency)) {
      const fit = res.others.find(c => decimalsOf(c) >= reading.fraction.length)
      if (fit) {
        res.others = [res.currency, ...res.others.filter(c => c !== fit)]
        res.currency = fit
      }
    }
    const negative = minus >= 0
    const decimals = res.currency ? decimalsOf(res.currency) : 2
    const amount = formatAmount(reading.integer, reading.fraction, decimals, negative)
    const start = map[rejected ? Math.min(f.numStart, minus >= 0 ? minus : Infinity) : f.start] ?? 0
    const end = map[rejected && !f.per ? f.numEnd : f.end] ?? text.length
    const alt = reading.ambiguous
    out.push({
      hasCurrency: token !== null,
      price: {
        amount,
        value: Number(amount),
        currency: res.currency,
        currencySure: res.sure,
        otherCurrencies: res.others,
        decidedBy: res.decidedBy,
        conflicts: res.conflicts,
        symbol: token ? text.slice(map[token.start], map[token.end]) : null,
        negative: negative && /[1-9]/.test(amount),
        ambiguous: alt
          ? { reason: alt.reason, alternative: `${negative ? '-' : ''}${alt.fraction ? `${alt.integer}.${alt.fraction}` : alt.integer}` }
          : null,
        struck: struck ? struck[map[f.numStart] ?? 0] === true : false,
        per: f.per,
        range: f.range,
        // `<sup>` cents carry an internal marker: show it as the decimal point it stands for.
        raw: text.slice(start, end).replaceAll(DECIMAL_MARK, '.'),
        index: start,
      },
    })
  }
  return out
}
