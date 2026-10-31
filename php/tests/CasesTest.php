<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser\Tests;

use DontPayFull\GlobalPriceParser\Html;
use DontPayFull\GlobalPriceParser\Price;
use DontPayFull\GlobalPriceParser\PriceParser;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CasesTest extends TestCase
{
    private static array $totals = [];
    private static array $failures = [];

    public static function cases(): iterable
    {
        foreach (glob(dirname(__DIR__, 2) . '/spec/cases/*.jsonl') as $file) {
            $handle = fopen($file, 'rb');
            if ($handle === false) {
                throw new \RuntimeException('Cannot open reference cases.');
            }
            $line = 0;
            while (($json = fgets($handle)) !== false) {
                ++$line;
                yield basename($file) . ':' . $line => [
                    basename($file), $line, json_decode(\DontPayFull\GlobalPriceParser\Text::scrubJsonSurrogates($json), true, 512, JSON_THROW_ON_ERROR),
                ];
            }
            fclose($handle);
        }
    }

    #[DataProvider('cases')]
    public function testReferenceCase(string $file, int $line, array $case): void
    {
        self::$totals[$file] = (self::$totals[$file] ?? 0) + 1;
        try {
            $options = $case['options'] ?? [];
            $result = match ($case['fn']) {
                'parsePrice' => PriceParser::parsePrice($case['input'], $options),
                'parsePrices' => PriceParser::parsePrices($case['input'], $options),
                'readPageSignals' => PriceParser::readPageSignals($case['input'], $options),
                default => throw new \RuntimeException('Unknown reference function.'),
            };
            $actual = is_array($result)
                ? array_map(static fn (Price $price): array => $price->toArray(), $result)
                : $result?->toArray();
            $expected = $case['expected'];
            if ($case['fn'] !== 'readPageSignals') {
                $html = $options['html'] ?? (preg_match('/<\/?[a-z][^<>]*>/iu', $case['input']) === 1);
                $text = $html ? Html::extractHtml($case['input'])['text'] : str_replace(\DontPayFull\GlobalPriceParser\Normalize::DECIMAL_MARK, '', $case['input']);
                if ($html) {
                    $evidence = \DontPayFull\GlobalPriceParser\Evidence::buildEvidence(
                        $options,
                        PriceParser::readPageSignals($options['page'] ?? $case['input'], ['url' => $options['url'] ?? null]),
                    );
                    $hasCurrency = static fn (array $c): bool => $c['hasCurrency'];
                    $visible = \DontPayFull\GlobalPriceParser\Parse::readPrices($text, $evidence);
                    if (!array_filter($visible, $hasCurrency)) {
                        $hiddenText = Html::extractHtml($case['input'], true)['text'];
                        $hidden = \DontPayFull\GlobalPriceParser\Parse::readPrices($hiddenText, $evidence);
                        if (array_filter($hidden, $hasCurrency)) {
                            $text = $hiddenText;
                        }
                    }
                }
                if ($case['fn'] === 'parsePrices') {
                    foreach ($actual as &$price) {
                        self::normalizePrice($price, $text);
                    }
                    unset($price);
                    foreach ($expected as &$price) {
                        $price['value'] = (float) $price['value'];
                    }
                    unset($price);
                } elseif ($actual !== null) {
                    self::normalizePrice($actual, $text);
                    if ($expected !== null) {
                        $expected['value'] = (float) $expected['value'];
                    }
                }
            }
            self::assertSame($expected, $actual, $file . ':' . $line . ' ' . $case['fn'] . ' input=' . json_encode($case['input'], JSON_UNESCAPED_UNICODE));
        } catch (\Throwable $error) {
            self::$failures[$file] = (self::$failures[$file] ?? 0) + 1;
            throw $error;
        }
    }

    private static function normalizePrice(array &$price, string $text): void
    {
        $prefix = mb_substr($text, 0, $price['index'], 'UTF-8');
        $price['index'] = intdiv(strlen(mb_convert_encoding($prefix, 'UTF-16LE', 'UTF-8')), 2);
        $price['value'] = (float) $price['value'];
    }

    public static function tearDownAfterClass(): void
    {
        fwrite(STDOUT, "\nReference case summary by file:\n");
        foreach (self::$totals as $file => $total) {
            $failed = self::$failures[$file] ?? 0;
            fwrite(STDOUT, sprintf("  %s: %d/%d passed, %d failed\n", $file, $total - $failed, $total, $failed));
        }
    }
}
