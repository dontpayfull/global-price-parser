<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** The CLDR tables are shared by every language port and loaded once per process. */
final class Data
{
    private static array $cache = [];

    public static function load(string $name): array
    {
        if (!in_array($name, ['currencies', 'tokens', 'digits', 'units', 'locales'], true)) {
            throw new \InvalidArgumentException('Unknown data table.');
        }
        if (!isset(self::$cache[$name])) {
            $path = dirname(__DIR__, 2) . '/data/' . $name . '.json';
            $json = file_get_contents($path);
            if ($json === false) {
                throw new \RuntimeException('Cannot read shared price parser data.');
            }
            self::$cache[$name] = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        }
        return self::$cache[$name];
    }
}
