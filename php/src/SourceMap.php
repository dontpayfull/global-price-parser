<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Normalization changes one code point to one, except for deleted bidi controls. */
final class SourceMap
{
    private string $points = '';
    private int $count = 0;

    public function deleted(int $normalized, int $original): void
    {
        $point = pack('V2', $normalized, $original - $normalized);
        if ($this->count && unpack('V', $this->points, ($this->count - 1) * 8)[1] === $normalized) {
            $this->points = substr_replace($this->points, $point, -8);
        } else {
            $this->points .= $point;
            ++$this->count;
        }
    }

    public function at(int $index): int
    {
        $lo = 0;
        $hi = $this->count;
        while ($lo < $hi) {
            $mid = intdiv($lo + $hi, 2);
            if (unpack('V', $this->points, $mid * 8)[1] <= $index) {
                $lo = $mid + 1;
            } else {
                $hi = $mid;
            }
        }
        return $index + ($lo ? unpack('V', $this->points, ($lo - 1) * 8 + 4)[1] : 0);
    }
}
