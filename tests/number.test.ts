import { describe, expect, it } from 'vitest'
import { formatAmount, parseNumber } from '../src/number'
import { DECIMAL_MARK } from '../src/normalize'

const read = (raw: string, ctx = {}) => {
  const r = parseNumber(raw, ctx)
  return r && `${r.integer}.${r.fraction}`
}

describe('parseNumber, two-decimals rule', () => {
  it.each([
    ['1299', '1299.'],
    ['1.299,00', '1299.00'],
    ['1,299.00', '1299.00'],
    ['1 299,00', '1299.00'],
    ['1\'299.50', '1299.50'],
    ['1.234.567,89', '1234567.89'],
    ['1,234,567', '1234567.'],
    ['12,34,567.89', '1234567.89'],
    ['1,23,456', '123456.'],
    ['19,99', '19.99'],
    ['19.9', '19.9'],
    ['0,999', '0.999'],
    ['1234.567', '1234.567'],
    ['112,0099', '112.0099'],
    ['.99', '0.99'],
    [',50', '0.50'],
    ['12,-', '12.'],
    ['1.299,-', '1299.'],
    ['12.--', '12.'],
    ['007', '7.'],
    [`19${DECIMAL_MARK}99`, '19.99'],
    [`1.299${DECIMAL_MARK}00`, '1299.00'],
  ])('%s -> %s', (raw, out) => {
    expect(read(raw, { currencyKnown: true })).toBe(out)
  })

  it('reads one separator with 3 digits as thousands', () => {
    expect(read('1.299', { currencyKnown: true })).toBe('1299.')
    expect(read('1,299', { currencyKnown: true })).toBe('1299.')
  })

  it('reads 3 digits as decimals for a 3-decimal currency', () => {
    expect(read('12.500', { currencyKnown: true, threeDecimals: true })).toBe('12.500')
  })

  it('flags 1.299 when the currency is unknown, with the decimal reading as alternative', () => {
    const r = parseNumber('1.299')!
    expect(`${r.integer}.${r.fraction}`).toBe('1299.')
    expect(r.ambiguous).toEqual({ reason: 'separator', integer: '1', fraction: '299' })
  })

  it('does not flag 1.299 when the currency is known', () => {
    expect(parseNumber('1.299', { currencyKnown: true })!.ambiguous).toBeNull()
  })

  it.each(['1,,2', '1.2.3,4.5', '12.34.56', '1,234.567,89', ',', '1.', '1.234 56'])('rejects %s', (raw) => {
    expect(parseNumber(raw, { currencyKnown: true })).toBeNull()
  })
})

describe('formatAmount', () => {
  it.each([
    ['1299', '', 2, '1299.00'],
    ['1299', '', 0, '1299'],
    ['19', '9', 2, '19.90'],
    ['12', '5', 3, '12.500'],
    ['1299', '00', 0, '1299'],
    ['112', '0099', 2, '112.0099'],
    ['0', '', 2, '0.00'],
  ] as const)('%s.%s with %i decimals -> %s', (i, f, d, out) => {
    expect(formatAmount(i, f, d)).toBe(out)
  })

  it('adds the sign, but never to zero', () => {
    expect(formatAmount('249', '80', 2, true)).toBe('-249.80')
    expect(formatAmount('0', '', 2, true)).toBe('0.00')
  })
})
