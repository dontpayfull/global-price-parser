<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Immutable on PHP 8.1 as well as versions that support readonly class syntax. */
final class Price
{
    /** @param list<string> $otherCurrencies @param list<string> $conflicts */
    public function __construct(
        public readonly string $amount,
        public readonly float $value,
        public readonly ?string $currency,
        public readonly bool $currencySure,
        public readonly array $otherCurrencies,
        public readonly string $decidedBy,
        public readonly array $conflicts,
        public readonly ?string $symbol,
        public readonly bool $negative,
        public readonly ?array $ambiguous,
        public readonly bool $struck,
        public readonly ?array $per,
        public readonly ?string $range,
        public readonly string $raw,
        /** Offset into the extracted text, in Unicode code points. */
        public readonly int $index,
    ) {
    }

    public function toArray(): array
    {
        return get_object_vars($this);
    }
}
