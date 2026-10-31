<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class PriceParser
{
    private static function looksLikeHtml(string $s): bool
    {
        return preg_match('/<\/?[a-z][^<>]*>/iu', $s) === 1;
    }

    private static function cleanOptions(array $options): array
    {
        foreach (['currency', 'country', 'language', 'url', 'page'] as $key) {
            if (isset($options[$key])) {
                if (!is_string($options[$key])) {
                    throw new \TypeError('Option ' . $key . ' must be a string.');
                }
                $options[$key] = Text::scrub($options[$key]);
            }
        }
        if (isset($options['html']) && !is_bool($options['html'])) {
            throw new \TypeError('Option html must be a boolean.');
        }
        return $options;
    }

    private static function prepare(string $input, array $options): array
    {
        $html = $options['html'] ?? self::looksLikeHtml($input);
        $extracted = $html ? Html::extractHtml($input) : ['text' => str_replace(Normalize::DECIMAL_MARK, '', $input), 'struck' => ''];
        $page = $options['page'] ?? ($html ? $input : null);
        $signals = $page !== null ? Signals::readPageSignals($page, ['url' => $options['url'] ?? null])
            : (isset($options['url']) && $options['url'] !== '' ? Signals::readPageSignals('', ['url' => $options['url']]) : null);
        return ['extracted' => $extracted, 'signals' => $signals];
    }

    private static function candidates(string $input, array $options): array
    {
        $prepared = self::prepare($input, $options);
        $extracted = $prepared['extracted'];
        $evidence = Evidence::buildEvidence($options, $prepared['signals']);
        $found = Parse::readPrices($extracted['text'], $evidence, $extracted['struck']);
        foreach ($found as $candidate) {
            if ($candidate['hasCurrency']) {
                return $found;
            }
        }
        if (!($options['html'] ?? self::looksLikeHtml($input))) {
            return $found;
        }
        $all = Html::extractHtml($input, true);
        $hidden = Parse::readPrices($all['text'], $evidence, $all['struck']);
        foreach ($hidden as $candidate) {
            if ($candidate['hasCurrency']) {
                return $hidden;
            }
        }
        return $found;
    }

    public static function parsePrice(string $input, array $options = []): ?Price
    {
        try {
            $all = self::candidates(Text::scrub($input), self::cleanOptions($options));
            $priced = array_values(array_filter($all, static fn (array $c): bool => $c['hasCurrency']));
            foreach ($priced as $candidate) {
                if (!$candidate['price']->struck) {
                    return $candidate['price'];
                }
            }
            return $priced[0]['price'] ?? (count($all) === 1 ? $all[0]['price'] : null);
        } finally {
            Text::clear();
        }
    }

    /** @return list<Price> */
    public static function parsePrices(string $input, array $options = []): array
    {
        try {
            return array_values(array_map(
                static fn (array $c): Price => $c['price'],
                array_filter(self::candidates(Text::scrub($input), self::cleanOptions($options)), static fn (array $c): bool => $c['hasCurrency']),
            ));
        } finally {
            Text::clear();
        }
    }

    public static function readPageSignals(string $page, array $options = []): PageSignals
    {
        try {
            return Signals::readPageSignals(Text::scrub($page), self::cleanOptions($options));
        } finally {
            Text::clear();
        }
    }
}
