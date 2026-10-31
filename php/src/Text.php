<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Internal positions count Unicode code points, never PCRE's byte offsets. */
final class Text
{
    private static array $indexes = [];

    private static function index(string $text): TextIndex
    {
        foreach (self::$indexes as $index) {
            if ($index->text === $text) {
                return $index;
            }
        }
        $index = new TextIndex($text);
        array_unshift(self::$indexes, $index);
        if (count(self::$indexes) > 3) {
            array_pop(self::$indexes);
        }
        return $index;
    }

    public static function clear(): void
    {
        self::$indexes = [];
    }

    public static function length(string $text): int
    {
        return strlen($text) < 64 ? mb_strlen($text, 'UTF-8') : self::index($text)->length;
    }

    public static function slice(string $text, int $start, ?int $end = null): string
    {
        if (strlen($text) < 64) {
            return mb_substr($text, $start, $end === null ? null : max(0, $end - $start), 'UTF-8');
        }
        $index = self::index($text);
        $start = $start < 0 ? max(0, $index->length + $start) : $start;
        $from = $index->byte($start);
        return substr($text, $from, $end === null ? null : max(0, $index->byte($end) - $from));
    }

    public static function char(string $text, int $index): string
    {
        return $index < 0 ? '' : self::slice($text, $index, $index + 1);
    }

    public static function offset(string $text, int $bytes): int
    {
        return strlen($text) < 64 ? mb_strlen(substr($text, 0, $bytes), 'UTF-8') : self::index($text)->offset($bytes);
    }

    public static function lower(string $text): string
    {
        return mb_strtolower($text, 'UTF-8');
    }

    public static function upper(string $text): string
    {
        return mb_strtoupper($text, 'UTF-8');
    }

    public static function trim(string $text): string
    {
        return preg_replace('/^[\s\x{FEFF}]+|[\s\x{FEFF}]+\z/u', '', $text) ?? $text;
    }

    /** PHP strings cannot represent JavaScript's unpaired UTF-16 surrogates. */
    public static function scrubJsonSurrogates(string $json): string
    {
        if (stripos($json, '\\u') === false) {
            return $json;
        }
        $out = '';
        for ($at = 0, $n = strlen($json); $at < $n; ++$at) {
            if ($json[$at] !== '\\') {
                $out .= $json[$at];
                continue;
            }
            if (($json[$at + 1] ?? '') !== 'u') {
                $out .= substr($json, $at, 2);
                ++$at;
                continue;
            }
            $cp = hexdec(substr($json, $at + 2, 4));
            $next = substr($json, $at + 6, 2) === '\\u' ? hexdec(substr($json, $at + 8, 4)) : 0;
            if ($cp >= 0xD800 && $cp <= 0xDBFF && $next >= 0xDC00 && $next <= 0xDFFF) {
                $out .= substr($json, $at, 12);
                $at += 11;
            } else {
                $out .= $cp >= 0xD800 && $cp <= 0xDFFF ? '\\uFFFD' : substr($json, $at, 6);
                $at += 5;
            }
        }
        return $out;
    }

    public static function scrub(string $text): string
    {
        if (mb_check_encoding($text, 'UTF-8')) {
            return $text;
        }
        $old = mb_substitute_character();
        try {
            mb_substitute_character(0xFFFD);
            return mb_scrub($text, 'UTF-8');
        } finally {
            mb_substitute_character($old);
        }
    }
}
