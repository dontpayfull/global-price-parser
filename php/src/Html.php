<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Html
{
    private const SKIP = ['script', 'style', 'noscript', 'template', 'head', 'title', 'svg', 'iframe', 'object', 'textarea', 'select'];
    private const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'];
    private const BLOCK = ['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'button', 'label'];
    private const ENTITIES = [
        'nbsp' => "\u{00A0}", 'amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'",
        'euro' => '€', 'pound' => '£', 'yen' => '¥', 'cent' => '¢', 'dollar' => '$', 'curren' => '¤',
        'thinsp' => "\u{2009}", 'ensp' => "\u{2002}", 'emsp' => "\u{2003}", 'minus' => "\u{2212}",
        'ndash' => "\u{2013}", 'mdash' => "\u{2014}", 'rsquo' => "\u{2019}", 'lsquo' => "\u{2018}",
        'sup2' => '²', 'sup3' => '³', 'middot' => '·',
    ];

    public static function decodeEntities(string $s): string
    {
        return preg_replace_callback('/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]*);/iu', static function (array $m): string {
            $body = $m[1];
            if ($body[0] === '#') {
                $cp = $body[1] === 'x' || $body[1] === 'X' ? intval(substr($body, 2), 16) : intval(substr($body, 1), 10);
                return $cp > 0 && $cp <= 0x10FFFF && ($cp < 0xD800 || $cp > 0xDFFF) ? mb_chr($cp, 'UTF-8') : $m[0];
            }
            return self::ENTITIES[Text::lower($body)] ?? $m[0];
        }, $s);
    }

    public static function parseAttributes(string $src): array
    {
        $attrs = [];
        $re = <<<'REGEX'
~([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?~u
REGEX;
        preg_match_all($re, $src, $matches, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
        foreach ($matches as $m) {
            $attrs[Text::lower($m[1])] = self::decodeEntities($m[2] ?? $m[3] ?? $m[4] ?? '');
        }
        return $attrs;
    }

    private static function isHidden(array $attrs): bool
    {
        $screenReader = '/(?:^|\s)(?:sr-only|sr-text|[\w-]*__sr-text|screen-reader-text|screenreader-only|visually-?hidden|visuallyhidden|a-offscreen|aok-offscreen|offscreen|u-visually-hidden)(?:\s|$)/iu';
        if (array_key_exists('hidden', $attrs) || preg_match($screenReader, $attrs['class'] ?? '')) {
            return true;
        }
        return preg_match('/display\s*:\s*none|visibility\s*:\s*hidden/u', Text::lower($attrs['style'] ?? '')) === 1;
    }

    private static function isStruckStyle(array $attrs): bool
    {
        return preg_match('/text-decoration(?:-line)?\s*:[^;]*line-through/iu', $attrs['style'] ?? '') === 1;
    }

    public static function extractHtml(string $html, bool $keepHidden = false): array
    {
        $w = new HtmlWriter();
        $stack = [['tag' => '#root', 'hidden' => false, 'struck' => false, 'raised' => null, 'apart' => false]];
        // Counts let stray closing tags cost O(1), without scanning the stack.
        $open = [];
        $pop = static function (bool $atEnd) use (&$stack, &$open, $w): void {
            $f = array_pop($stack);
            --$open[$f['tag']];
            if ($f['raised'] !== null && !$f['hidden'] && $stack[count($stack) - 1]['raised'] === null) {
                $w->raised($f['raised']->buf, $f['struck']);
            }
            if ($atEnd) {
                return;
            }
            if (in_array($f['tag'], self::BLOCK, true) && !$f['hidden']) {
                $w->block();
            } elseif ($f['apart']) {
                $w->space($f['struck']);
            }
        };
        foreach (Markup::tokenize($html) as $t) {
            $cur = $stack[count($stack) - 1];
            if ($t['type'] === 'text') {
                if ($cur['hidden']) {
                    continue;
                }
                if ($cur['raised'] !== null) {
                    $cur['raised']->buf .= self::decodeEntities($t['text']);
                } else {
                    $w->addText($t['text'], $cur['struck']);
                }
                continue;
            }
            if ($t['type'] === 'raw') {
                continue;
            }
            $tag = $t['name'];
            if ($t['type'] === 'close') {
                if (empty($open[$tag])) {
                    continue;
                }
                while ($stack[count($stack) - 1]['tag'] !== $tag) {
                    $pop(false);
                }
                $pop(false);
                continue;
            }
            if (in_array($tag, Markup::RAW_TEXT, true)) {
                continue;
            }
            $attrs = self::parseAttributes($t['attrs']);
            if (in_array($tag, self::BLOCK, true) && !$cur['hidden']) {
                $w->block();
            }
            if (in_array($tag, self::VOID, true) || $t['selfClosing']) {
                continue;
            }
            $skip = in_array($tag, self::SKIP, true);
            $apart = $keepHidden && !$skip && !$cur['hidden'] && self::isHidden($attrs);
            if ($apart) {
                $w->space($cur['struck']);
            }
            $open[$tag] = ($open[$tag] ?? 0) + 1;
            $stack[] = [
                'tag' => $tag,
                'apart' => $apart,
                'hidden' => $cur['hidden'] || $skip || (!$keepHidden && self::isHidden($attrs)),
                'struck' => $cur['struck'] || in_array($tag, ['del', 's', 'strike'], true) || self::isStruckStyle($attrs),
                // Nested raised elements share one buffer, with no copies on pop.
                'raised' => $cur['raised'] ?? (in_array($tag, ['sup', 'sub'], true) ? (object) ['buf' => ''] : null),
            ];
        }
        while (count($stack) > 1) {
            $pop(true);
        }
        return ['text' => $w->text(), 'struck' => $w->struck];
    }
}
