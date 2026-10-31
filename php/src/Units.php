<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Units
{
    private static ?array $plain = null;

    private static function initialize(): void
    {
        if (self::$plain !== null) {
            return;
        }
        self::$plain = [];
        foreach (Data::load('units')['global'] as $form => $unit) {
            $plain = UnitNormalizer::strip($form);
            if ($plain === $form) {
                continue;
            }
            $known = self::$plain[$plain] ?? null;
            self::$plain[$plain] = !array_key_exists($plain, self::$plain) || $known === $unit ? $unit : null;
        }
    }

    private static function lookup(string $form, array $languages): ?string
    {
        self::initialize();
        $data = Data::load('units');
        $meanings = [];
        foreach ($languages as $language) {
            $meaning = $data['language'][$language][$form] ?? null;
            if ($meaning !== null) {
                $meanings[$meaning] = true;
            }
        }
        if (count($meanings) > 1) {
            return null;
        }
        return array_key_first($meanings) ?? $data['global'][$form] ?? self::$plain[$form] ?? null;
    }

    public static function readPer(string $after, array $languages): ?array
    {
        if (!preg_match('/^ ?\/ ?(?:([0-9]{1,4}) ?)?([\p{L}\p{M}²³]+\.?)(?![\p{L}\p{M}0-9])/u', $after, $m, PREG_UNMATCHED_AS_NULL)) {
            return null;
        }
        $raw = Text::lower($m[2]);
        $unit = self::lookup($raw, $languages)
            ?? (str_ends_with($raw, '.') ? self::lookup(substr($raw, 0, -1), $languages) : null);
        if ($unit === null) {
            return null;
        }
        return [
            'per' => ['unit' => $unit, 'quantity' => $m[1] !== null ? (int) $m[1] : 1],
            'length' => Text::length($m[0]),
        ];
    }
}
