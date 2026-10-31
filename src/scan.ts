import { tokenAfter, tokenBefore } from './currency'
import type { TokenMatch } from './currency'
import { readPer } from './units'
import type { Per } from './units'

/** One number found in a (normalized) text, with what surrounds it. */
export interface Found {
  /** The number as written (normalized). */
  number: string
  numStart: number
  numEnd: number
  token: TokenMatch | null
  /** Position of a minus sign that belongs to this price, or -1. */
  minus: number
  /** Extent of the whole price (minus, token and number). */
  start: number
  end: number
  range: 'from' | 'to' | null
  per: Per | null
}

// Digits with separators. A space separates thousands only before exactly 3 digits. A price
// may start with its decimal point (`.99 EUR`, `$.99`).
const NUMBER = /(?:(?<![\d.,])[.,](?=\d{1,2}(?![\d.,'])))?\d+(?:(?:[.,']|\uE000| (?=\d{3}(?!\d)))\d+)*(?:[.,]-{1,2}(?!\d)| \d{2}(?!\d|[.,]\d))?/g
const PERCENT = /^ ?[%‰]/
const MAX_GAP = 2

function skipSpacesBack(text: string, pos: number): number {
  let p = pos
  while (p > 0 && pos - p < MAX_GAP && text[p - 1] === ' ')
    p--
  return p
}

function skipSpaces(text: string, pos: number): number {
  let p = pos
  while (p < text.length && p - pos < MAX_GAP && text[p] === ' ')
    p++
  return p
}

interface Raw {
  number: string
  numStart: number
  numEnd: number
  left: TokenMatch | null
  right: TokenMatch | null
  /** Minus directly before the number, or before the left token. */
  minusNum: number
  minusTok: number
}

/**
 * A symbol between two numbers (`2 $19.99`, `2$19.99`) goes to the one it is closer to; when
 * it touches both, to the one it is written before, unless that one has its own symbol after
 * it (`10€20€`).
 */
function belongsToNext(r: Raw, next: Raw | undefined): boolean {
  if (!next || next.left?.start !== r.right!.start)
    return false
  const before = r.right!.start - r.numEnd
  const after = next.numStart - r.right!.end
  return after < before || (after === 0 && before === 0 && !next.right)
}

export function scan(text: string, languages: readonly string[] = []): Found[] {
  const raws: Raw[] = []
  for (const m of text.matchAll(NUMBER)) {
    const numStart = m.index!
    const numEnd = numStart + m[0].length
    if (PERCENT.test(text.slice(numEnd, numEnd + 2)))
      continue
    // A digit glued before (e.g. a SKU like `A1234`) or a letter glued to the digits.
    if (numStart > 0 && /[\p{L}\d]/u.test(text[numStart - 1]!) && !tokenBefore(text, numStart))
      continue

    // A minus sign before the number or before its currency, at most one space away:
    // `-10 €`, `- 40.99 USD`, `-$5`, `USD - 40.99`, `CHF-1'234.50`. A dash glued to a
    // number before it is a range (`10-20 €`), handled below.
    const dashBefore = (pos: number): number => {
      const q = text[pos - 1] === ' ' ? pos - 1 : pos
      return text[q - 1] === '-' ? q - 1 : -1
    }
    const freeDash = (dash: number): boolean => dash === 0 || /[\s:(\-]/.test(text[dash - 1]!)
    let minusNum = -1
    let left: TokenMatch | null = null
    const dash = dashBefore(numStart)
    if (dash >= 0) {
      const tokenBeforeDash = tokenBefore(text, skipSpacesBack(text, dash))
      if (tokenBeforeDash) {
        left = tokenBeforeDash
        minusNum = dash
      }
      else if (freeDash(dash)) {
        minusNum = dash
      }
    }
    if (!left)
      left = tokenBefore(text, skipSpacesBack(text, minusNum >= 0 ? minusNum : numStart))
    let minusTok = -1
    if (left && minusNum < 0) {
      const d = dashBefore(left.start)
      if (d >= 0 && freeDash(d))
        minusTok = d
    }
    const right = tokenAfter(text, skipSpaces(text, numEnd))
    raws.push({ number: m[0], numStart, numEnd, left, right, minusNum, minusTok })
  }

  // Each token belongs to one price: a price takes its left token if free, else its right one.
  const claimed = new Set<number>()
  const found: Found[] = raws.map((r, i) => {
    // A real symbol beats a weak one (`Size L 19,99 €`), then the left one beats the right one.
    const free = (t: TokenMatch | null): t is TokenMatch => t !== null && !claimed.has(t.start)
    const right = free(r.right) && !belongsToNext(r, raws[i + 1]) ? r.right : null
    let token: TokenMatch | null = null
    if (free(r.left) && !r.left.weak)
      token = r.left
    else if (right && !right.weak)
      token = right
    else if (free(r.left))
      token = r.left
    else if (right)
      token = right
    if (token)
      claimed.add(token.start)
    const minus = token === r.left && r.minusTok >= 0 ? r.minusTok : r.minusNum
    const start = Math.min(r.numStart, token ? token.start : Infinity, minus >= 0 ? minus : Infinity)
    const end = Math.max(r.numEnd, token ? token.end : 0)
    const unit = readPer(text.slice(end, end + 24), languages)
    return {
      number: r.number,
      numStart: r.numStart,
      numEnd: r.numEnd,
      token,
      minus,
      start,
      end: unit ? end + unit.length : end,
      range: null,
      per: unit ? unit.per : null,
    }
  })

  // Ranges: `$10 - $20`, `10-20 €`, `€10 ~ €20`. The dash is not a minus sign.
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1]!
    const b = found[i]!
    const gapStart = a.end
    const gapEnd = b.minus >= 0 ? Math.min(b.numStart, b.token ? b.token.start : Infinity) : b.start
    const gap = text.slice(gapStart, gapEnd)
    const tight = /^[-~]$/.test(gap)
    const spaced = /^ *[-~] *$/.test(gap)
    const even = /^ +[-~] +$/.test(gap)
    // `10-20 €` and `10 - 20 €` need a currency on either side. An uneven gap, as in
    // `Item 2 -$5.00`, is a range only when the first price carries its own currency, and
    // a size letter (`Size L 2 -$5.00`) is not one.
    if (!(((tight || even) && (a.token || b.token)) || (spaced && a.token && !a.token.weak)))
      continue
    if (b.minus >= 0) {
      b.start = Math.min(b.numStart, b.token ? b.token.start : Infinity)
      b.minus = -1
    }
    a.range = 'from'
    b.range = 'to'
    if (a.token?.weak && b.token && !b.token.weak && a.token.start < a.numStart) {
      // `Size L 10-20 €`: the range's own symbol, not the letter before it.
      a.token = null
      a.start = a.minus >= 0 ? Math.min(a.minus, a.numStart) : a.numStart
    }
    if (!a.token && b.token)
      a.token = b.token
    else if (a.token && !b.token)
      b.token = a.token
  }
  return found
}
