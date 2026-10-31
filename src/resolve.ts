import { currenciesOfRegion } from './currency'
import type { TokenMatch } from './currency'
import type { Decision, Signal } from './types'

/** Hints and page signals, already in priority order. */
export interface Evidence {
  entries: Signal[]
  /** Languages used to read the few unit forms that depend on the language: the declared
   * one and the main language of the country, when known. */
  languages: string[]
}

export interface Resolved {
  currency: string | null
  sure: boolean
  others: string[]
  decidedBy: Decision
  conflicts: string[]
  /** The token was a weak one (`R`, `L`) that nothing confirmed: not a currency. */
  rejectedToken: boolean
}

function currenciesOf(signal: Signal): readonly string[] {
  if (signal.currency)
    return [signal.currency]
  if (signal.country)
    return currenciesOfRegion(signal.country)
  return []
}

function describe(signal: Signal): string {
  return `${signal.source}:${signal.currency ?? signal.country}`
}

/**
 * Picks the currency of one price. A signal can only choose among the currencies
 * the symbol can mean; the symbol itself is never overruled.
 */
export function resolveCurrency(token: TokenMatch | null, evidence: Evidence): Resolved {
  const candidates = token ? token.candidates : null
  if (token && !token.weak && candidates!.length === 1)
    return { currency: candidates![0]!, sure: true, others: [], decidedBy: 'symbol', conflicts: [], rejectedToken: false }

  const conflicts: string[] = []
  const fitOf = (signal: Signal) => {
    const options = currenciesOf(signal)
    return candidates ? options.filter(c => candidates.includes(c)) : [...options]
  }
  const entries = evidence.entries
  for (let i = 0; i < entries.length; i++) {
    const signal = entries[i]!
    const fit = fitOf(signal)
    if (fit.length) {
      // Signals from the same source count together: a page with offers in USD and CAD
      // does not make `$` sure.
      for (const other of entries.slice(i + 1).filter(e => e.source === signal.source)) {
        for (const c of fitOf(other)) {
          if (!fit.includes(c))
            fit.push(c)
        }
      }
      return {
        currency: fit[0]!,
        sure: fit.length === 1 && !signal.likely,
        others: fit.slice(1),
        decidedBy: signal.source as Decision,
        conflicts,
        rejectedToken: false,
      }
    }
    if (candidates && currenciesOf(signal).length)
      conflicts.push(describe(signal))
  }

  if (!token)
    return { currency: null, sure: false, others: [], decidedBy: 'none', conflicts, rejectedToken: false }
  if (token.weak)
    return { currency: null, sure: false, others: [], decidedBy: 'none', conflicts, rejectedToken: true }
  return {
    currency: candidates![0]!,
    sure: false,
    others: candidates!.slice(1),
    decidedBy: 'default',
    conflicts,
    rejectedToken: false,
  }
}
