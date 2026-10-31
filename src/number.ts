import { DECIMAL_MARK } from './normalize'

export interface NumberContext {
  /** True when the currency is known and uses 3 decimals (KWD, BHD...). */
  threeDecimals?: boolean
  /** True when the currency is known (no ambiguity flag for `1.299 €`). */
  currencyKnown?: boolean
}

export interface NumberReading {
  integer: string
  fraction: string
  ambiguous: { reason: 'separator' | 'irregular-grouping', integer: string, fraction: string } | null
}

const GROUP_ONLY = new Set([' ', '\''])

function stripZeros(digits: string): string {
  const s = digits.replace(/^0+(?=\d)/, '')
  return s === '' ? '0' : s
}

/** Groups of 3 (`1.234.567`) or the Indian pattern (`12,34,567`). */
function validGrouping(groups: string[], seps: string[]): boolean {
  if (groups.length < 2)
    return true
  if (new Set(seps).size !== 1)
    return false
  const [first, ...rest] = groups as [string, ...string[]]
  if (first.length < 1 || first.length > 3)
    return false
  if (rest.every(g => g.length === 3))
    return true
  // Indian: 1-2 digits, then pairs, then a final group of 3.
  const last = rest[rest.length - 1]!
  return seps[0] === ',' && first.length <= 2 && last.length === 3
    && rest.slice(0, -1).every(g => g.length === 2)
}

function reading(intGroups: string[], fraction: string): { integer: string, fraction: string } {
  return { integer: stripZeros(intGroups.join('')), fraction }
}

/**
 * Reads the digits and separators of one number (already normalized to ASCII).
 * The rule is the "two decimals" concept: a separator followed by 1-2 digits is the
 * decimal point, followed by exactly 3 digits it separates thousands (unless the
 * currency is known to use 3 decimals). Returns null when it is not a valid number.
 */
export function parseNumber(raw: string, ctx: NumberContext = {}): NumberReading | null {
  let s = raw
  let dashZero = false
  const dz = /[.,]-{1,2}$/.exec(s)
  if (dz) {
    dashZero = true
    s = s.slice(0, dz.index)
  }

  if (s.includes(DECIMAL_MARK)) {
    const pieces = s.split(DECIMAL_MARK)
    const [intPart = '', fracPart = ''] = pieces
    if (pieces.length !== 2 || !/^\d[\d.,' ]*$/.test(intPart) || !/^\d+$/.test(fracPart))
      return null
    return { ...reading([intPart.replace(/\D/g, '')], fracPart), ambiguous: null }
  }

  if (/^[.,]\d+$/.test(s))
    return { integer: '0', fraction: s.slice(1), ambiguous: null }

  const parts = s.match(/\d+|[.,' ]/g)
  if (!parts || parts.join('') !== s || !/^\d/.test(s) || !/\d$/.test(s))
    return null
  const groups: string[] = []
  const seps: string[] = []
  for (const [i, p] of parts.entries()) {
    const isDigits = /^\d/.test(p)
    if (isDigits !== (i % 2 === 0))
      return null // two separators in a row
    ;(isDigits ? groups : seps).push(p)
  }

  const done = (r: { integer: string, fraction: string }, amb: NumberReading['ambiguous'] = null): NumberReading =>
    ({ integer: r.integer, fraction: dashZero ? '' : r.fraction, ambiguous: dashZero ? null : amb })

  if (seps.length === 0)
    return done(reading(groups, ''))

  const marks = seps.filter(x => !GROUP_ONLY.has(x))
  const kinds = new Set(marks)
  const last = seps[seps.length - 1]!
  const lastGroup = groups[groups.length - 1]!
  const intGroups = groups.slice(0, -1)
  const intSeps = seps.slice(0, -1)

  // `€5 99`, `€100 500 03`: cents after a space, as left when a `<sup>` loses its markup.
  if (last === ' ' && lastGroup.length === 2 && !marks.length && validGrouping(intGroups, intSeps))
    return done(reading(intGroups, lastGroup))

  if (kinds.size === 0)
    return validGrouping(groups, seps) ? done(reading(groups, '')) : null

  if (kinds.size === 2) {
    // `1.234,56` / `1,234.56`: the last mark is the decimal point and appears once.
    if (GROUP_ONLY.has(last) || marks.indexOf(last) !== marks.length - 1)
      return null
    return validGrouping(intGroups, intSeps) ? done(reading(intGroups, lastGroup)) : null
  }

  const mark = [...kinds][0]!
  const count = marks.length

  if (last !== mark) {
    // `1.234 567`: not a real format.
    return validGrouping(groups, seps) ? done(reading(groups, '')) : null
  }

  if (count > 1) {
    if (validGrouping(groups, seps))
      return done(reading(groups, ''))
    if (lastGroup.length !== 3 && validGrouping(intGroups, intSeps)) {
      const r = reading(intGroups, lastGroup)
      return done(r, { reason: 'irregular-grouping', integer: stripZeros(groups.join('')), fraction: '' })
    }
    return null
  }

  // A single `.` or `,`, and it is the last separator.
  const hasSpaceGroups = seps.some(x => GROUP_ONLY.has(x))
  const first = groups[0]!
  if (hasSpaceGroups) {
    // `1 234,56`: spaces group the thousands, so the mark is the decimal point.
    return validGrouping(intGroups, intSeps) ? done(reading(intGroups, lastGroup)) : null
  }
  if (lastGroup.length !== 3 || first === '0' || first.length > 3 || ctx.threeDecimals)
    return done(reading(intGroups, lastGroup))
  // `1.299`: thousands under the two-decimals rule.
  const asThousands = reading(groups, '')
  if (ctx.currencyKnown)
    return done(asThousands)
  const alt = reading(intGroups, lastGroup)
  return done(asThousands, { reason: 'separator', integer: alt.integer, fraction: alt.fraction })
}

/** `integer` + `fraction` as the amount string, padded to the currency's decimals. */
export function formatAmount(integer: string, fraction: string, decimals: number, negative = false): string {
  let f = fraction
  if (f.length < decimals)
    f = f.padEnd(decimals, '0')
  else if (f.length > decimals && /^0*$/.test(f.slice(decimals)))
    f = f.slice(0, decimals)
  const body = f ? `${integer}.${f}` : integer
  return negative && /[1-9]/.test(body) ? `-${body}` : body
}
