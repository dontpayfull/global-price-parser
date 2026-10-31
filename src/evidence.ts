import { isCurrencyCode, isRegion } from './currency'
import type { Evidence } from './resolve'
import type { Options, PageSignals, Signal } from './types'

/** Region of a BCP 47 tag (`en-CA` -> `CA`), or null. Accepts `_` (`en_CA`). */
export function regionOfTag(tag: string): string | null {
  try {
    const region = new Intl.Locale(tag.replace(/_/g, '-')).region
    if (!region || !/^[A-Z]{2}$/.test(region) || !isRegion(region))
      return null
    return region === 'UK' ? 'GB' : region
  }
  catch {
    return null
  }
}

/** Likely region of a language without region (`sv` -> `SE`), via CLDR likely subtags. */
export function likelyRegion(tag: string): string | null {
  try {
    const region = new Intl.Locale(tag.replace(/_/g, '-')).maximize().region
    return region && isRegion(region) ? region : null
  }
  catch {
    return null
  }
}

/**
 * Hints from the caller come first, then the page's currency signals, then the
 * page's country signals, then a language hint without region as a last resort.
 */
export function buildEvidence(options: Options, page: PageSignals | null): Evidence {
  const entries: Signal[] = []
  const currency = options.currency?.toUpperCase()
  if (currency && isCurrencyCode(currency))
    entries.push({ source: 'hint.currency', currency })
  const country = options.country?.toUpperCase()
  if (country && isRegion(country))
    entries.push({ source: 'hint.country', country: country === 'UK' ? 'GB' : country })
  const langRegion = options.language ? regionOfTag(options.language) : null
  if (langRegion)
    entries.push({ source: 'hint.language', country: langRegion })
  if (page) {
    entries.push(...page.currency)
    entries.push(...page.country)
  }
  if (options.language && !langRegion) {
    const likely = likelyRegion(options.language)
    if (likely)
      entries.push({ source: 'hint.language', country: likely, likely: true })
  }
  return { entries, languages: languagesOf(options, page, entries) }
}

/** The declared language (hint or page) and the main language of the first known country. */
function languagesOf(options: Options, page: PageSignals | null, entries: Signal[]): string[] {
  const out = new Set<string>()
  const tag = options.language ?? page?.language
  if (tag) {
    try {
      out.add(new Intl.Locale(tag.replace(/_/g, '-')).language)
    }
    catch {}
  }
  const country = entries.find(e => e.country)?.country
  if (country) {
    try {
      out.add(new Intl.Locale(`und-${country}`).maximize().language)
    }
    catch {}
  }
  return [...out]
}
