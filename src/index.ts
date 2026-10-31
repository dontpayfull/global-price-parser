import { buildEvidence } from './evidence'
import { extractDom, extractHtml } from './html'
import type { Extracted } from './html'
import { DECIMAL_MARK } from './normalize'
import { readPrices } from './parse'
import type { Candidate } from './parse'
import { readPageSignals } from './signals'
import type { Options, PageSignals, Price } from './types'

export type { Decision, Options, PageSignals, Per, Price, Signal } from './types'
export { readPageSignals } from './signals'

function isNode(x: unknown): x is Node {
  return typeof x === 'object' && x !== null && typeof (x as Node).nodeType === 'number'
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][^<>]*>/i.test(s)
}

interface Prepared {
  extracted: Extracted
  signals: PageSignals | null
  /** Reads the input again with hidden and screen-reader-only text, or null for plain text. */
  withHidden: (() => Extracted) | null
}

function prepare(input: string | Node, options: Options): Prepared {
  if (isNode(input)) {
    const doc = input.nodeType === 9 ? input as Document : input.ownerDocument
    const page = options.page ?? doc ?? null
    const url = options.url ?? (doc?.URL && /^https?:/.test(doc.URL) ? doc.URL : undefined)
    return { extracted: extractDom(input), signals: page ? readPageSignals(page, { url }) : null, withHidden: () => extractDom(input, true) }
  }
  const html = options.html ?? looksLikeHtml(input)
  // The decimal mark is ours: a private-use character in the caller's text means nothing.
  const extracted = html ? extractHtml(input) : { text: input.replaceAll(DECIMAL_MARK, ''), struck: [] }
  const page = options.page ?? (html ? input : null)
  const signals = page !== null ? readPageSignals(page, { url: options.url }) : (options.url ? readPageSignals('', { url: options.url }) : null)
  return { extracted, signals, withHidden: html ? () => extractHtml(input, true) : null }
}

function candidates(input: string | Node, options: Options): Candidate[] {
  const { extracted, signals, withHidden } = prepare(input, options)
  const evidence = buildEvidence(options, signals)
  const found = readPrices(extracted.text, evidence, extracted.struck.length ? extracted.struck : undefined)
  if (found.some(c => c.hasCurrency) || !withHidden)
    return found
  // No visible price: it may be a screen-reader-only one (`a-offscreen`). Read everything.
  const all = withHidden()
  const hidden = readPrices(all.text, evidence, all.struck)
  return hidden.some(c => c.hasCurrency) ? hidden : found
}

/**
 * Every price in a text or an HTML fragment. Only numbers that carry a currency
 * (symbol, code or word) count as prices here.
 */
export function parsePrices(input: string | Node, options: Options = {}): Price[] {
  return candidates(input, options).filter(c => c.hasCurrency).map(c => c.price)
}

/**
 * The price in a text or an HTML element: the first one with a currency that is not
 * struck through, else the first one with a currency, else a lone number (its currency
 * then comes from the hints or the page), else null.
 */
export function parsePrice(input: string | Node, options: Options = {}): Price | null {
  const all = candidates(input, options)
  const priced = all.filter(c => c.hasCurrency)
  const pick = priced.find(c => !c.price.struck) ?? priced[0] ?? (all.length === 1 ? all[0] : undefined)
  return pick ? pick.price : null
}
