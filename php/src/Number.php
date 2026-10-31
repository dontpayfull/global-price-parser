<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Number
{
    private static function stripZeros(string $digits): string
    {
        $s = preg_replace('/^0+(?=[0-9])/u', '', $digits);
        return $s === '' ? '0' : $s;
    }

    private static function validGrouping(array $groups, array $seps): bool
    {
        if (count($groups) < 2) {
            return true;
        }
        if (count(array_unique($seps)) !== 1) {
            return false;
        }
        $first = $groups[0];
        $rest = array_slice($groups, 1);
        if (strlen($first) < 1 || strlen($first) > 3) {
            return false;
        }
        if (count(array_filter($rest, static fn (string $g): bool => strlen($g) !== 3)) === 0) {
            return true;
        }
        $last = $rest[count($rest) - 1];
        return $seps[0] === ',' && strlen($first) <= 2 && strlen($last) === 3
            && count(array_filter(array_slice($rest, 0, -1), static fn (string $g): bool => strlen($g) !== 2)) === 0;
    }

    private static function reading(array $intGroups, string $fraction): array
    {
        return ['integer' => self::stripZeros(implode('', $intGroups)), 'fraction' => $fraction];
    }

    public static function parseNumber(string $raw, array $ctx = []): ?array
    {
        $s = $raw;
        $dashZero = false;
        if (preg_match('/[.,]-{1,2}\z/u', $s, $dz, PREG_OFFSET_CAPTURE)) {
            $dashZero = true;
            $s = substr($s, 0, $dz[0][1]);
        }
        if (str_contains($s, Normalize::DECIMAL_MARK)) {
            $pieces = explode(Normalize::DECIMAL_MARK, $s);
            if (count($pieces) !== 2) {
                return null;
            }
            [$intPart, $fracPart] = $pieces;
            if (!preg_match('/^[0-9][0-9.,\x27 ]*\z/u', $intPart) || !preg_match('/^[0-9]+\z/u', $fracPart)) {
                return null;
            }
            return self::reading([preg_replace('/[^0-9]/u', '', $intPart)], $fracPart) + ['ambiguous' => null];
        }
        if (preg_match('/^[.,][0-9]+\z/u', $s)) {
            return ['integer' => '0', 'fraction' => substr($s, 1), 'ambiguous' => null];
        }
        preg_match_all('/[0-9]+|[.,\x27 ]/u', $s, $matches);
        $parts = $matches[0];
        if (!$parts || implode('', $parts) !== $s || !preg_match('/^[0-9]/u', $s) || !preg_match('/[0-9]\z/u', $s)) {
            return null;
        }
        $groups = [];
        $seps = [];
        foreach ($parts as $i => $p) {
            $isDigits = preg_match('/^[0-9]/u', $p) === 1;
            if ($isDigits !== ($i % 2 === 0)) {
                return null;
            }
            if ($isDigits) {
                $groups[] = $p;
            } else {
                $seps[] = $p;
            }
        }
        $done = static fn (array $r, ?array $amb = null): array => [
            'integer' => $r['integer'],
            'fraction' => $dashZero ? '' : $r['fraction'],
            'ambiguous' => $dashZero ? null : $amb,
        ];
        if (count($seps) === 0) {
            return $done(self::reading($groups, ''));
        }
        $marks = array_values(array_filter($seps, static fn (string $s): bool => $s !== ' ' && $s !== "'"));
        $kinds = array_values(array_unique($marks));
        $last = $seps[count($seps) - 1];
        $lastGroup = $groups[count($groups) - 1];
        $intGroups = array_slice($groups, 0, -1);
        $intSeps = array_slice($seps, 0, -1);
        if ($last === ' ' && strlen($lastGroup) === 2 && !$marks && self::validGrouping($intGroups, $intSeps)) {
            return $done(self::reading($intGroups, $lastGroup));
        }
        if (count($kinds) === 0) {
            return self::validGrouping($groups, $seps) ? $done(self::reading($groups, '')) : null;
        }
        if (count($kinds) === 2) {
            if ($last === ' ' || $last === "'" || array_search($last, $marks, true) !== count($marks) - 1) {
                return null;
            }
            return self::validGrouping($intGroups, $intSeps) ? $done(self::reading($intGroups, $lastGroup)) : null;
        }
        $mark = $kinds[0];
        if ($last !== $mark) {
            return self::validGrouping($groups, $seps) ? $done(self::reading($groups, '')) : null;
        }
        if (count($marks) > 1) {
            if (self::validGrouping($groups, $seps)) {
                return $done(self::reading($groups, ''));
            }
            if (strlen($lastGroup) !== 3 && self::validGrouping($intGroups, $intSeps)) {
                return $done(self::reading($intGroups, $lastGroup), [
                    'reason' => 'irregular-grouping', 'integer' => self::stripZeros(implode('', $groups)), 'fraction' => '',
                ]);
            }
            return null;
        }
        $hasSpaceGroups = in_array(' ', $seps, true) || in_array("'", $seps, true);
        $first = $groups[0];
        if ($hasSpaceGroups) {
            return self::validGrouping($intGroups, $intSeps) ? $done(self::reading($intGroups, $lastGroup)) : null;
        }
        if (strlen($lastGroup) !== 3 || $first === '0' || strlen($first) > 3 || ($ctx['threeDecimals'] ?? false)) {
            return $done(self::reading($intGroups, $lastGroup));
        }
        $asThousands = self::reading($groups, '');
        if ($ctx['currencyKnown'] ?? false) {
            return $done($asThousands);
        }
        return $done($asThousands, ['reason' => 'separator'] + self::reading($intGroups, $lastGroup));
    }

    public static function formatAmount(string $integer, string $fraction, int $decimals, bool $negative = false): string
    {
        $f = $fraction;
        if (strlen($f) < $decimals) {
            $f = str_pad($f, $decimals, '0');
        } elseif (strlen($f) > $decimals && preg_match('/^0*\z/u', substr($f, $decimals))) {
            $f = substr($f, 0, $decimals);
        }
        $body = $f !== '' ? $integer . '.' . $f : $integer;
        return $negative && preg_match('/[1-9]/u', $body) ? '-' . $body : $body;
    }
}
