<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** One-pass page reader: comments, raw markup and nested templates remain inert. */
final class PageSource
{
    public static function fromHtml(string $page): array
    {
        $src = ['html' => null, 'body' => null, 'metas' => [], 'links' => [], 'jsonLd' => [],
            'scripts' => [], 'microdataCurrency' => [], 'url' => null];
        $inert = 0;
        $scriptType = '';
        $microdata = false;
        foreach (Markup::tokenize($page) as $t) {
            if ($t['type'] !== 'text' && $t['name'] === 'template') {
                $inert = $t['type'] === 'open' ? $inert + 1 : max(0, $inert - 1);
                continue;
            }
            if ($inert) {
                continue;
            }
            if ($t['type'] === 'text') {
                if ($microdata) {
                    $src['microdataCurrency'][] = Text::trim(Html::decodeEntities($t['text']));
                }
                $microdata = false;
                continue;
            }
            $microdata = false;
            if ($t['type'] === 'raw') {
                if ($t['name'] !== 'script') {
                    continue;
                }
                if ($scriptType === 'application/ld+json') {
                    $src['jsonLd'][] = $t['text'];
                } elseif ($scriptType === '' || str_contains($scriptType, 'javascript') || $scriptType === 'module') {
                    $src['scripts'][] = $t['text'];
                }
                continue;
            }
            if ($t['type'] !== 'open' || (!in_array($t['name'], ['html', 'body', 'meta', 'link', 'script'], true)
                && stripos($t['attrs'], 'itemprop') === false)) {
                continue;
            }
            $attrs = Html::parseAttributes($t['attrs']);
            if ($t['name'] === 'html') {
                $src['html'] ??= $attrs;
            } elseif ($t['name'] === 'body') {
                $src['body'] ??= $attrs;
            } elseif ($t['name'] === 'meta') {
                $src['metas'][] = $attrs;
            } elseif ($t['name'] === 'link') {
                $src['links'][] = $attrs;
            } elseif ($t['name'] === 'script') {
                $scriptType = Text::lower(Text::trim($attrs['type'] ?? ''));
            }
            if (Text::lower($attrs['itemprop'] ?? '') === 'pricecurrency') {
                if (array_key_exists('content', $attrs)) {
                    $src['microdataCurrency'][] = Text::trim($attrs['content']);
                } else {
                    $microdata = true;
                }
            }
        }
        return $src;
    }
}
