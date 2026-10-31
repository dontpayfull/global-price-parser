<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** One-pass HTML tokenizer: quoted attributes and raw-text bodies are never markup. */
final class Markup
{
    public const RAW_TEXT = ['script', 'style', 'textarea', 'title', 'noscript', 'iframe', 'noembed', 'noframes'];

    private static function isSpace(string $ch): bool
    {
        return $ch !== '' && str_contains(" \n\t\r\f", $ch);
    }

    private static function isLetter(string $ch): bool
    {
        return $ch !== '' && (($ch >= 'a' && $ch <= 'z') || ($ch >= 'A' && $ch <= 'Z'));
    }

    /** A tag just after `<` or `</`, or null when the page ends inside it. */
    private static function readTag(string $html, int $from): ?array
    {
        $q = $from;
        $n = strlen($html);
        while ($q < $n && !self::isSpace($html[$q]) && $html[$q] !== '/' && $html[$q] !== '>') {
            ++$q;
        }
        $name = Text::lower(substr($html, $from, $q - $from));
        $attrsStart = $q;
        while ($q < $n) {
            $ch = $html[$q];
            if ($ch === '>') {
                return ['name' => $name, 'attrs' => substr($html, $attrsStart, $q - $attrsStart),
                    'selfClosing' => $q > $attrsStart && $html[$q - 1] === '/', 'end' => $q + 1];
            }
            ++$q;
            if ($ch !== '=') {
                continue;
            }
            while (self::isSpace($html[$q] ?? '')) {
                ++$q;
            }
            $quote = $html[$q] ?? '';
            if ($quote === '"' || $quote === "'") {
                $close = strpos($html, $quote, $q + 1);
                if ($close === false) {
                    return null;
                }
                $q = $close + 1;
            }
        }
        return null;
    }

    /** A token and its end, a null token for skipped markup, or null for a literal `<`. */
    private static function readAt(string $html, int $lt): ?array
    {
        $n = strlen($html);
        $c = $html[$lt + 1] ?? '';
        if (substr_compare($html, '<!--', $lt, 4) === 0) {
            if (($html[$lt + 4] ?? '') === '>') {
                return ['token' => null, 'end' => $lt + 5];
            }
            if (substr($html, $lt + 4, 2) === '->') {
                return ['token' => null, 'end' => $lt + 6];
            }
            $close = strpos($html, '-->', $lt + 4);
            return ['token' => null, 'end' => $close === false ? $n : $close + 3];
        }
        if ($c === '!' || $c === '?') {
            $gt = strpos($html, '>', $lt + 2);
            return ['token' => null, 'end' => $gt === false ? $n : $gt + 1];
        }
        if ($c === '/') {
            $c2 = $html[$lt + 2] ?? '';
            if ($c2 === '') {
                return null;
            }
            if ($c2 === '>') {
                return ['token' => null, 'end' => $lt + 3];
            }
            if (!self::isLetter($c2)) {
                $gt = strpos($html, '>', $lt + 2);
                return ['token' => null, 'end' => $gt === false ? $n : $gt + 1];
            }
            $tag = self::readTag($html, $lt + 2);
            return $tag === null ? ['token' => null, 'end' => $n]
                : ['token' => ['type' => 'close', 'name' => $tag['name']], 'end' => $tag['end']];
        }
        if (!self::isLetter($c)) {
            return null;
        }
        $tag = self::readTag($html, $lt + 1);
        return $tag === null ? ['token' => null, 'end' => $n] : ['token' => [
            'type' => 'open', 'name' => $tag['name'], 'attrs' => $tag['attrs'], 'selfClosing' => $tag['selfClosing'],
        ], 'end' => $tag['end']];
    }

    /** @return \Generator<int, array> */
    public static function tokenize(string $html): \Generator
    {
        $text = 0;
        $i = 0;
        while (($lt = strpos($html, '<', $i)) !== false) {
            $at = self::readAt($html, $lt);
            if ($at === null) {
                $i = $lt + 1;
                continue;
            }
            if ($lt > $text) {
                yield ['type' => 'text', 'text' => substr($html, $text, $lt - $text)];
            }
            $i = $text = $at['end'];
            $t = $at['token'];
            if ($t === null) {
                continue;
            }
            yield $t;
            if ($t['type'] === 'open' && in_array($t['name'], self::RAW_TEXT, true)) {
                $close = '~</' . $t['name'] . '(?=[\t\n\f\r />])~i';
                $end = preg_match($close, $html, $match, PREG_OFFSET_CAPTURE, $i) ? $match[0][1] : strlen($html);
                yield ['type' => 'raw', 'name' => $t['name'], 'text' => substr($html, $i, $end - $i)];
                $i = $text = $end;
            }
        }
        if ($text < strlen($html)) {
            yield ['type' => 'text', 'text' => substr($html, $text)];
        }
    }
}
