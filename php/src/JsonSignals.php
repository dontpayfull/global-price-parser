<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Iterative JSON validation avoids decoder depth limits and ignores nodes below depth 20. */
final class JsonSignals
{
    private const TOKEN = <<<'REGEX'
~\G(?:"(?:[^"\\\x00-\x1F]++|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*+"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\[\]:,])~A
REGEX;

    private static function stringValue(string $literal): string
    {
        return json_decode(Text::scrubJsonSurrogates($literal), true, 512, JSON_THROW_ON_ERROR);
    }

    private static function attach(array &$stack, array $found): void
    {
        $at = count($stack) - 1;
        if ($at < 0 || $at > 20) {
            return;
        }
        if ($stack[$at]['type'] === 'object') {
            // A repeated property replaces its value without changing its insertion position.
            $stack[$at]['entries'][$stack[$at]['key']] = $found;
        } elseif ($found) {
            $stack[$at]['entries'][] = $found;
        }
    }

    private static function flatten(array $frame): array
    {
        $entries = $frame['entries'];
        if ($frame['type'] === 'object') {
            $integerKeys = [];
            foreach ($entries as $key => $value) {
                if (is_int($key) && $key >= 0 && $key < 4294967295) {
                    $integerKeys[$key] = $value;
                    unset($entries[$key]);
                }
            }
            ksort($integerKeys, SORT_NUMERIC);
            $entries = $integerKeys + $entries;
        }
        $out = [];
        foreach ($entries as $found) {
            array_push($out, ...$found);
        }
        return $out;
    }

    private static function collect(string $block): ?array
    {
        $stack = [];
        $root = 'value';
        $rootFound = [];
        $offset = 0;
        $n = strlen($block);
        while ($offset < $n) {
            $offset += strspn($block, " \t\r\n", $offset);
            if ($offset === $n) {
                break;
            }
            if (!preg_match(self::TOKEN, $block, $m, 0, $offset)) {
                return null;
            }
            $token = $m[0];
            $offset += strlen($token);
            $at = count($stack) - 1;
            $state = $at < 0 ? $root : $stack[$at]['state'];
            $type = $at < 0 ? null : $stack[$at]['type'];
            if (($token === '}' && $type === 'object' && in_array($state, ['keyOrEnd', 'commaOrEnd'], true))
                || ($token === ']' && $type === 'array' && in_array($state, ['valueOrEnd', 'commaOrEnd'], true))) {
                $frame = array_pop($stack);
                $found = self::flatten($frame);
                if (!$stack) {
                    $rootFound = $found;
                } else {
                    self::attach($stack, $found);
                }
            } elseif ($token === ':' && $type === 'object' && $state === 'colon') {
                $stack[$at]['state'] = 'value';
            } elseif ($token === ',' && $state === 'commaOrEnd') {
                $stack[$at]['state'] = $type === 'object' ? 'key' : 'value';
            } elseif ($token[0] === '"' && $type === 'object' && in_array($state, ['key', 'keyOrEnd'], true)) {
                $stack[$at]['key'] = $at <= 20 ? self::stringValue($token) : null;
                $stack[$at]['state'] = 'colon';
            } elseif (in_array($state, ['value', 'valueOrEnd'], true) && !in_array($token, ['}', ']', ':', ','], true)) {
                if ($at < 0) {
                    $root = 'done';
                } else {
                    $stack[$at]['state'] = 'commaOrEnd';
                }
                if ($token === '{' || $token === '[') {
                    $stack[] = ['type' => $token === '{' ? 'object' : 'array', 'state' => $token === '{' ? 'keyOrEnd' : 'valueOrEnd', 'key' => null, 'entries' => []];
                } else {
                    $found = $token[0] === '"' && $type === 'object' && $at <= 20 && Text::lower($stack[$at]['key']) === 'pricecurrency'
                        ? [Text::upper(Text::trim(self::stringValue($token)))] : [];
                    self::attach($stack, $found);
                }
            } else {
                return null;
            }
        }
        return $root === 'done' && !$stack ? $rootFound : null;
    }

    public static function currencies(string $block): array
    {
        $found = self::collect($block);
        if ($found !== null) {
            return $found;
        }
        preg_match_all('/"priceCurrency"\s*:\s*"([A-Za-z]{3})"/iu', $block, $matches);
        return array_map([Text::class, 'upper'], $matches[1]);
    }
}
