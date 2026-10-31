<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Evidence
{
    /** Small BCP 47 reader: language, optional script and optional region. */
    private static function tag(string $tag): ?array
    {
        $tag = str_replace('_', '-', $tag);
        if (!preg_match('/^([a-z]{2,3}|[a-z]{5,8})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?((?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*)((?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*)(?:-x(?:-[a-z0-9]{1,8})+)?\z/i', $tag, $m, PREG_UNMATCHED_AS_NULL)) {
            return null;
        }
        $variants = array_filter(explode('-', strtolower($m[4] ?? '')));
        if (count($variants) !== count(array_unique($variants))) {
            return null;
        }
        preg_match_all('/-([0-9a-wy-z])(?=-)/i', $m[5] ?? '', $extensions);
        $singletons = array_map('strtolower', $extensions[1]);
        if (count($singletons) !== count(array_unique($singletons))) {
            return null;
        }
        $locales = Data::load('locales');
        $language = Text::lower($m[1]);
        $script = isset($m[2]) ? ucfirst(Text::lower($m[2])) : null;
        $region = isset($m[3]) ? Text::upper($m[3]) : null;
        $alias = explode('-', $locales['languageAliases'][$language] ?? $language);
        $language = $alias[0];
        foreach (array_slice($alias, 1) as $part) {
            if (preg_match('/^[A-Za-z]{4}\z/u', $part)) {
                $script ??= ucfirst(Text::lower($part));
            } elseif (preg_match('/^(?:[A-Za-z]{2}|[0-9]{3})\z/u', $part)) {
                $region ??= Text::upper($part);
            }
        }
        if ($region !== null) {
            $region = $locales['numericRegions'][$region] ?? $region;
            $region = $locales['regionAliases'][$region] ?? $region;
        }
        return ['language' => $language, 'script' => $script, 'region' => $region];
    }

    public static function regionOfTag(string $tag): ?string
    {
        $region = self::tag($tag)['region'] ?? null;
        return $region !== null && preg_match('/^[A-Z]{2}\z/u', $region) && Currency::isRegion($region) ? $region : null;
    }

    public static function likelyRegion(string $tag): ?string
    {
        $parsed = self::tag($tag);
        if ($parsed === null) {
            return null;
        }
        $regions = Data::load('locales')['likelyRegion'];
        $scriptKey = $parsed['language'] . '-' . ($parsed['script'] ?? '');
        $region = $parsed['region'] ?? $regions[$scriptKey] ?? $regions[$parsed['language']] ?? null;
        return $region !== null && Currency::isRegion($region) ? $region : null;
    }

    public static function buildEvidence(array $options, ?PageSignals $page): array
    {
        $entries = [];
        $currency = isset($options['currency']) ? Text::upper($options['currency']) : null;
        if ($currency !== null && Currency::isCurrencyCode($currency)) {
            $entries[] = new Signal('hint.currency', $currency);
        }
        $country = isset($options['country']) ? Text::upper($options['country']) : null;
        if ($country !== null && Currency::isRegion($country)) {
            $entries[] = new Signal('hint.country', country: $country === 'UK' ? 'GB' : $country);
        }
        $langRegion = isset($options['language']) && $options['language'] !== '' ? self::regionOfTag($options['language']) : null;
        if ($langRegion !== null) {
            $entries[] = new Signal('hint.language', country: $langRegion);
        }
        if ($page !== null) {
            array_push($entries, ...$page->currency, ...$page->country);
        }
        if (isset($options['language']) && $options['language'] !== '' && $langRegion === null) {
            $likely = self::likelyRegion($options['language']);
            if ($likely !== null) {
                $entries[] = new Signal('hint.language', country: $likely, likely: true);
            }
        }
        return ['entries' => $entries, 'languages' => self::languagesOf($options, $page, $entries)];
    }

    private static function languagesOf(array $options, ?PageSignals $page, array $entries): array
    {
        $out = [];
        $tag = $options['language'] ?? $page?->language;
        if ($tag !== null && $tag !== '') {
            $parsed = self::tag($tag);
            if ($parsed !== null) {
                $out[$parsed['language']] = true;
            }
        }
        foreach ($entries as $entry) {
            if ($entry->country !== null) {
                $language = Data::load('locales')['regionLanguage'][$entry->country] ?? null;
                if ($language !== null) {
                    $out[$language] = true;
                }
                break;
            }
        }
        return array_keys($out);
    }
}
