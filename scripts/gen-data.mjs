// Generates src/data/*.ts from the runtime's Intl (CLDR) data and the vendored
// CLDR supplemental currencyData.json. Run with: node scripts/gen-data.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cldr = JSON.parse(readFileSync(join(root, 'vendor/cldr/currencyData.json'), 'utf8'))
const cldrVersion = cldr.supplemental.version._cldrVersion

const currencies = Intl.supportedValuesOf('currency')

// Minor units as displayed by CLDR. Only the non-2 ones are stored.
const digits = {}
for (const c of currencies) {
  const d = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits
  if (d !== 2)
    digits[c] = d
}

// Region -> currencies that are legal tender today (no _to, _tender not "false").
const regionCurrencies = {}
for (const [region, list] of Object.entries(cldr.supplemental.currencyData.region)) {
  if (!/^[A-Z]{2}$/.test(region))
    continue
  const current = []
  for (const entry of list) {
    const [code, info] = Object.entries(entry)[0]
    if (info._to || info._tender === 'false')
      continue
    if (currencies.includes(code))
      current.push(code)
  }
  if (current.length)
    regionCurrencies[region] = current
}

// One locale per region (the region's likely language), plus English.
const regionLocales = Object.keys(regionCurrencies).map((region) => {
  const max = new Intl.Locale(`und-${region}`).maximize()
  return `${max.language}-${region}`
})
const locales = [...new Set(['en', 'en-US', ...regionLocales])]

const BIDI = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g
function symbolOf(locale, currency, display) {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display }).formatToParts(1)
  const part = parts.find(p => p.type === 'currency')
  return part ? part.value.replace(BIDI, '').replace(/[\u00A0\u202F\u2009\u2007]/g, ' ').trim() : null
}

// token -> Map(currency -> number of locales using it)
const tokenUse = new Map()
function addToken(token, currency, weight = 1) {
  if (!token || /^[A-Z]{3}$/.test(token))
    return // ISO codes are handled separately
  if (!tokenUse.has(token))
    tokenUse.set(token, new Map())
  const m = tokenUse.get(token)
  m.set(currency, (m.get(currency) || 0) + weight)
}
// A region's locale only counts for the currencies used in that region: CLDR also lists how
// each locale writes foreign currencies, with local abbreviations (`p.` for BYN in es-MX) and
// leftovers (`Vote $` in wo-SN) that would turn ordinary words into currencies. English
// without a region keeps the international forms (`CA$`, `A$`, `₹`).
const regionOfLocale = new Map(regionLocales.map(l => [l, l.slice(l.lastIndexOf('-') + 1)]))
for (const c of currencies) {
  for (const l of locales) {
    const region = regionOfLocale.get(l)
    if (region && !regionCurrencies[region].includes(c))
      continue
    addToken(symbolOf(l, c, 'symbol'), c)
    addToken(symbolOf(l, c, 'narrowSymbol'), c)
  }
}

// Words and spellings shops use that CLDR does not list as symbols.
const extraTokens = {
  'lei': ['RON', 'MDL'],
  'leu': ['RON', 'MDL'],
  'Lei': ['RON', 'MDL'],
  'kr': ['SEK', 'NOK', 'DKK', 'ISK'],
  'kr.': ['DKK', 'ISK', 'SEK', 'NOK'],
  'Kr': ['SEK', 'NOK', 'DKK', 'ISK'],
  ':-': ['SEK'],
  'zł': ['PLN'],
  'zl': ['PLN'],
  'Kč': ['CZK'],
  'Ft': ['HUF'],
  'Ft.': ['HUF'],
  'kn': ['HRK'],
  'лв': ['BGN'],
  'лв.': ['BGN'],
  'руб': ['RUB', 'BYN'],
  'руб.': ['RUB', 'BYN'],
  'р.': ['RUB', 'BYN'],
  'грн': ['UAH'],
  'грн.': ['UAH'],
  'TL': ['TRY'],
  'Rs': ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  'Rs.': ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  'RM': ['MYR'],
  'Rp': ['IDR'],
  'Rp.': ['IDR'],
  'S$': ['SGD'],
  'HK$': ['HKD'],
  'NT$': ['TWD'],
  'AU$': ['AUD'],
  'A$': ['AUD'],
  'C$': ['CAD', 'NIO'],
  'CA$': ['CAD'],
  'NZ$': ['NZD'],
  'US$': ['USD'],
  'U$S': ['USD'],
  'MX$': ['MXN'],
  'R$': ['BRL'],
  'Fr.': ['CHF'],
  'SFr.': ['CHF'],
  '€': ['EUR'],
  'euro': ['EUR'],
  'euros': ['EUR'],
  'Euro': ['EUR'],
  'EUR€': ['EUR'],
  '$': ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD', 'TWD', 'ARS', 'CLP', 'COP'],
  'ريال': ['SAR', 'QAR', 'OMR', 'YER', 'IRR'],
  'ر.س': ['SAR'],
  'ریال': ['IRR', 'SAR'],
  '﷼': ['SAR', 'IRR', 'OMR', 'QAR', 'YER'],
  'Dhs': ['AED', 'MAD'],
  'Dhs.': ['AED', 'MAD'],
  'DH': ['MAD', 'AED'],
  'Dh': ['MAD', 'AED'],
  '₨': ['PKR', 'INR', 'LKR', 'NPR', 'MUR', 'SCR'],
  '円': ['JPY'],
  '元': ['CNY'],
  '￥': ['JPY', 'CNY'],
  'Tk': ['BDT'],
  'EG£': ['EGP'],
  'J$': ['JMD'],
  'TT$': ['TTD'],
  'BZ$': ['BZD'],
  'B$': ['BSD', 'BND'],
  'RD$': ['DOP'],
  'din.': ['RSD'],
  'дин.': ['RSD'],
  'КМ': ['BAM'],
  '₵': ['GHS'],
  'GH₵': ['GHS'],
  'S/': ['PEN'],
  'S/.': ['PEN'],
}
for (const [token, list] of Object.entries(extraTokens))
  list.forEach((c, i) => addToken(token, c, 100000 - i * 1000))

// Defaults for the ambiguous tokens, chosen by hand (most common on the web).
const defaults = {
  '$': 'USD', 'kr': 'SEK', 'kr.': 'DKK', 'Kr': 'SEK', '¥': 'JPY', '￥': 'JPY', '£': 'GBP',
  'lei': 'RON', 'Lei': 'RON', 'leu': 'RON', 'Rs': 'INR', 'Rs.': 'INR', '₨': 'PKR', 'R': 'ZAR',
  'руб': 'RUB', 'руб.': 'RUB', 'р.': 'RUB', 'C$': 'CAD', 'Fr.': 'CHF', 'Dhs': 'AED', 'Dhs.': 'AED', 'ريال': 'SAR', '﷼': 'SAR', 'ریال': 'IRR', 'DH': 'MAD', 'Dh': 'MAD', 'L': 'HNL',
}

const tokens = {}
for (const [token, use] of [...tokenUse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ranked = [...use.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0])
  const def = defaults[token] && ranked.includes(defaults[token]) ? defaults[token] : ranked[0]
  tokens[token] = [def, ...ranked.filter(c => c !== def)]
}

// Short CLDR abbreviations that are also ordinary words or units (`KM`, `Db`, `Le`, `L`, `R`):
// they count as a currency only when a hint or the page confirms it. The hand-picked shop
// spellings above (`kr`, `Ft`, `zł`, `TL`) are trusted.
const weakTokens = Object.keys(tokens)
  .filter(t => /^\p{L}{1,2}$/u.test(t.replace(/\.$/, '')) && !(t in extraTokens))
  .sort()

// Units a price can be "per", named in every language by CLDR (Intl unit formatting).
const UNITS = ['month', 'year', 'week', 'day', 'hour', 'kilogram', 'gram', 'liter', 'milliliter', 'meter', 'pound', 'ounce']
// International symbols: they win when a form means two units (`m` = meter, not month).
const SYMBOLS = { kg: 'kilogram', g: 'gram', l: 'liter', ml: 'milliliter', m: 'meter', lb: 'pound', oz: 'ounce', h: 'hour' }
const EXTRA_FORMS = {
  en: { mo: 'month', mos: 'month', yr: 'year', lbs: 'pound', ea: null },
  de: { qm: 'square-meter' },
  ro: { luna: 'month', luni: 'month', saptamana: 'week' },
}
const GLOBAL_EXTRA = { 'm²': 'square-meter', 'm2': 'square-meter', 'sqm': 'square-meter', 'kg.': 'kilogram' }
const languages = [...new Set(['en', ...regionLocales.map(l => l.split('-')[0])])].sort()
const byLanguage = {}
for (const lang of languages) {
  const seen = {}
  for (const unit of UNITS) {
    for (const unitDisplay of ['short', 'narrow', 'long']) {
      for (const n of [1, 2, 5, 0.5]) {
        const form = new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay }).formatToParts(n)
          .filter(p => p.type === 'unit').map(p => p.value).join('').replace(BIDI, '').trim().toLowerCase()
        if (form && !/\d/.test(form))
          (seen[form] ??= new Set()).add(unit)
      }
    }
  }
  const resolved = {}
  for (const [form, set] of Object.entries(seen)) {
    if (set.size === 1)
      resolved[form] = [...set][0]
    else if (SYMBOLS[form] && set.has(SYMBOLS[form]))
      resolved[form] = SYMBOLS[form]
  }
  for (const [form, unit] of Object.entries(EXTRA_FORMS[lang] ?? {})) {
    if (unit)
      resolved[form] = unit
  }
  byLanguage[lang] = resolved
}
// A form every language agrees on goes to the global table; the others need the page language.
const formUnits = {}
for (const resolved of Object.values(byLanguage)) {
  for (const [form, unit] of Object.entries(resolved))
    (formUnits[form] ??= new Set()).add(unit)
}
const globalUnits = { ...GLOBAL_EXTRA }
const conflicted = new Set()
for (const [form, set] of Object.entries(formUnits)) {
  if (set.size === 1)
    globalUnits[form] = [...set][0]
  else if (SYMBOLS[form])
    globalUnits[form] = SYMBOLS[form]
  else
    conflicted.add(form)
}
const languageUnits = {}
for (const [lang, resolved] of Object.entries(byLanguage)) {
  const own = Object.fromEntries(Object.entries(resolved).filter(([form]) => conflicted.has(form)))
  if (Object.keys(own).length)
    languageUnits[lang] = own
}

// Unicode decimal digit blocks: the code point of each "0".
// Blocks can follow each other with no gap (mathematical bold, double-struck...): every tenth
// digit of a run starts a new block.
const zeros = []
let runStart = -1
for (let cp = 0x80; cp <= 0x1FFFF; cp++) {
  if (!/^\p{Nd}$/u.test(String.fromCodePoint(cp))) {
    runStart = -1
    continue
  }
  if (runStart < 0)
    runStart = cp
  if ((cp - runStart) % 10 === 0)
    zeros.push(cp)
}

const header = `// GENERATED by scripts/gen-data.mjs from Unicode CLDR ${cldrVersion} (Intl and
// supplemental currencyData.json). Do not edit by hand.
// Unicode data: Copyright © Unicode, Inc. Unicode License v3, see vendor/cldr/LICENSE.
`
const out = join(root, 'src/data')
writeFileSync(join(out, 'currencies.ts'), `${header}
/** Every ISO 4217 code the runtime's CLDR knows. */
export const CURRENCY_CODES: ReadonlySet<string> = new Set(${JSON.stringify(currencies)})

/** Minor units (decimals) for the currencies that do not use 2. */
export const CURRENCY_DIGITS: Readonly<Record<string, number>> = ${JSON.stringify(digits, null, 2)}

/** Region (ISO 3166-1) -> currencies that are legal tender today, main one first. */
export const REGION_CURRENCIES: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(regionCurrencies)}
`)
writeFileSync(join(out, 'tokens.ts'), `${header}
/** Currency symbol or word -> possible ISO codes, the default first. */
export const CURRENCY_TOKENS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(tokens, null, 2)}

/** Tokens that need a hint or a page signal before they count as a currency. */
export const WEAK_TOKENS: ReadonlySet<string> = new Set(${JSON.stringify(weakTokens)})
`)
writeFileSync(join(out, 'digits.ts'), `${header}
/** Code point of the digit zero in every Unicode decimal digit block above ASCII. */
export const DIGIT_ZEROS: readonly number[] = ${JSON.stringify(zeros)}
`)
writeFileSync(join(out, 'units.ts'), `${header}
/** Lower-cased unit form (any language) -> unit, when all languages agree or it is an SI symbol. */
export const UNIT_FORMS: Readonly<Record<string, string>> = ${JSON.stringify(globalUnits)}

/** Forms that mean different units in different languages, per language. */
export const LANGUAGE_UNIT_FORMS: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(languageUnits)}
`)
// The same data as JSON, for the ports in other languages (python/, php/).
const json = join(root, 'data')
mkdirSync(json, { recursive: true })
const meta = { cldr: cldrVersion, license: 'Unicode License v3, see vendor/cldr/LICENSE' }
writeFileSync(join(json, 'currencies.json'), `${JSON.stringify({ meta, codes: currencies, digits, regions: regionCurrencies }, null, 1)}\n`)
writeFileSync(join(json, 'tokens.json'), `${JSON.stringify({ meta, tokens, weak: weakTokens }, null, 1)}\n`)
writeFileSync(join(json, 'digits.json'), `${JSON.stringify({ meta, zeros }, null, 1)}\n`)
writeFileSync(join(json, 'units.json'), `${JSON.stringify({ meta, global: globalUnits, language: languageUnits }, null, 1)}\n`)
// Locale data the TypeScript code reads from Intl at runtime; the ports read it from here.
const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })
const letters = 'abcdefghijklmnopqrstuvwxyz'
const codes = []
for (const a of letters) {
  for (const b of letters) {
    codes.push(a + b)
    for (const c of letters) codes.push(a + b + c)
  }
}
const knownLanguages = codes.filter(c => names.of(c) !== undefined)
const likelyRegion = {}
for (const lang of knownLanguages) {
  try {
    const region = new Intl.Locale(lang).maximize().region
    if (region && regionCurrencies[region])
      likelyRegion[lang] = region
  }
  catch {}
}
const regionLanguage = {}
for (const region of Object.keys(regionCurrencies)) {
  try {
    regionLanguage[region] = new Intl.Locale(`und-${region}`).maximize().language
  }
  catch {}
}
// Language + script, where the script changes the likely region (zh-Hant -> TW, sr-Latn -> RS).
const SCRIPTS = ['Adlm', 'Arab', 'Armn', 'Beng', 'Cyrl', 'Deva', 'Ethi', 'Geor', 'Grek', 'Gujr', 'Guru', 'Hans', 'Hant', 'Hebr', 'Jpan', 'Khmr', 'Knda', 'Kore', 'Laoo', 'Latn', 'Mlym', 'Mong', 'Mymr', 'Olck', 'Orya', 'Sinh', 'Taml', 'Telu', 'Thaa', 'Thai', 'Tibt', 'Tfng', 'Vaii']
for (const lang of knownLanguages) {
  for (const script of SCRIPTS) {
    try {
      const region = new Intl.Locale(`${lang}-${script}`).maximize().region
      if (region && regionCurrencies[region] && region !== likelyRegion[lang])
        likelyRegion[`${lang}-${script}`] = region
    }
    catch {}
  }
}
// UN M.49 numeric region codes that Intl maps to one country (840 -> US).
const numericRegions = {}
for (let n = 0; n < 1000; n++) {
  const code = String(n).padStart(3, '0')
  try {
    const region = new Intl.Locale(`und-${code}`).region
    if (region && /^[A-Z]{2}$/.test(region))
      numericRegions[code] = region
  }
  catch {}
}
// Deprecated codes Intl.Locale replaces (in -> id, sh -> sr-Latn, cnr -> sr-ME, BU -> MM).
// A language alias is a tag: its script and region apply only when the tag has none of its own.
const languageAliases = {}
for (const code of codes) {
  try {
    const canonical = new Intl.Locale(code).baseName
    if (canonical !== code)
      languageAliases[code] = canonical
  }
  catch {}
}
const regionAliases = {}
for (const a of letters) {
  for (const b of letters) {
    const code = (a + b).toUpperCase()
    try {
      const canonical = new Intl.Locale(`und-${code}`).region
      if (canonical && canonical !== code)
        regionAliases[code] = canonical
    }
    catch {}
  }
}
writeFileSync(join(json, 'locales.json'), `${JSON.stringify({ meta, languages: knownLanguages, likelyRegion, regionLanguage, numericRegions, languageAliases, regionAliases }, null, 1)}\n`)
console.log(`units: ${languages.length} languages, ${Object.keys(globalUnits).length} global forms, ${conflicted.size} forms that need the language`)
console.log(`currencies ${currencies.length}, non-2 digits ${Object.keys(digits).length}, regions ${Object.keys(regionCurrencies).length}, tokens ${Object.keys(tokens).length}, digit blocks ${zeros.length}`)
