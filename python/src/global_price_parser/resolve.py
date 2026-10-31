"""Resolve a price's currency against ordered hints and page signals."""

from __future__ import annotations

from dataclasses import dataclass

from .currency import TokenMatch, currencies_of_region
from .types import Signal


@dataclass(frozen=True)
class Evidence:
    entries: list[Signal]
    languages: list[str]


@dataclass
class Resolved:
    currency: str | None
    sure: bool
    others: list[str]
    decided_by: str
    conflicts: list[str]
    rejected_token: bool


def currencies_of(signal: Signal) -> list[str]:
    if signal.currency:
        return [signal.currency]
    if signal.country:
        return currencies_of_region(signal.country)
    return []


def describe(signal: Signal) -> str:
    return f"{signal.source}:{signal.currency if signal.currency is not None else signal.country}"


def resolve_currency(token: TokenMatch | None, evidence: Evidence) -> Resolved:
    candidates = token.candidates if token else None
    if token and not token.weak and len(candidates) == 1:
        return Resolved(candidates[0], True, [], "symbol", [], False)
    conflicts: list[str] = []
    def fit_of(signal: Signal) -> list[str]:
        options = currencies_of(signal)
        return [code for code in options if code in candidates] if candidates is not None else list(options)

    entries = evidence.entries
    for i, signal in enumerate(entries):
        fit = fit_of(signal)
        if fit:
            for other in entries[i + 1:]:
                if other.source != signal.source:
                    continue
                for code in fit_of(other):
                    if code not in fit:
                        fit.append(code)
            return Resolved(fit[0], len(fit) == 1 and not signal.likely, fit[1:], signal.source, conflicts, False)
        if candidates is not None and currencies_of(signal):
            conflicts.append(describe(signal))
    if not token:
        return Resolved(None, False, [], "none", conflicts, False)
    if token.weak:
        return Resolved(None, False, [], "none", conflicts, True)
    return Resolved(candidates[0], False, candidates[1:], "default", conflicts, False)
