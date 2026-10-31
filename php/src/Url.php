<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** URL components used by page evidence, with relative href resolution. */
final class Url
{
    private const SPECIAL = ['http', 'https', 'ftp', 'ws', 'wss'];

    /** Backslashes are separators only in a special URL's authority and path. */
    private static function slashPath(string $href): string
    {
        $end = strcspn($href, '?#');
        return str_replace('\\', '/', substr($href, 0, $end)) . substr($href, $end);
    }

    public static function parse(string $href, ?string $base = null): ?array
    {
        $href = preg_replace('/[\t\n\r]/u', '', trim($href, "\x00..\x20"));
        $parent = $base !== null ? self::parse($base) : null;
        $scheme = preg_match('/^([a-z][a-z0-9+.-]*):/iu', $href, $match) ? strtolower($match[1]) : null;
        if (in_array($scheme ?? ($parent['scheme'] ?? null), self::SPECIAL, true)) {
            $href = self::slashPath($href);
        }
        if ($scheme !== null && in_array($scheme, self::SPECIAL, true)) {
            $rest = substr($href, strlen($scheme) + 1);
            if (($parent['scheme'] ?? null) === $scheme && !str_starts_with($rest, '//')) {
                // A same-scheme URL without an authority resolves against its base.
                $href = $rest;
                $scheme = null;
            } else {
                $href = $scheme . '://' . ltrim($rest, '/');
            }
        }
        if ($scheme === null) {
            if ($parent === null) {
                return null;
            }
            $authority = $parent['scheme'] . '://' . $parent['authority'];
            if (str_starts_with($href, '//')) {
                $href = in_array($parent['scheme'], self::SPECIAL, true)
                    ? $parent['scheme'] . '://' . ltrim($href, '/') : $parent['scheme'] . ':' . $href;
            } elseif (str_starts_with($href, '/')) {
                $href = $authority . $href;
            } elseif (str_starts_with($href, '?')) {
                $href = $authority . $parent['path'] . $href;
            } elseif (str_starts_with($href, '#') || $href === '') {
                $href = $authority . $parent['path'] . ($parent['query'] !== '' ? '?' . $parent['query'] : '') . $href;
            } else {
                $slash = strrpos($parent['path'], '/');
                $href = $authority . substr($parent['path'], 0, $slash === false ? 0 : $slash + 1) . $href;
            }
        }
        // Escape before parse_url, which otherwise replaces controls and some UTF-8 bytes.
        $href = preg_replace_callback('/[\x00-\x20\x7F-\xFF]/', static fn (array $m): string => rawurlencode($m[0]), $href);
        try {
            $parts = parse_url($href);
        } catch (\ValueError) {
            return null;
        }
        if ($parts === false || !isset($parts['scheme'])) {
            return null;
        }
        $scheme = strtolower($parts['scheme']);
        $host = Text::lower(rawurldecode($parts['host'] ?? ''));
        if (function_exists('idn_to_ascii') && $host !== '' && $host[0] !== '[') {
            $ascii = idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if ($ascii !== false) {
                $host = strtolower($ascii);
            }
        }
        if (in_array($scheme, self::SPECIAL, true)
            && ($host === '' || preg_match('~[\x00-\x20\x7F%#/?@<>"{}|\\\\^`]~u', $host)
                || ($host[0] !== '[' && strpbrk($host, ':[]') !== false))) {
            return null;
        }
        $path = preg_replace_callback('~["<>`{}]~', static fn (array $m): string => rawurlencode($m[0]), $parts['path'] ?? ($host !== '' ? '/' : ''));
        $queryPattern = in_array($scheme, self::SPECIAL, true) ? '~["<>\x27]~' : '~["<>]~';
        $query = preg_replace_callback($queryPattern, static fn (array $m): string => rawurlencode($m[0]), $parts['query'] ?? '');
        if ($host !== '') {
            $segments = explode('/', $path);
            $normalized = [];
            foreach ($segments as $i => $segment) {
                $dot = strtolower(str_replace('%2e', '.', strtolower($segment)));
                if ($dot === '.') {
                    if ($i === count($segments) - 1) {
                        $normalized[] = '';
                    }
                    continue;
                }
                if ($dot === '..') {
                    if (count($normalized) > 1) {
                        array_pop($normalized);
                    }
                    if ($i === count($segments) - 1) {
                        $normalized[] = '';
                    }
                    continue;
                }
                $normalized[] = $segment;
            }
            $path = implode('/', $normalized);
            $path = $path === '' ? '/' : $path;
        }
        $authority = $host . (isset($parts['port']) ? ':' . $parts['port'] : '');
        return ['scheme' => $scheme, 'host' => $host, 'path' => $path, 'query' => $query, 'authority' => $authority];
    }

    public static function queryValue(string $query, string $key): ?string
    {
        foreach (explode('&', $query) as $entry) {
            [$name, $value] = array_pad(explode('=', $entry, 2), 2, '');
            if (urldecode($name) === $key) {
                return urldecode($value);
            }
        }
        return null;
    }
}
