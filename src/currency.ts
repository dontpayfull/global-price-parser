import { CURRENCY_CODES, CURRENCY_DIGITS, REGION_CURRENCIES } from './data/currencies'
import { CURRENCY_TOKENS, WEAK_TOKENS } from './data/tokens'

export interface TokenMatch {
  text: string
  start: number
  end: number
  /** Possible ISO codes, the default first. */
  candidates: readonly string[]
  /** Written as an ISO code (`USD`). */
  iso: boolean
  /** A short abbreviation that is also a word or unit (`R`, `L`, `KM`, `Le`): counts only
   * when a hint or the page confirms it. */
  weak: boolean
}

/** Own keys only: the generated tables are plain objects (`toString` is not a currency). */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

const LETTER = /\p{L}/u
const ALPHA = /^\p{L}+\.?$/u
const MAX_TOKEN = Math.max(...Object.keys(CURRENCY_TOKENS).map(t => t.length), 3)

/** `ر.س` for `ر.س.`, `лв` for `лв.`: shops often drop the final dot. */
const NO_DOT = new Map<string, string>()
for (const token of Object.keys(CURRENCY_TOKENS)) {
  if (token.length > 2 && token.endsWith('.') && !Object.hasOwn(CURRENCY_TOKENS, token.slice(0, -1)))
    NO_DOT.set(token.slice(0, -1), token)
}

/** Lower-cased word tokens (`lei` for `LEI`, `euro`) for case-insensitive matching. Two-letter
 * tokens match only as written: `KM` is a currency, `km` a distance. */
const WORDS = new Map<string, string>()
for (const token of Object.keys(CURRENCY_TOKENS)) {
  if (ALPHA.test(token) && token.replace(/\.$/, '').length >= 3 && !WORDS.has(token.toLowerCase()))
    WORDS.set(token.toLowerCase(), token)
}

export function decimalsOf(code: string): number {
  return own(CURRENCY_DIGITS, code) ?? 2
}

export function isCurrencyCode(code: string): boolean {
  return CURRENCY_CODES.has(code)
}

/** Currencies in use in a country. Accepts `UK` for `GB`. */
export function currenciesOfRegion(region: string): readonly string[] {
  const r = region.toUpperCase()
  return own(REGION_CURRENCIES, r === 'UK' ? 'GB' : r) ?? []
}

export function isRegion(region: string): boolean {
  return currenciesOfRegion(region).length > 0
}

function lookup(candidate: string): { token: string, candidates: readonly string[], iso: boolean } | null {
  if (/^[A-Z]{3}$/.test(candidate) && CURRENCY_CODES.has(candidate))
    return { token: candidate, candidates: [candidate], iso: true }
  const key = Object.hasOwn(CURRENCY_TOKENS, candidate) ? candidate : NO_DOT.get(candidate)
  if (key)
    return { token: key, candidates: CURRENCY_TOKENS[key]!, iso: false }
  const word = ALPHA.test(candidate) ? WORDS.get(candidate.toLowerCase()) : undefined
  if (word)
    return { token: word, candidates: CURRENCY_TOKENS[word]!, iso: false }
  return null
}

function make(text: string, start: number, end: number, found: NonNullable<ReturnType<typeof lookup>>): TokenMatch {
  const raw = text.slice(start, end)
  const weak = !found.iso && (WEAK_TOKENS.has(found.token) || /^[A-Za-z]$/.test(raw))
  return { text: raw, start, end, candidates: found.candidates, iso: found.iso, weak }
}

/** The longest currency token that ends exactly at `end`. */
export function tokenBefore(text: string, end: number): TokenMatch | null {
  for (let len = Math.min(MAX_TOKEN, end); len >= 1; len--) {
    const start = end - len
    const candidate = text.slice(start, end)
    if (LETTER.test(candidate[0]!) && start > 0 && LETTER.test(text[start - 1]!))
      continue
    const found = lookup(candidate)
    if (found)
      return make(text, start, end, found)
  }
  return null
}

/** The longest currency token that starts exactly at `start`. */
export function tokenAfter(text: string, start: number): TokenMatch | null {
  for (let len = Math.min(MAX_TOKEN, text.length - start); len >= 1; len--) {
    const end = start + len
    const candidate = text.slice(start, end)
    if (LETTER.test(candidate[candidate.length - 1]!) && end < text.length && LETTER.test(text[end]!))
      continue
    const found = lookup(candidate)
    if (found)
      return make(text, start, end, found)
  }
  return null
}
