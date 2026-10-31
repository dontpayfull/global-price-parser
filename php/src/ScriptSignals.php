<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Each script search has a bounded window and tries at most twenty anchors. */
final class ScriptSignals
{
    public const PLATFORM = [
        ['shopify', '~Shopify\.currency\s*=\s*\{~u', <<<'REGEX'
~^[^}]{0,500}?["']active["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 600],
        ['bigcommerce', '~BCData\s*=\s*\{~u', <<<'REGEX'
~["'](?:current|active)_currency_code["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 4000],
        ['prestashop', '~prestashop\s*=\s*\{~u', <<<'REGEX'
~["']currency["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 20000],
        ['vtex', '~__RUNTIME__~u', <<<'REGEX'
~["']culture["']\s*:\s*\{[^}]{0,500}?["']currency["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 20000],
        ['magento', '~checkoutConfig~u', <<<'REGEX'
~["']currencyCode["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 20000],
        ['woocommerce', '~woocs_current_currency\s*=\s*\{~u', <<<'REGEX'
~^[^}]{0,500}?["']name["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 600],
        ['woocommerce', '~(?:woo_multi_currency_params|wcml_mc_settings)\s*=\s*\{~u', <<<'REGEX'
~^[^}]{0,500}?["']current_currency["']\s*:\s*["']([A-Z]{3})["']~u
REGEX, 600],
    ];
    public const TRACKING = [
        ['datalayer', '~dataLayer\.push\s*\(\s*\{~u', <<<'REGEX'
~["']?ecommerce["']?\s*:\s*\{[^}]{0,500}?["']?currency(?:Code)?["']?\s*:\s*["']([A-Z]{3})["']~u
REGEX, 2600],
        ['gtag', <<<'REGEX'
~gtag\s*\(\s*["'](?:event|set|config)["']~u
REGEX, <<<'REGEX'
~^[^)]{0,2000}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']~u
REGEX, 2100],
        ['fbq', <<<'REGEX'
~fbq\s*\(\s*["']track["']\s*,\s*["'](?:ViewContent|AddToCart|InitiateCheckout|Purchase)["']\s*,\s*\{~u
REGEX, <<<'REGEX'
~^[^}]{0,500}?["']?currency["']?\s*:\s*["']([A-Z]{3})["']~u
REGEX, 600],
        ['klaviyo', '~\$currency_code~u', <<<'REGEX'
~^["']?\s*:\s*["']([A-Z]{3})["']~u
REGEX, 40],
    ];
    public const COUNTRY = [
        ['shopify', '~Shopify\.country\s*=\s*~u', <<<'REGEX'
~^["']([A-Z]{2})["']~u
REGEX, 8],
        ['prestashop', '~prestashop\s*=\s*\{~u', <<<'REGEX'
~["']country["']\s*:\s*\{[^}]{0,500}?["']iso_code["']\s*:\s*["']([A-Z]{2})["']~u
REGEX, 20000],
    ];

    public static function find(array $rule, string $scripts): ?string
    {
        [, $anchor, $value, $window] = $rule;
        $offset = 0;
        for ($tries = 0; $tries < 20 && preg_match($anchor, $scripts, $m, PREG_OFFSET_CAPTURE, $offset); ++$tries) {
            $offset = $m[0][1] + strlen($m[0][0]);
            $from = Text::offset($scripts, $offset);
            if (preg_match($value, Text::slice($scripts, $from, $from + $window), $hit)) {
                return $hit[1];
            }
        }
        return null;
    }
}
