<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class PageSignals
{
    /** @param list<Signal> $currency @param list<Signal> $country */
    public function __construct(
        public readonly array $currency,
        public readonly array $country,
        public readonly ?string $language,
    ) {
    }

    public function toArray(): array
    {
        return [
            'currency' => array_map(static fn (Signal $s): array => $s->toArray(), $this->currency),
            'country' => array_map(static fn (Signal $s): array => $s->toArray(), $this->country),
            'language' => $this->language,
        ];
    }
}
