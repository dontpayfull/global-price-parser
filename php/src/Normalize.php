<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Normalize
{
    public const DECIMAL_MARK = "\u{E000}";
    private static ?array $digits = null;

    private static function digitOf(string $ch): ?string
    {
        if ($ch >= '0' && $ch <= '9' && strlen($ch) === 1) {
            return $ch;
        }
        if (strlen($ch) === 1) {
            return null;
        }
        if (self::$digits === null) {
            self::$digits = [];
            foreach (Data::load('digits')['zeros'] as $zero) {
                for ($i = 0; $i < 10; ++$i) {
                    self::$digits[mb_chr($zero + $i, 'UTF-8')] = (string) $i;
                }
            }
        }
        return self::$digits[$ch] ?? null;
    }

    public static function asciiDigits(string $text): string
    {
        return preg_replace_callback('/[^\x00-\x7F]/u', static fn (array $m): string => self::digitOf($m[0]) ?? $m[0], $text);
    }

    public static function normalize(string $input): array
    {
        $text = '';
        $map = new SourceMap();
        $offset = 0;
        $original = 0;
        $normalized = 0;
        while (preg_match('/[\x00-\x7F]+|[^\x00-\x7F]/u', $input, $m, 0, $offset)) {
            $ch = $m[0];
            $bytes = strlen($ch);
            $offset += $bytes;
            if (ord($ch[0]) < 0x80) {
                $text .= $ch;
                $original += $bytes;
                $normalized += $bytes;
                continue;
            }
            $out = self::digitOf($ch) ?? $ch;
            if ($ch === "\u{066B}") {
                $out = '.';
            } elseif ($ch === "\u{066C}") {
                $out = ',';
            } elseif (preg_match('/[\x{061C}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}\x{2066}-\x{2069}\x{FEFF}]/u', $ch)) {
                $out = '';
            } elseif (preg_match('/[\x{2212}\x{2012}\x{2013}\x{2014}\x{FE63}\x{FF0D}]/u', $ch)) {
                $out = '-';
            } elseif (preg_match('/[\x{00A0}\x{202F}\x{2009}\x{2007}\x{2002}-\x{2006}\x{3000}]/u', $ch)) {
                $out = ' ';
            } elseif ($ch === "\u{2019}" || $ch === "\u{02BC}") {
                $out = "'";
            }
            ++$original;
            if ($out === '') {
                $map->deleted($normalized, $original);
            } else {
                $text .= $out;
                ++$normalized;
            }
        }
        return ['text' => $text, 'map' => $map];
    }
}
