import { DIGIT_ZEROS } from './data/digits'

/** Marker the HTML reader puts before `<sup>99</sup>` cents: a decimal point for sure. */
export const DECIMAL_MARK = '\uE000'

// Bidi controls and zero-width characters: invisible, never part of a price.
const BIDI = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/
const MINUS = /[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/
const SPACE = /[\u00A0\u202F\u2009\u2007\u2002-\u2006\u3000]/

function digitOf(cp: number): string | null {
  if (cp >= 0x30 && cp <= 0x39)
    return String.fromCharCode(cp)
  if (cp < 0x660)
    return null
  for (const zero of DIGIT_ZEROS) {
    if (cp >= zero && cp <= zero + 9)
      return String(cp - zero)
    if (zero > cp)
      break
  }
  return null
}

export interface Normalized {
  text: string
  /** For every char of `text`, the index of the char it came from in the input. */
  map: number[]
}

/**
 * Makes a price text easy to scan without changing its meaning:
 * Unicode digits become ASCII, Arabic separators become `.`/`,`, all minus signs
 * become `-`, special spaces become a plain space, bidi marks disappear.
 */
export function normalize(input: string): Normalized {
  let text = ''
  const map: number[] = []
  let i = 0
  for (const ch of input) {
    const cp = ch.codePointAt(0)!
    let out: string = ch
    const digit = digitOf(cp)
    if (digit !== null)
      out = digit
    else if (ch === '\u066B')
      out = '.'
    else if (ch === '\u066C')
      out = ','
    else if (BIDI.test(ch))
      out = ''
    else if (MINUS.test(ch))
      out = '-'
    else if (SPACE.test(ch))
      out = ' '
    else if (ch === '\u2019' || ch === '\u02BC')
      out = '\''
    // One map entry per UTF-16 unit: an emoji is 2 units in `text` and in the input.
    text += out
    for (let k = 0; k < out.length; k++)
      map.push(i)
    i += ch.length
  }
  map.push(i)
  return { text, map }
}

/** Unicode digits as ASCII, nothing else changed (`٥٠` -> `50`). */
export function asciiDigits(s: string): string {
  let out = ''
  for (const ch of s) {
    const d = digitOf(ch.codePointAt(0)!)
    out += d ?? ch
  }
  return out
}
