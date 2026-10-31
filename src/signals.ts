import { isCurrencyCode, isRegion } from './currency'
import { regionOfTag } from './evidence'
import { decodeEntities, parseAttributes } from './html'
import { tokenize } from './markup'
import type { PageSignals, Signal } from './types'

type Attrs = Record<string, string>

/** What we read from a page, the same whether it came as an HTML string or a Document. */
interface PageSource {
  html: Attrs | null
  body: Attrs | null
  metas: Attrs[]
  links: Attrs[]
  jsonLd: string[]
  scripts: string[]
  microdataCurrency: string[]
  url: string | null
}

/**
 * Reads the page in one pass. Comments, and everything inside `<template>` (nested ones
 * too), never count; a `<meta>` written inside a script string is script text, not a tag.
 */
function sourceFromHtml(page: string): PageSource {
  const src: PageSource = { html: null, body: null, metas: [], links: [], jsonLd: [], scripts: [], microdataCurrency: [], url: null }
  let inert = 0
  let scriptType = ''
  // A `priceCurrency` element without `content`: the text right after it is the value.
  let microdata = false
  for (const t of tokenize(page)) {
    if (t.type !== 'text' && t.name === 'template') {
      inert = t.type === 'open' ? inert + 1 : Math.max(0, inert - 1)
      continue
    }
    if (inert)
      continue
    if (t.type === 'text') {
      if (microdata)
        src.microdataCurrency.push(decodeEntities(t.text).trim())
      microdata = false
      continue
    }
    microdata = false
    if (t.type === 'raw') {
      if (t.name !== 'script')
        continue
      if (scriptType === 'application/ld+json')
        src.jsonLd.push(t.text)
      else if (!scriptType || scriptType.includes('javascript') || scriptType === 'module')
        src.scripts.push(t.text)
      continue
    }
    if (t.type !== 'open' || !/^(?:html|body|meta|link|script)$/.test(t.name) && !/itemprop/i.test(t.attrs))
      continue
    const attrs = parseAttributes(t.attrs)
    if (t.name === 'html')
      src.html ??= attrs
    else if (t.name === 'body')
      src.body ??= attrs
    else if (t.name === 'meta')
      src.metas.push(attrs)
    else if (t.name === 'link')
      src.links.push(attrs)
    else if (t.name === 'script')
      scriptType = (attrs.type ?? '').trim().toLowerCase()
    if ((attrs.itemprop ?? '').toLowerCase() === 'pricecurrency') {
      if (attrs.content !== undefined)
        src.microdataCurrency.push(attrs.content.trim())
      else
        microdata = true
    }
  }
  return src
}

function sourceFromDocument(doc: Document): PageSource {
  const attrsOf = (el: Element | null): Attrs | null => {
    if (!el)
      return null
    const a: Attrs = Object.create(null)
    for (const at of Array.from(el.attributes))
      a[at.name.toLowerCase()] = at.value
    return a
  }
  const all = (sel: string) => Array.from(doc.querySelectorAll(sel))
  const jsonLd: string[] = []
  const scripts: string[] = []
  for (const s of all('script')) {
    const type = (s.getAttribute('type') ?? '').toLowerCase()
    if (type === 'application/ld+json')
      jsonLd.push(s.textContent ?? '')
    else if (!type || type.includes('javascript') || type === 'module')
      scripts.push(s.textContent ?? '')
  }
  const url = doc.URL && /^https?:/.test(doc.URL) ? doc.URL : null
  return {
    html: attrsOf(doc.documentElement),
    body: attrsOf(doc.body),
    metas: all('meta').map(e => attrsOf(e)!),
    links: all('link').map(e => attrsOf(e)!),
    jsonLd,
    scripts,
    microdataCurrency: all('[itemprop="priceCurrency"]').map(e => (e.getAttribute('content') ?? e.textContent ?? '').trim()),
    url,
  }
}

/**
 * An inline-script signal: find `anchor`, then look for `value` in the next `window`
 * characters only. Every search is bounded, so a hostile script cannot make it slow.
 */
type Rule = [name: string, anchor: RegExp, value: RegExp, window: number]

// The currency the shopper SEES (never the store's base currency).
const PLATFORM: Rule[] = [
  ['shopify', /Shopify\.currency\s*=\s*\{/g, /^[^}]{0,500}?["']active["']\s*:\s*["']([A-Z]{3})["']/u, 600],
  ['bigcommerce', /BCData\s*=\s*\{/g, /["'](?:current|active)_currency_code["']\s*:\s*["']([A-Z]{3})["']/u, 4000],
  ['prestashop', /prestashop\s*=\s*\{/g, /["']currency["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{3})["']/u, 20000],
  ['vtex', /__RUNTIME__/g, /["']culture["']\s*:\s*\{[^}]{0,500}?["']currency["']\s*:\s*["']([A-Z]{3})["']/u, 20000],
  ['magento', /checkoutConfig/g, /["']currencyCode["']\s*:\s*["']([A-Z]{3})["']/u, 20000],
  ['woocommerce', /woocs_current_currency\s*=\s*\{/g, /^[^}]{0,500}?["']name["']\s*:\s*["']([A-Z]{3})["']/u, 600],
  ['woocommerce', /(?:woo_multi_currency_params|wcml_mc_settings)\s*=\s*\{/g, /^[^}]{0,500}?["']current_currency["']\s*:\s*["']([A-Z]{3})["']/u, 600],
]
const TRACKING: Rule[] = [
  ['datalayer', /dataLayer\.push\s*\(\s*\{/g, /["']?ecommerce["']?\s*:\s*\{[^}]{0,500}?["']?currency(?:Code)?["']?\s*:\s*["']([A-Z]{3})["']/u, 2600],
  ['gtag', /gtag\s*\(\s*["'](?:event|set|config)["']/g, /^[^)]{0,2000}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']/u, 2100],
  ['fbq', /fbq\s*\(\s*["']track["']\s*,\s*["'](?:ViewContent|AddToCart|InitiateCheckout|Purchase)["']\s*,\s*\{/g, /^[^}]{0,500}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']/u, 600],
  ['klaviyo', /\$currency_code/g, /^["']?\s*:\s*["']([A-Z]{3})["']/u, 40],
]
const PLATFORM_COUNTRY: Rule[] = [
  ['shopify', /Shopify\.country\s*=\s*/g, /^["']([A-Z]{2})["']/u, 8],
  ['prestashop', /prestashop\s*=\s*\{/g, /["']country["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{2})["']/u, 20000],
]

/** `count` characters (code points, as in the ports) from `from`. */
function codePoints(s: string, from: number, count: number): string {
  let end = from
  for (let k = 0; k < count && end < s.length; k++)
    end += s.codePointAt(end)! > 0xFFFF ? 2 : 1
  return s.slice(from, end)
}

/** The first value a rule finds, trying at most 20 anchors. */
function findRule([, anchor, value, window]: Rule, scripts: string): string | undefined {
  let tries = 0
  for (const m of scripts.matchAll(anchor)) {
    const from = m.index! + m[0].length
    const hit = value.exec(codePoints(scripts, from, window))
    if (hit)
      return hit[1]
    if (++tries >= 20)
      break
  }
  return undefined
}

// ccTLDs that Google treats as generic, plus common vanity ones: they say nothing about the country.
const GENERIC_TLDS = new Set(['ac', 'ad', 'ag', 'ai', 'am', 'as', 'bz', 'cc', 'cd', 'ck', 'co', 'cx', 'dj', 'fm', 'gg', 'gl', 'gs', 'im', 'io', 'ki', 'la', 'ly', 'me', 'ms', 'nf', 'nr', 'nu', 'pw', 'sc', 'sh', 'sr', 'st', 'su', 'tk', 'to', 'tv', 'vc', 'ws'])

function isLanguage(code: string): boolean {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code.toLowerCase()) !== undefined
  }
  catch {
    return false
  }
}

function collectPriceCurrency(node: unknown, out: string[], depth = 0): void {
  if (depth > 20 || node === null || typeof node !== 'object')
    return
  if (Array.isArray(node)) {
    node.forEach(n => collectPriceCurrency(n, out, depth + 1))
    return
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.toLowerCase() === 'pricecurrency' && typeof value === 'string')
      out.push(value.trim().toUpperCase())
    else
      collectPriceCurrency(value, out, depth + 1)
  }
}

/** Host and path of a page, plus its query when `withQuery` (`?locale=ca` can be another page). */
function urlKey(href: string, base?: string | null, withQuery = true): string | null {
  try {
    const u = new URL(href, base ?? undefined)
    if (!/^https?:$/.test(u.protocol))
      return null
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}${withQuery ? u.search : ''}`
  }
  catch {
    return null
  }
}

// Languages shops use in URL paths. They decide `/fr/ca/` (French, Canada) against Catalan in France.
const SITE_LANGUAGES = new Set(['ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'])
// Two-letter English words that start ordinary paths (`/do/it`, `/in/to`).
const PATH_WORDS = new Set(['am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'id', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we'])

/** `/ca/fr/` or `/fr/ca/`: the region of a language + region pair, or null when unclear. */
function pathRegion(a: string, b: string): string | null {
  if (PATH_WORDS.has(a) && PATH_WORDS.has(b))
    return null
  const langFirst = isLanguage(a) && isRegion(b)
  const regionFirst = isRegion(a) && isLanguage(b)
  if (langFirst && regionFirst) {
    // Both readings are possible: the one whose language shops use wins, else language first.
    const aSite = SITE_LANGUAGES.has(a)
    const bSite = SITE_LANGUAGES.has(b)
    return (bSite && !aSite ? a : b).toUpperCase()
  }
  if (langFirst)
    return b.toUpperCase()
  if (regionFirst)
    return a.toUpperCase()
  return null
}

/** Country signals from a URL: query, path (`/en-ca/`, `/ca/en/`) and domain. */
export function urlSignals(url: string): { currency: Signal[], country: Signal[] } {
  const currency: Signal[] = []
  const country: Signal[] = []
  let u: URL
  try {
    u = new URL(url)
  }
  catch {
    return { currency, country }
  }
  if (!/^https?:$/.test(u.protocol))
    return { currency, country }
  const cur = (u.searchParams.get('currency') ?? '').toUpperCase()
  if (isCurrencyCode(cur))
    currency.push({ source: 'url.query', currency: cur })
  const ctry = (u.searchParams.get('country') ?? '').toUpperCase()
  if (/^[A-Z]{2}$/.test(ctry) && isRegion(ctry))
    country.push({ source: 'url.query', country: ctry })

  const segs = u.pathname.split('/').filter(Boolean).slice(0, 2)
  const pair = /^([a-z]{2})[-_]([a-z]{2})$/i.exec(segs[0] ?? '')
  if (pair && isLanguage(pair[1]!) && isRegion(pair[2]!)) {
    const region = pair[2]!.toUpperCase()
    country.push({ source: 'url.path', country: region === 'UK' ? 'GB' : region })
  }
  else if (segs.length === 2 && /^[a-z]{2}$/i.test(segs[0]!) && /^[a-z]{2}$/i.test(segs[1]!)) {
    const region = pathRegion(segs[0]!.toLowerCase(), segs[1]!.toLowerCase())
    if (region)
      country.push({ source: 'url.path', country: region === 'UK' ? 'GB' : region })
  }

  const labels = u.hostname.toLowerCase().split('.')
  const tld = labels[labels.length - 1] ?? ''
  if (/^[a-z]{2}$/.test(tld) && !GENERIC_TLDS.has(tld) && isRegion(tld))
    country.push({ source: 'url.tld', country: tld === 'uk' ? 'GB' : tld.toUpperCase() })
  return { currency, country }
}

/** Reads every currency and country signal a page carries, in priority order. */
export function readPageSignals(page: string | Document, options: { url?: string } = {}): PageSignals {
  const src = typeof page === 'string' ? sourceFromHtml(page) : sourceFromDocument(page)
  const currency: Signal[] = []
  const country: Signal[] = []
  const addCurrency = (source: string, code: string | undefined) => {
    const c = (code ?? '').trim().toUpperCase()
    if (isCurrencyCode(c) && !currency.some(s => s.source === source && s.currency === c))
      currency.push({ source, currency: c })
  }
  const scripts = src.scripts.join('\n;\n')

  for (const rule of PLATFORM)
    addCurrency(`page.platform:${rule[0]}`, findRule(rule, scripts))
  const paypal = src.metas.find(m => m.id === 'in-context-paypal-metadata')
  addCurrency('page.platform:shopify', paypal?.['data-currency'])
  addCurrency('page.platform:shopware', src.html?.['data-currency-iso'] ?? src.body?.['data-currency-iso'])
  for (const rule of TRACKING)
    addCurrency(`page.tracking:${rule[0]}`, findRule(rule, scripts))

  for (const block of src.jsonLd) {
    const found: string[] = []
    try {
      collectPriceCurrency(JSON.parse(block.trim()), found)
    }
    catch {
      for (const m of block.matchAll(/"priceCurrency"\s*:\s*"([A-Za-z]{3})"/gi))
        found.push(m[1]!.toUpperCase())
    }
    found.forEach(c => addCurrency('page.jsonld', c))
  }
  src.microdataCurrency.forEach(c => addCurrency('page.microdata', c))
  for (const m of src.metas) {
    const prop = (m.property ?? m.name ?? '').toLowerCase()
    if (prop === 'product:price:currency' || prop === 'og:price:currency')
      addCurrency('page.meta', m.content)
  }

  const url = options.url ?? src.url
  const canonical = src.links.find(l => (l.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href ?? null
  const pageUrl = url ?? (canonical ? urlKey(canonical) && canonical : null)
  const fromUrl = pageUrl ? urlSignals(pageUrl) : { currency: [], country: [] }
  currency.push(...fromUrl.currency)

  for (const rule of PLATFORM_COUNTRY) {
    const c = findRule(rule, scripts)
    if (c && isRegion(c))
      country.push({ source: `page.platform:${rule[0]}`, country: c })
  }
  country.push(...fromUrl.country.filter(s => s.source === 'url.query'))

  // hreflang of THIS page: the alternate whose href is the page URL (or its canonical). The
  // query counts; without it, an alternate is used only if all such alternates agree.
  // The page URL is tried before the canonical, which often drops the query.
  const alternates = src.links.filter(l => (l.rel ?? '').toLowerCase().split(/\s+/).includes('alternate') && l.hreflang && l.hreflang !== 'x-default')
  let matches: Attrs[] = []
  search: for (const withQuery of [true, false]) {
    for (const key of [pageUrl && urlKey(pageUrl, null, withQuery), canonical && urlKey(canonical, pageUrl, withQuery)]) {
      const found = key ? alternates.filter(l => urlKey(l.href ?? '', pageUrl, withQuery) === key) : []
      if (found.length) {
        // Alternates for other countries at the same address: none of them is sure.
        if (new Set(found.map(l => regionOfTag(l.hreflang!))).size === 1)
          matches = found
        break search
      }
    }
  }
  const hreflangLanguage = matches[0]?.hreflang ?? null
  const hreflangRegion = matches.map(l => regionOfTag(l.hreflang!)).find(Boolean)
  if (hreflangRegion)
    country.push({ source: 'url.hreflang', country: hreflangRegion })

  const lang = src.html?.lang ?? src.html?.['xml:lang']
  const langRegion = lang ? regionOfTag(lang) : null
  if (langRegion)
    country.push({ source: 'page.lang', country: langRegion })
  country.push(...fromUrl.country.filter(s => s.source !== 'url.query'))
  return { currency, country, language: lang || hreflangLanguage || null }
}
