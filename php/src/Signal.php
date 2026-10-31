<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Signal
{
    public function __construct(
        public readonly string $source,
        public readonly ?string $currency = null,
        public readonly ?string $country = null,
        public readonly ?bool $likely = null,
    ) {
    }

    public function toArray(): array
    {
        $out = ['source' => $this->source];
        if ($this->currency !== null) {
            $out['currency'] = $this->currency;
        }
        if ($this->country !== null) {
            $out['country'] = $this->country;
        }
        if ($this->likely !== null) {
            $out['likely'] = $this->likely;
        }
        return $out;
    }
}
