<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

final class Resolve
{
    private static function currenciesOf(Signal $signal): array
    {
        if ($signal->currency !== null) {
            return [$signal->currency];
        }
        return $signal->country !== null ? Currency::currenciesOfRegion($signal->country) : [];
    }

    public static function resolveCurrency(?array $token, array $evidence): array
    {
        $candidates = $token['candidates'] ?? null;
        if ($token !== null && !$token['weak'] && count($candidates) === 1) {
            return ['currency' => $candidates[0], 'sure' => true, 'others' => [], 'decidedBy' => 'symbol', 'conflicts' => [], 'rejectedToken' => false];
        }
        $conflicts = [];
        $entries = $evidence['entries'];
        $fitOf = static function (Signal $signal) use ($candidates): array {
            $options = self::currenciesOf($signal);
            return $candidates !== null ? array_values(array_intersect($options, $candidates)) : $options;
        };
        foreach ($entries as $i => $signal) {
            $fit = $fitOf($signal);
            if ($fit) {
                for ($j = $i + 1, $n = count($entries); $j < $n; ++$j) {
                    if ($entries[$j]->source !== $signal->source) {
                        continue;
                    }
                    foreach ($fitOf($entries[$j]) as $code) {
                        if (!in_array($code, $fit, true)) {
                            $fit[] = $code;
                        }
                    }
                }
                return [
                    'currency' => $fit[0], 'sure' => count($fit) === 1 && !$signal->likely, 'others' => array_slice($fit, 1),
                    'decidedBy' => $signal->source, 'conflicts' => $conflicts, 'rejectedToken' => false,
                ];
            }
            $options = self::currenciesOf($signal);
            if ($candidates !== null && $options) {
                $conflicts[] = $signal->source . ':' . ($signal->currency ?? $signal->country);
            }
        }
        if ($token === null || $token['weak']) {
            return [
                'currency' => null, 'sure' => false, 'others' => [], 'decidedBy' => 'none',
                'conflicts' => $conflicts, 'rejectedToken' => $token !== null,
            ];
        }
        return [
            'currency' => $candidates[0], 'sure' => false, 'others' => array_slice($candidates, 1),
            'decidedBy' => 'default', 'conflicts' => $conflicts, 'rejectedToken' => false,
        ];
    }
}
