<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Compact UTF-8 byte boundaries; ASCII needs no offset table at all. */
final class TextIndex
{
    private string $offsets = '';
    public readonly int $length;

    public function __construct(public readonly string $text)
    {
        $bytes = strlen($text);
        if (!preg_match('/[^\x00-\x7F]/', $text)) {
            $this->length = $bytes;
            return;
        }
        $count = 0;
        for ($at = 0; $at < $bytes; ++$count) {
            $this->offsets .= pack('V', $at);
            $lead = ord($text[$at]);
            $at += $lead < 0x80 ? 1 : ($lead < 0xE0 ? 2 : ($lead < 0xF0 ? 3 : 4));
        }
        $this->offsets .= pack('V', $bytes);
        $this->length = $count;
    }

    public function byte(int $index): int
    {
        $index = max(0, min($this->length, $index));
        return $this->offsets === '' ? $index : unpack('V', $this->offsets, $index * 4)[1];
    }

    public function offset(int $bytes): int
    {
        if ($this->offsets === '') {
            return $bytes;
        }
        $lo = 0;
        $hi = $this->length;
        while ($lo < $hi) {
            $mid = intdiv($lo + $hi + 1, 2);
            if ($this->byte($mid) <= $bytes) {
                $lo = $mid;
            } else {
                $hi = $mid - 1;
            }
        }
        return $lo;
    }
}
