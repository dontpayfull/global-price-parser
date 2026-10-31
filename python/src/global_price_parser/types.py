"""Public value objects and options for the price parser."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, TypedDict


class Ambiguous(TypedDict):
    reason: str
    alternative: str


@dataclass(frozen=True)
class Per:
    """CLDR unit identifier and the quantity a price is for."""

    unit: str
    quantity: int

    def to_dict(self) -> dict[str, Any]:
        return {"unit": self.unit, "quantity": self.quantity}


@dataclass(frozen=True)
class Price:
    """One price, including its exact amount and currency evidence."""

    amount: str
    value: float
    currency: Optional[str]
    currency_sure: bool
    other_currencies: list[str]
    decided_by: str
    conflicts: list[str]
    symbol: Optional[str]
    negative: bool
    ambiguous: Optional[Ambiguous]
    struck: bool
    per: Optional[Per]
    range: Optional[str]
    raw: str
    index: int

    def to_dict(self) -> dict[str, Any]:
        """Return the reference JSON shape, with camelCase field names."""
        return {
            "amount": self.amount,
            "value": self.value,
            "currency": self.currency,
            "currencySure": self.currency_sure,
            "otherCurrencies": list(self.other_currencies),
            "decidedBy": self.decided_by,
            "conflicts": list(self.conflicts),
            "symbol": self.symbol,
            "negative": self.negative,
            "ambiguous": dict(self.ambiguous) if self.ambiguous is not None else None,
            "struck": self.struck,
            "per": self.per.to_dict() if self.per is not None else None,
            "range": self.range,
            "raw": self.raw,
            "index": self.index,
        }


@dataclass(frozen=True)
class Signal:
    """A currency or country signal, identified by its source."""

    source: str
    currency: Optional[str] = None
    country: Optional[str] = None
    likely: Optional[bool] = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"source": self.source}
        if self.currency is not None:
            result["currency"] = self.currency
        if self.country is not None:
            result["country"] = self.country
        if self.likely is not None:
            result["likely"] = self.likely
        return result


@dataclass(frozen=True)
class PageSignals:
    """Page currency and country signals, in priority order."""

    currency: list[Signal]
    country: list[Signal]
    language: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "currency": [signal.to_dict() for signal in self.currency],
            "country": [signal.to_dict() for signal in self.country],
            "language": self.language,
        }


@dataclass(frozen=True)
class Options:
    currency: Optional[str] = None
    country: Optional[str] = None
    language: Optional[str] = None
    url: Optional[str] = None
    page: Optional[str] = None
    html: Optional[bool] = None
