import type { Per } from './units'

export type { Per }

/** Where the currency of a price came from. */
export type Decision =
  | 'symbol' // the price text itself (`€`, `CA$`, `USD`, `zł`)
  | 'hint.currency'
  | 'hint.country'
  | 'hint.language'
  | `page.${string}` // e.g. `page.platform:shopify`, `page.jsonld`, `page.meta`, `page.lang`
  | `url.${string}` // e.g. `url.query`, `url.hreflang`, `url.path`, `url.tld`
  | 'default' // fallback table, e.g. `$` = USD
  | 'none'

export interface Price {
  /** Exact amount as a decimal string, e.g. `"1299.00"`, `"-249.80"`, `"1299"` for JPY. */
  amount: string
  /** The same amount as a JavaScript number. */
  value: number
  /** ISO 4217 code, or null when the text has no currency and nothing else tells it. */
  currency: string | null
  /** True when only one currency is possible given the symbol, the hints and the page. */
  currencySure: boolean
  /** Other currencies the symbol could mean, when not sure (e.g. `$` -> CAD, AUD...). */
  otherCurrencies: string[]
  /** What decided the currency. */
  decidedBy: Decision
  /** Signals that pointed to a currency the symbol cannot mean (ignored). */
  conflicts: string[]
  /** The currency symbol or code as written, e.g. `"€"`, `"lei"`, `"US$"`. */
  symbol: string | null
  negative: boolean
  /** Set when the number itself has a second legal reading. */
  ambiguous: { reason: 'separator' | 'irregular-grouping', alternative: string } | null
  /** HTML only: the price is visually struck through (`<del>`, `<s>`, line-through). */
  struck: boolean
  /** Unit glued to the price after a slash, in any language: `€/kg`, `€/100 g`, `lei/lună`, `$/mo`. */
  per: Per | null
  /** Part of a range like `$10 - $20`. */
  range: 'from' | 'to' | null
  /** The matched text, and its position in the (extracted) text. */
  raw: string
  index: number
}

export interface Options {
  /** ISO 4217 code the caller knows the price is in. */
  currency?: string
  /** ISO 3166-1 alpha-2 country of the shop. */
  country?: string
  /** BCP 47 language tag, e.g. `de-CH`. A tag without region only helps as a last resort. */
  language?: string
  /** URL of the page the price comes from. */
  url?: string
  /** Page to read currency signals from (HTML string or Document). Defaults to the input's own page. */
  page?: string | Document
  /** Treat a string input as HTML. Default: auto (true when it contains a tag). */
  html?: boolean
}

export interface Signal {
  source: string
  currency?: string
  country?: string
  /** Guessed from a language without region (`es` -> Spain): it can pick a currency, never make it sure. */
  likely?: boolean
}

export interface PageSignals {
  /** Currency signals in priority order. */
  currency: Signal[]
  /** Country signals in priority order. */
  country: Signal[]
  /** Language of the page (`<html lang>`, or the language of its own hreflang), e.g. `ro`. */
  language: string | null
}
