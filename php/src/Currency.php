<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Currency
{
    private static ?array $codes = null;
    private static ?array $noDot = null;
    private static array $words = [];
    private static array $weak = [];
    private static int $maxToken = 3;

    public static function decimalsOf(string $code): int
    {
        return Data::load('currencies')['digits'][$code] ?? 2;
    }

    public static function isCurrencyCode(string $code): bool
    {
        self::$codes ??= array_fill_keys(Data::load('currencies')['codes'], true);
        return isset(self::$codes[$code]);
    }

    public static function currenciesOfRegion(string $region): array
    {
        $r = Text::upper($region);
        return Data::load('currencies')['regions'][$r === 'UK' ? 'GB' : $r] ?? [];
    }

    public static function isRegion(string $region): bool
    {
        return count(self::currenciesOfRegion($region)) > 0;
    }

    private static function initialize(): void
    {
        if (self::$noDot !== null) {
            return;
        }
        self::$noDot = [];
        $data = Data::load('tokens');
        $tokens = $data['tokens'];
        self::$weak = array_fill_keys($data['weak'], true);
        foreach ($tokens as $token => $candidates) {
            $len = Text::length($token);
            self::$maxToken = max(self::$maxToken, $len);
            if ($len > 2 && str_ends_with($token, '.') && !isset($tokens[substr($token, 0, -1)])) {
                self::$noDot[substr($token, 0, -1)] = $token;
            }
            if (preg_match('/^\p{L}{3,}\.?\z/u', $token)) {
                self::$words[Text::lower($token)] ??= $token;
            }
        }
    }

    private static function lookup(string $candidate): ?array
    {
        if (preg_match('/^[A-Z]{3}\z/', $candidate) && self::isCurrencyCode($candidate)) {
            return ['candidates' => [$candidate], 'iso' => true, 'key' => $candidate];
        }
        $tokens = Data::load('tokens')['tokens'];
        $key = isset($tokens[$candidate]) ? $candidate : (self::$noDot[$candidate] ?? null);
        if ($key !== null) {
            return ['candidates' => $tokens[$key], 'iso' => false, 'key' => $key];
        }
        $word = preg_match('/^\p{L}{3,}\.?\z/u', $candidate)
            ? (self::$words[Text::lower($candidate)] ?? null) : null;
        return $word !== null ? ['candidates' => $tokens[$word], 'iso' => false, 'key' => $word] : null;
    }

    private static function make(string $text, int $start, int $end, array $found): array
    {
        $raw = Text::slice($text, $start, $end);
        return [
            'text' => $raw, 'start' => $start, 'end' => $end,
            'candidates' => $found['candidates'], 'iso' => $found['iso'],
            'weak' => !$found['iso'] && (isset(self::$weak[$found['key']]) || preg_match('/^[A-Za-z]\z/', $raw) === 1),
        ];
    }

    public static function tokenBefore(string $text, int $end): ?array
    {
        self::initialize();
        for ($len = min(self::$maxToken, $end); $len >= 1; --$len) {
            $start = $end - $len;
            $candidate = Text::slice($text, $start, $end);
            if (preg_match('/\p{L}/u', Text::char($candidate, 0)) && $start > 0
                && preg_match('/\p{L}/u', Text::char($text, $start - 1))) {
                continue;
            }
            $found = self::lookup($candidate);
            if ($found !== null) {
                return self::make($text, $start, $end, $found);
            }
        }
        return null;
    }

    public static function tokenAfter(string $text, int $start): ?array
    {
        self::initialize();
        $length = Text::length($text);
        for ($len = min(self::$maxToken, $length - $start); $len >= 1; --$len) {
            $end = $start + $len;
            $candidate = Text::slice($text, $start, $end);
            if (preg_match('/\p{L}/u', Text::char($candidate, $len - 1)) && $end < $length
                && preg_match('/\p{L}/u', Text::char($text, $end))) {
                continue;
            }
            $found = self::lookup($candidate);
            if ($found !== null) {
                return self::make($text, $start, $end, $found);
            }
        }
        return null;
    }
}
