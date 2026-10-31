"""Turn scanned numbers into exact price value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .currency import decimals_of
from .normalize import DECIMAL_MARK, normalize
from .number import NumberContext, format_amount, parse_number
from .resolve import Evidence, resolve_currency
from .scan import scan
from .types import Ambiguous, Price


@dataclass(frozen=True)
class Candidate:
    price: Price
    has_currency: bool


def read_prices(text: str, evidence: Evidence, struck: list[bool] | None = None) -> list[Candidate]:
    normalized = normalize(text)
    positions = normalized.map
    out: list[Candidate] = []
    for found in scan(normalized.text, evidence.languages):
        res = resolve_currency(found.token, evidence)
        rejected = res.rejected_token
        if rejected:
            res = resolve_currency(None, evidence)
        token = None if rejected else found.token
        reading = parse_number(found.number, NumberContext(
            currency_known=res.currency is not None,
            three_decimals=res.currency is not None and res.sure and decimals_of(res.currency) == 3,
        ))
        if not reading:
            continue
        if (res.decided_by == "default" and res.currency and re.search(r"[1-9]", reading.fraction)
                and len(reading.fraction) > decimals_of(res.currency)):
            fit = next((code for code in res.others if decimals_of(code) >= len(reading.fraction)), None)
            if fit:
                res.others = [res.currency, *(code for code in res.others if code != fit)]
                res.currency = fit
        negative = found.minus >= 0
        decimals = decimals_of(res.currency) if res.currency else 2
        amount = format_amount(reading.integer, reading.fraction, decimals, negative)
        first = min(found.num_start, found.minus if found.minus >= 0 else found.num_start) if rejected else found.start
        start = positions[first]
        end = positions[found.num_end if rejected and not found.per else found.end]
        alt = reading.ambiguous
        ambiguous: Ambiguous | None = None
        if alt:
            alternative = f"{alt.integer}.{alt.fraction}" if alt.fraction else alt.integer
            ambiguous = {"reason": alt.reason, "alternative": ("-" if negative else "") + alternative}
        out.append(Candidate(
            has_currency=token is not None,
            price=Price(
                amount=amount,
                value=float(amount),
                currency=res.currency,
                currency_sure=res.sure,
                other_currencies=res.others,
                decided_by=res.decided_by,
                conflicts=res.conflicts,
                symbol=text[positions[token.start]:positions[token.end]] if token else None,
                negative=negative and bool(re.search(r"[1-9]", amount)),
                ambiguous=ambiguous,
                struck=bool(struck and struck[positions[found.num_start]]),
                per=found.per,
                range=found.range,
                raw=text[start:end].replace(DECIMAL_MARK, "."),
                index=start,
            ),
        ))
    return out
