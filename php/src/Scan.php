<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Scan
{
    private static function skipSpacesBack(string $text, int $pos): int
    {
        $p = $pos;
        while ($p > 0 && $pos - $p < 2 && Text::char($text, $p - 1) === ' ') {
            --$p;
        }
        return $p;
    }

    private static function skipSpaces(string $text, int $pos): int
    {
        $p = $pos;
        while ($p < Text::length($text) && $p - $pos < 2 && Text::char($text, $p) === ' ') {
            ++$p;
        }
        return $p;
    }

    private static function dashBefore(string $text, int $pos): int
    {
        $q = Text::char($text, $pos - 1) === ' ' ? $pos - 1 : $pos;
        return Text::char($text, $q - 1) === '-' ? $q - 1 : -1;
    }

    private static function freeDash(string $text, int $dash): bool
    {
        return $dash === 0 || preg_match('/[\s:(\-]/u', Text::char($text, $dash - 1)) === 1;
    }

    public static function scan(string $text, array $languages = []): array
    {
        $number = '/(?:(?<![0-9.,])[.,](?=[0-9]{1,2}(?![0-9.,\x27])))?[0-9]+(?:(?:[.,\x27]|\x{E000}| (?=[0-9]{3}(?![0-9])))[0-9]+)*(?:[.,]-{1,2}(?![0-9])| [0-9]{2}(?![0-9]|[.,][0-9]))?/u';
        preg_match_all($number, $text, $matches, PREG_OFFSET_CAPTURE);
        $raws = [];
        foreach ($matches[0] as [$numberText, $byteOffset]) {
            $numStart = Text::offset($text, $byteOffset);
            $numEnd = $numStart + Text::length($numberText);
            if (preg_match('/^ ?[%‰]/u', Text::slice($text, $numEnd, $numEnd + 2))) {
                continue;
            }
            if ($numStart > 0 && preg_match('/[\p{L}0-9]/u', Text::char($text, $numStart - 1)) && !Currency::tokenBefore($text, $numStart)) {
                continue;
            }
            $minusNum = -1;
            $left = null;
            $dash = self::dashBefore($text, $numStart);
            if ($dash >= 0) {
                $tokenBeforeDash = Currency::tokenBefore($text, self::skipSpacesBack($text, $dash));
                if ($tokenBeforeDash !== null) {
                    $left = $tokenBeforeDash;
                    $minusNum = $dash;
                } elseif (self::freeDash($text, $dash)) {
                    $minusNum = $dash;
                }
            }
            $left ??= Currency::tokenBefore($text, self::skipSpacesBack($text, $minusNum >= 0 ? $minusNum : $numStart));
            $minusTok = -1;
            if ($left !== null && $minusNum < 0) {
                $d = self::dashBefore($text, $left['start']);
                if ($d >= 0 && self::freeDash($text, $d)) {
                    $minusTok = $d;
                }
            }
            $right = Currency::tokenAfter($text, self::skipSpaces($text, $numEnd));
            $raws[] = compact('numberText', 'numStart', 'numEnd', 'left', 'right', 'minusNum', 'minusTok');
        }
        $claimed = [];
        $found = [];
        foreach ($raws as $i => $r) {
            $left = $r['left'] !== null && !isset($claimed[$r['left']['start']]) ? $r['left'] : null;
            $right = $r['right'] !== null && !isset($claimed[$r['right']['start']]) ? $r['right'] : null;
            $next = $raws[$i + 1] ?? null;
            if ($right !== null && $next !== null && ($next['left']['start'] ?? null) === $right['start']) {
                $before = $right['start'] - $r['numEnd'];
                $after = $next['numStart'] - $right['end'];
                if ($after < $before || ($after === 0 && $before === 0 && $next['right'] === null)) {
                    $right = null;
                }
            }
            $token = $left !== null && !$left['weak'] ? $left
                : ($right !== null && !$right['weak'] ? $right : ($left ?? $right));
            $isLeft = $token !== null && $token === $left;
            if ($token !== null) {
                $claimed[$token['start']] = true;
            }
            $minus = $isLeft && $r['minusTok'] >= 0 ? $r['minusTok'] : $r['minusNum'];
            $start = min($r['numStart'], $token['start'] ?? PHP_INT_MAX, $minus >= 0 ? $minus : PHP_INT_MAX);
            $end = max($r['numEnd'], $token['end'] ?? 0);
            $unit = Units::readPer(Text::slice($text, $end, $end + 24), $languages);
            $found[] = [
                'number' => $r['numberText'], 'numStart' => $r['numStart'], 'numEnd' => $r['numEnd'],
                'token' => $token, 'minus' => $minus, 'start' => $start, 'end' => $end + ($unit['length'] ?? 0),
                'range' => null, 'per' => $unit['per'] ?? null,
            ];
        }
        for ($i = 1, $count = count($found); $i < $count; ++$i) {
            $a = $found[$i - 1];
            $b = $found[$i];
            $gapEnd = $b['minus'] >= 0 ? min($b['numStart'], $b['token']['start'] ?? PHP_INT_MAX) : $b['start'];
            $gap = Text::slice($text, $a['end'], $gapEnd);
            $tight = preg_match('/^[-~]\z/u', $gap) === 1;
            $spaced = preg_match('/^ *[-~] *\z/u', $gap) === 1;
            $even = preg_match('/^ +[-~] +\z/u', $gap) === 1;
            if (!((($tight || $even) && ($a['token'] !== null || $b['token'] !== null)) || ($spaced && $a['token'] !== null && !$a['token']['weak']))) {
                continue;
            }
            if ($b['minus'] >= 0) {
                $found[$i]['start'] = min($b['numStart'], $b['token']['start'] ?? PHP_INT_MAX);
                $found[$i]['minus'] = -1;
            }
            $found[$i - 1]['range'] = 'from';
            $found[$i]['range'] = 'to';
            if (($a['token']['weak'] ?? false) && $b['token'] !== null && !$b['token']['weak'] && $a['token']['start'] < $a['numStart']) {
                $a['token'] = $found[$i - 1]['token'] = null;
                $found[$i - 1]['start'] = $a['minus'] >= 0 ? min($a['minus'], $a['numStart']) : $a['numStart'];
            }
            if ($a['token'] === null && $b['token'] !== null) {
                $found[$i - 1]['token'] = $b['token'];
            } elseif ($a['token'] !== null && $b['token'] === null) {
                $found[$i]['token'] = $a['token'];
            }
        }
        return $found;
    }
}
