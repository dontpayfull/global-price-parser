import { own } from './currency'
import { LANGUAGE_UNIT_FORMS, UNIT_FORMS } from './data/units'

export interface Per {
  /** CLDR unit id: `month`, `year`, `week`, `day`, `hour`, `kilogram`, `gram`, `liter`,
   * `milliliter`, `meter`, `square-meter`, `pound`, `ounce`. */
  unit: string
  /** How many units the price is for: 1 in `€/kg`, 100 in `€/100 g`. */
  quantity: number
}

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

/** Forms without diacritics (`luna` for `lună`), kept only when they still mean one unit. */
const PLAIN = new Map<string, string | null>()
for (const [form, unit] of Object.entries(UNIT_FORMS)) {
  const plain = strip(form)
  if (plain === form)
    continue
  const known = PLAIN.get(plain)
  PLAIN.set(plain, known === undefined || known === unit ? unit : null)
}

/**
 * A form every language agrees on is read directly. A form whose meaning depends on the
 * language (`j` = day in French, year in German) is read only if the page's languages
 * agree on it; if they disagree, it is not read.
 */
function lookup(form: string, languages: readonly string[]): string | null {
  const meanings = new Set(languages.map((l) => {
    const forms = own(LANGUAGE_UNIT_FORMS, l)
    return forms ? own(forms, form) : undefined
  }).filter(Boolean))
  if (meanings.size > 1)
    return null
  return [...meanings][0] ?? own(UNIT_FORMS, form) ?? PLAIN.get(form) ?? null
}

// `/kg`, `/ 100 g`, `/lună`, `/Monat`, `/мес.`: only right after the price, after a slash.
const PER = /^ ?\/ ?(?:(\d{1,4}) ?)?([\p{L}\p{M}²³]+\.?)(?![\p{L}\p{M}\d])/u

/** The unit glued to a price, and how much text it takes. */
export function readPer(after: string, languages: readonly string[]): { per: Per, length: number } | null {
  const m = PER.exec(after)
  if (!m)
    return null
  const raw = m[2]!.toLowerCase()
  const unit = lookup(raw, languages) ?? (raw.endsWith('.') ? lookup(raw.slice(0, -1), languages) : null)
  if (!unit)
    return null
  return { per: { unit, quantity: m[1] ? Number(m[1]) : 1 }, length: m[0].length }
}
