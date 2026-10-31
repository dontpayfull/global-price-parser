<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Parse
{
    public static function readPrices(string $text, array $evidence, ?string $struck = null): array
    {
        $normalized = Normalize::normalize($text);
        $map = $normalized['map'];
        $out = [];
        foreach (Scan::scan($normalized['text'], $evidence['languages']) as $f) {
            $res = Resolve::resolveCurrency($f['token'], $evidence);
            $rejected = $res['rejectedToken'];
            if ($rejected) {
                $res = Resolve::resolveCurrency(null, $evidence);
            }
            $token = $rejected ? null : $f['token'];
            $reading = Number::parseNumber($f['number'], [
                'currencyKnown' => $res['currency'] !== null,
                'threeDecimals' => $res['currency'] !== null && $res['sure'] && Currency::decimalsOf($res['currency']) === 3,
            ]);
            if ($reading === null) {
                continue;
            }
            if ($res['decidedBy'] === 'default' && $res['currency'] !== null && preg_match('/[1-9]/u', $reading['fraction'])
                && strlen($reading['fraction']) > Currency::decimalsOf($res['currency'])) {
                foreach ($res['others'] as $fit) {
                    if (Currency::decimalsOf($fit) >= strlen($reading['fraction'])) {
                        $res['others'] = array_merge([$res['currency']], array_values(array_filter($res['others'], static fn (string $c): bool => $c !== $fit)));
                        $res['currency'] = $fit;
                        break;
                    }
                }
            }
            $negative = $f['minus'] >= 0;
            $decimals = $res['currency'] !== null ? Currency::decimalsOf($res['currency']) : 2;
            $amount = Number::formatAmount($reading['integer'], $reading['fraction'], $decimals, $negative);
            $start = $map->at($rejected ? min($f['numStart'], $negative ? $f['minus'] : PHP_INT_MAX) : $f['start']);
            $end = $map->at($rejected && $f['per'] === null ? $f['numEnd'] : $f['end']);
            $alt = $reading['ambiguous'];
            $ambiguous = $alt !== null ? [
                'reason' => $alt['reason'],
                'alternative' => ($negative ? '-' : '') . $alt['integer'] . ($alt['fraction'] !== '' ? '.' . $alt['fraction'] : ''),
            ] : null;
            $out[] = [
                'hasCurrency' => $token !== null,
                'price' => new Price(
                    amount: $amount,
                    value: (float) $amount,
                    currency: $res['currency'],
                    currencySure: $res['sure'],
                    otherCurrencies: $res['others'],
                    decidedBy: $res['decidedBy'],
                    conflicts: $res['conflicts'],
                    symbol: $token !== null ? Text::slice($text, $map->at($token['start']), $map->at($token['end'])) : null,
                    negative: $negative && preg_match('/[1-9]/u', $amount) === 1,
                    ambiguous: $ambiguous,
                    struck: $struck !== null && ($struck[$map->at($f['numStart'])] ?? "\0") === "\1",
                    per: $f['per'],
                    range: $f['range'],
                    raw: str_replace(Normalize::DECIMAL_MARK, '.', Text::slice($text, $start, $end)),
                    index: $start,
                ),
            ];
        }
        return $out;
    }
}
