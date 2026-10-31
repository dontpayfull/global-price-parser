<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Signals
{
    private const GENERIC_TLDS = ['ac', 'ad', 'ag', 'ai', 'am', 'as', 'bz', 'cc', 'cd', 'ck', 'co', 'cx', 'dj', 'fm', 'gg', 'gl', 'gs', 'im', 'io', 'ki', 'la', 'ly', 'me', 'ms', 'nf', 'nr', 'nu', 'pw', 'sc', 'sh', 'sr', 'st', 'su', 'tk', 'to', 'tv', 'vc', 'ws'];
    private const SITE_LANGUAGES = ['ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
    private const PATH_WORDS = ['am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'id', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we'];
    private static ?array $languages = null;

    private static function isLanguage(string $code): bool
    {
        self::$languages ??= array_fill_keys(Data::load('locales')['languages'], true);
        return isset(self::$languages[Text::lower($code)]);
    }

    private static function urlKey(string $href, ?string $base = null, bool $withQuery = true): ?string
    {
        $u = Url::parse($href, $base);
        if ($u === null || !in_array($u['scheme'], ['http', 'https'], true)) {
            return null;
        }
        $path = rtrim($u['path'], '/');
        return preg_replace('/^www\./u', '', Text::lower($u['host'])) . ($path === '' ? '/' : $path)
            . ($withQuery && $u['query'] !== '' ? '?' . $u['query'] : '');
    }

    private static function pathRegion(string $a, string $b): ?string
    {
        if (in_array($a, self::PATH_WORDS, true) && in_array($b, self::PATH_WORDS, true)) {
            return null;
        }
        $langFirst = self::isLanguage($a) && Currency::isRegion($b);
        $regionFirst = Currency::isRegion($a) && self::isLanguage($b);
        if ($langFirst && $regionFirst) {
            return Text::upper(in_array($b, self::SITE_LANGUAGES, true) && !in_array($a, self::SITE_LANGUAGES, true) ? $a : $b);
        }
        return $langFirst ? Text::upper($b) : ($regionFirst ? Text::upper($a) : null);
    }

    public static function urlSignals(string $url): array
    {
        $currency = [];
        $country = [];
        $u = Url::parse($url);
        if ($u === null || !in_array($u['scheme'], ['http', 'https'], true)) {
            return compact('currency', 'country');
        }
        $cur = Text::upper(Url::queryValue($u['query'], 'currency') ?? '');
        if (Currency::isCurrencyCode($cur)) {
            $currency[] = new Signal('url.query', $cur);
        }
        $ctry = Text::upper(Url::queryValue($u['query'], 'country') ?? '');
        if (preg_match('/^[A-Z]{2}\z/', $ctry) && Currency::isRegion($ctry)) {
            $country[] = new Signal('url.query', country: $ctry);
        }
        $segs = array_slice(array_values(array_filter(explode('/', $u['path']), static fn (string $s): bool => $s !== '')), 0, 2);
        $region = null;
        if (preg_match('/^([a-z]{2})[-_]([a-z]{2})\z/i', $segs[0] ?? '', $pair)
            && self::isLanguage($pair[1]) && Currency::isRegion($pair[2])) {
            $region = Text::upper($pair[2]);
        } elseif (count($segs) === 2 && preg_match('/^[a-z]{2}\z/i', $segs[0]) && preg_match('/^[a-z]{2}\z/i', $segs[1])) {
            $region = self::pathRegion(Text::lower($segs[0]), Text::lower($segs[1]));
        }
        if ($region !== null) {
            $country[] = new Signal('url.path', country: $region === 'UK' ? 'GB' : $region);
        }
        $labels = explode('.', Text::lower($u['host']));
        $tld = $labels[count($labels) - 1];
        if (preg_match('/^[a-z]{2}\z/', $tld) && !in_array($tld, self::GENERIC_TLDS, true) && Currency::isRegion($tld)) {
            $country[] = new Signal('url.tld', country: $tld === 'uk' ? 'GB' : Text::upper($tld));
        }
        return compact('currency', 'country');
    }

    private static function hasRel(array $link, string $rel): bool
    {
        return in_array($rel, preg_split('/\s+/u', Text::lower($link['rel'] ?? '')), true);
    }

    private static function hreflangs(array $links, ?string $pageUrl, ?string $canonical): array
    {
        $alternates = array_values(array_filter($links, static fn (array $l): bool => self::hasRel($l, 'alternate')
            && isset($l['hreflang']) && $l['hreflang'] !== '' && $l['hreflang'] !== 'x-default'));
        $matches = [];
        foreach ([true, false] as $withQuery) {
            $keys = [
                $pageUrl !== null && $pageUrl !== '' ? self::urlKey($pageUrl, null, $withQuery) : null,
                $canonical !== null && $canonical !== '' ? self::urlKey($canonical, $pageUrl, $withQuery) : null,
            ];
            foreach ($keys as $key) {
                $matches = $key === null || $key === '' ? [] : array_values(array_filter($alternates,
                    static fn (array $l): bool => self::urlKey($l['href'] ?? '', $pageUrl, $withQuery) === $key));
                if ($matches) {
                    $regions = array_unique(array_map(static fn (array $l): ?string => Evidence::regionOfTag($l['hreflang']), $matches), SORT_REGULAR);
                    return count($regions) === 1 ? $matches : [];
                }
            }
        }
        return [];
    }

    public static function readPageSignals(string $page, array $options = []): PageSignals
    {
        $src = PageSource::fromHtml($page);
        $currency = [];
        $country = [];
        $addCurrency = static function (string $source, ?string $code) use (&$currency): void {
            $c = Text::upper(Text::trim($code ?? ''));
            if (!Currency::isCurrencyCode($c)) {
                return;
            }
            foreach ($currency as $signal) {
                if ($signal->source === $source && $signal->currency === $c) {
                    return;
                }
            }
            $currency[] = new Signal($source, $c);
        };
        $scripts = implode("\n;\n", $src['scripts']);
        foreach (ScriptSignals::PLATFORM as $rule) {
            $addCurrency('page.platform:' . $rule[0], ScriptSignals::find($rule, $scripts));
        }
        $paypal = null;
        foreach ($src['metas'] as $meta) {
            if (($meta['id'] ?? null) === 'in-context-paypal-metadata') {
                $paypal = $meta;
                break;
            }
        }
        $addCurrency('page.platform:shopify', $paypal['data-currency'] ?? null);
        $addCurrency('page.platform:shopware', $src['html']['data-currency-iso'] ?? $src['body']['data-currency-iso'] ?? null);
        foreach (ScriptSignals::TRACKING as $rule) {
            $addCurrency('page.tracking:' . $rule[0], ScriptSignals::find($rule, $scripts));
        }
        foreach ($src['jsonLd'] as $block) {
            foreach (JsonSignals::currencies($block) as $code) {
                $addCurrency('page.jsonld', $code);
            }
        }
        foreach ($src['microdataCurrency'] as $code) {
            $addCurrency('page.microdata', $code);
        }
        foreach ($src['metas'] as $meta) {
            $prop = Text::lower($meta['property'] ?? $meta['name'] ?? '');
            if ($prop === 'product:price:currency' || $prop === 'og:price:currency') {
                $addCurrency('page.meta', $meta['content'] ?? null);
            }
        }
        $url = $options['url'] ?? $src['url'];
        $canonical = null;
        foreach ($src['links'] as $link) {
            if (self::hasRel($link, 'canonical')) {
                $canonical = $link['href'] ?? null;
                break;
            }
        }
        $pageUrl = $url ?? ($canonical !== null && $canonical !== '' && self::urlKey($canonical) !== null ? $canonical : null);
        $fromUrl = $pageUrl !== null && $pageUrl !== '' ? self::urlSignals($pageUrl) : ['currency' => [], 'country' => []];
        array_push($currency, ...$fromUrl['currency']);
        foreach (ScriptSignals::COUNTRY as $rule) {
            $c = ScriptSignals::find($rule, $scripts);
            if ($c !== null && Currency::isRegion($c)) {
                $country[] = new Signal('page.platform:' . $rule[0], country: $c);
            }
        }
        foreach ($fromUrl['country'] as $signal) {
            if ($signal->source === 'url.query') {
                $country[] = $signal;
            }
        }
        $matches = self::hreflangs($src['links'], $pageUrl, $canonical);
        $hreflangLanguage = $matches[0]['hreflang'] ?? null;
        foreach ($matches as $link) {
            $region = Evidence::regionOfTag($link['hreflang']);
            if ($region !== null) {
                $country[] = new Signal('url.hreflang', country: $region);
                break;
            }
        }
        $lang = $src['html']['lang'] ?? $src['html']['xml:lang'] ?? null;
        $langRegion = $lang !== null && $lang !== '' ? Evidence::regionOfTag($lang) : null;
        if ($langRegion !== null) {
            $country[] = new Signal('page.lang', country: $langRegion);
        }
        foreach ($fromUrl['country'] as $signal) {
            if ($signal->source !== 'url.query') {
                $country[] = $signal;
            }
        }
        return new PageSignals($currency, $country, $lang !== null && $lang !== '' ? $lang : ($hreflangLanguage !== '' ? $hreflangLanguage : null));
    }
}
