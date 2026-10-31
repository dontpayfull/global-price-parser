<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser\Tests;

use DontPayFull\GlobalPriceParser\Evidence;
use DontPayFull\GlobalPriceParser\Html;
use DontPayFull\GlobalPriceParser\PriceParser;
use DontPayFull\GlobalPriceParser\Url;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ReviewTest extends TestCase
{
    /** Shared CI machines are several times slower; a quadratic slip is still far above the limits. */
    private static function slow(): float
    {
        return getenv('CI') ? 10.0 : 1.0;
    }

    public function testInvalidUtf8IsReplacedAtPublicBoundaries(): void
    {
        $old = mb_substitute_character();
        mb_substitute_character('none');
        try {
            self::assertSame('25.00', PriceParser::parsePrice("\xFF$25")?->amount);
            self::assertCount(1, PriceParser::parsePrices("\xC0$25"));
            self::assertSame("\u{FFFD}", PriceParser::readPageSignals("<html lang=\"\xFF\"></html>")->language);
            self::assertSame('CAD', PriceParser::parsePrice('$25', ['page' => "\xFF<html lang=en-CA>"])?->currency);
            self::assertNotNull(PriceParser::parsePrice('$25', ['language' => "\xFF", 'url' => "https://x.example/\xFF"]));
            self::assertSame('none', mb_substitute_character());
        } finally {
            mb_substitute_character($old);
        }
    }

    public function testNumericEntitiesAreBoundedAndSurrogatesStayLiteral(): void
    {
        $raw = '&#55357;&#56832; &#xD800; &#999999999999999999999999; &#x1234567;';
        self::assertSame($raw, Html::decodeEntities($raw));
        self::assertSame('😀', Html::decodeEntities('&#x1F600;'));
        self::assertSame('10.00', PriceParser::parsePrice('<p>' . $raw . ' 10 €</p>')?->amount);
        self::assertSame('1299.90', PriceParser::parsePrice('<nav>' . str_repeat('İ', 20) . '</nav><script>var a=1</script><p>1.299,90 TL</p>')?->amount);
    }

    public function testNativeIndexesAndSparseNormalizationMap(): void
    {
        $price = PriceParser::parsePrice("😀 \u{200E}$25");
        self::assertSame(3, $price?->index);
        self::assertSame('$25', $price?->raw);
        self::assertSame('123.00', PriceParser::parsePrice("$1\u{E000}2\u{E000}3")?->amount);
        $price = PriceParser::parsePrice("<del>😀 \u{200E}€10</del><ins>€9</ins>");
        self::assertSame('9.00', $price?->amount);
        self::assertFalse($price?->struck);
    }

    public function testBcp47GrammarAndAbsoluteEndAnchors(): void
    {
        self::assertNull(Evidence::regionOfTag('abcd-CA'));
        self::assertSame('CA', Evidence::regionOfTag('en-CA-x-a'));
        self::assertNull(Evidence::regionOfTag("en-CA\n"));
        self::assertNull(Evidence::regionOfTag('en-CA-abcde-abcde'));
        self::assertNull(Evidence::regionOfTag('en-CA-a-aa-a-bb'));
        self::assertSame('CAD', PriceParser::parsePrice('$25', ['language' => 'en-CA-x-a'])?->currency);
        self::assertSame('USD', PriceParser::parsePrice('$25', ['language' => 'abcd-CA'])?->currency);
    }

    public function testStringZeroIsNotEmpty(): void
    {
        self::assertSame('0.00', PriceParser::parsePrice('0')?->amount);
        self::assertSame('0.00', PriceParser::parsePrice('<p>0</p>')?->amount);
        self::assertSame('0', PriceParser::readPageSignals('<html lang="0"></html>')->language);
        $page = '<link rel="alternate" hreflang="0" href="https://x.example/p">';
        self::assertSame('0', PriceParser::readPageSignals($page, ['url' => 'https://x.example/p'])->language);
        $page = '<link rel="alternate" hreflang="en-CA" href="0">';
        self::assertSame('en-CA', PriceParser::readPageSignals($page, ['url' => 'https://x.example/0'])->language);
    }

    private static function jsonCurrencies(string $json): array
    {
        $signals = PriceParser::readPageSignals('<script type="application/ld+json">' . $json . '</script>');
        return array_map(static fn ($signal): ?string => $signal->currency, $signals->currency);
    }

    public function testJsonDepthDoesNotTriggerMalformedSyntaxFallback(): void
    {
        $deep = str_repeat('[', 600) . '{"priceCurrency":"CAD"}' . str_repeat(']', 600);
        self::assertSame([], self::jsonCurrencies($deep));
        self::assertSame(['USD'], self::jsonCurrencies('{"priceCurrency":"USD","deep":' . $deep . '}'));
        self::assertSame(['CAD'], self::jsonCurrencies(str_repeat('[', 20) . '{"priceCurrency":"CAD"}' . str_repeat(']', 20)));
        self::assertSame([], self::jsonCurrencies(str_repeat('[', 21) . '{"priceCurrency":"CAD"}' . str_repeat(']', 21)));
        self::assertSame(['CAD'], self::jsonCurrencies('{"priceCurrency":"CAD",}'));
    }

    public function testJsonSurrogatesEscapesDuplicatesAndPropertyOrder(): void
    {
        self::assertSame(['CAD'], self::jsonCurrencies('{"name":"\ud800","priceCurrency":" CAD "}'));
        self::assertSame(['CAD'], self::jsonCurrencies('{"name":"\udc00","priceCurrency":"CAD"}'));
        self::assertSame(['CAD'], self::jsonCurrencies('{"name":"😀","priceCurrency":"CAD"}'));
        self::assertSame(['CAD'], self::jsonCurrencies('{"name":"\\\\ud800","priceCurrency":"CAD"}'));
        self::assertSame(['CAD'], self::jsonCurrencies('{"priceCurrency":"USD","priceCurrency":"CAD"}'));
        self::assertSame(['CAD'], self::jsonCurrencies('{"x":{"priceCurrency":"USD"},"x":{"priceCurrency":"CAD"}}'));
        self::assertSame(['CAD', 'USD'], self::jsonCurrencies('{"2":{"priceCurrency":"USD"},"1":{"priceCurrency":"CAD"}}'));
        self::assertSame([], self::jsonCurrencies('{"x":{"priceCurrency":"USD"},"x":null}'));
    }

    public function testIdnHostsMatchCanonicalHreflang(): void
    {
        $host = function_exists('idn_to_ascii') ? 'xn--bcher-kva.example' : 'bücher.example';
        $page = '<link rel="alternate" hreflang="en-CA" href="https://' . $host . '/p">';
        self::assertSame('en-CA', PriceParser::readPageSignals($page, ['url' => 'https://BÜCHER.example/p'])->language);
    }

    private static function short(string $input, array $options = []): ?string
    {
        $price = PriceParser::parsePrice($input, $options);
        return $price === null ? null : $price->amount . ' ' . ($price->currency ?? 'null') . ($price->currencySure ? '' : '?');
    }

    private static function amounts(string $input): array
    {
        return array_map(static fn ($price): string => $price->amount, PriceParser::parsePrices($input));
    }

    public function testQuotedAttributeValuesCanContainMarkup(): void
    {
        self::assertSame('25.00 USD?', self::short('<span title="<b>$999</b>">$25</span>'));
        self::assertSame('25.00', PriceParser::parsePrice('<del title="x < y">$999</del><span>$25</span>')?->amount);
        self::assertSame(['25.00'], self::amounts('<span hidden title="x < y">$999</span><span>$25</span>'));
    }

    public function testNestedTemplatesAndSvgRemainInert(): void
    {
        self::assertSame('25.00 USD?', self::short('<template><template></template><script>Shopify.currency={"active":"CAD"}</script></template>$25'));
        self::assertSame(['25.00'], self::amounts('<svg><svg></svg><text>$999</text></svg>$25'));
        self::assertSame([], self::amounts('<template><template></template>$999</template>'));
    }

    public function testCommentsAndClosingTagStringsInScriptAreNotMarkup(): void
    {
        self::assertSame('25.00 CAD', self::short('<script>const x="<!--";</script><meta property="product:price:currency" content="CAD">$25'));
        self::assertSame('25.00 USD?', self::short('$25', ['page' => '<script>var s = "</script"; var t = "<meta property=og:price:currency content=CAD>";</script>$25']));
    }

    public function testPageUrlHreflangPrecedesCanonicalAndConflictsStayUncertain(): void
    {
        $page = '<link rel="canonical" href="https://x.example/p"><link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="?locale=ca">';
        self::assertSame('25.00 CAD', self::short('$25', ['url' => 'https://x.example/p?locale=ca', 'page' => $page]));
        $both = '<link rel="alternate" hreflang="en-US" href="/p"><link rel="alternate" hreflang="en-CA" href="/p">';
        self::assertSame('25.00 USD?', self::short('$25', ['url' => 'https://x.example/p', 'page' => $both]));
    }

    public function testNonconsecutiveSignalsOfOneSourceCountTogether(): void
    {
        $html = '<script>Shopify.currency={"active":"CAD"}; BCData={"current_currency_code":"EUR"}</script><meta id="in-context-paypal-metadata" data-currency="USD">$25';
        $price = PriceParser::parsePrice($html);
        self::assertSame('25.00 CAD?', self::short($html));
        self::assertSame(['USD'], $price?->otherCurrencies);
    }

    public function testAdjacentPricesEachKeepTheirOwnCurrencyToken(): void
    {
        self::assertSame(['10.00', '20.00'], self::amounts('<span>10€</span><span>20€</span>'));
        self::assertSame(['19.99'], self::amounts('Pack of 2$19.99'));
    }

    public function testSizeLetterDoesNotShapeRangeOrConsumeMinus(): void
    {
        self::assertSame(['10.00', '20.00'], self::amounts('Size L 10-20 €'));
        self::assertSame('-5.00 USD?', self::short('Size L 2 -$5.00'));
        $price = PriceParser::parsePrice('Size L 2 -$5.00');
        self::assertTrue($price?->negative);
        self::assertNull($price?->range);
    }

    public function testSuperscriptFootnoteLettersAndMarksDoNotHideCurrency(): void
    {
        self::assertSame('19.99 EUR', self::short('<span>19,99<sup>a</sup> €</span>'));
        self::assertSame('19.99 EUR', self::short('<span>19<sup>99*</sup> €</span>'));
    }

    public function testScriptWindowsAndBoundedValuePatternsCountCodePoints(): void
    {
        $html = '<script>checkoutConfig = {"a":"' . str_repeat('😀', 11000) . '","currencyCode":"CAD"};</script>';
        self::assertSame(['CAD'], array_map(static fn ($signal): ?string => $signal->currency, PriceParser::readPageSignals($html)->currency));
        $html = '<script>Shopify.currency={"a":"' . str_repeat('😀', 300) . '","active":"CAD"}</script>';
        self::assertSame(['CAD'], array_map(static fn ($signal): ?string => $signal->currency, PriceParser::readPageSignals($html)->currency));
    }

    public static function whatwgUrls(): iterable
    {
        yield 'backslash authority' => ['https:\\\\shop.example.ca\\p', null, 'shop.example.ca', '/p', ''];
        yield 'backslash path' => ['https://shop.example.com\\en-ca\\p', null, 'shop.example.com', '/en-ca/p', ''];
        yield 'single scheme slash' => ['https:/shop.example.ca\\p', null, 'shop.example.ca', '/p', ''];
        yield 'no scheme slash' => ['https:shop.example.ca\\p', null, 'shop.example.ca', '/p', ''];
        yield 'relative authority' => ['\\\\shop.example.ca\\p', 'https://shop.example.com/p', 'shop.example.ca', '/p', ''];
        yield 'relative absolute path' => ['\\en-ca\\p', 'https://shop.example.com/p', 'shop.example.com', '/en-ca/p', ''];
        yield 'query backslashes unchanged' => ['https://shop.example.com/p?x=\\en-ca\\p#\\en-us', null, 'shop.example.com', '/p', 'x=\\en-ca\\p'];
        yield 'ASCII percent encoding' => ['https://example.com/a b/"<>?x="<>\' \\#\\', null, 'example.com', '/a%20b/%22%3C%3E', 'x=%22%3C%3E%27%20\\'];
        yield 'encoded host dot' => ['https://shop.example%2eca/p', null, 'shop.example.ca', '/p', ''];
        yield 'encoded backslash stays encoded' => ['https://example.com/a%5Cb?x=%5C', null, 'example.com', '/a%5Cb', 'x=%5C'];
        yield 'same scheme relative path' => ['https:other\\en-ca', 'https://example.com/path/p', 'example.com', '/path/other/en-ca', ''];
        yield 'same scheme absolute path' => ['https:/other\\en-ca', 'https://example.com/path/p', 'example.com', '/other/en-ca', ''];
        yield 'different scheme' => ['http:other\\en-ca', 'https://example.com/path/p', 'other', '/en-ca', ''];
    }

    #[DataProvider('whatwgUrls')]
    public function testWhatwgBackslashesAndPercentEncoding(string $href, ?string $base, string $host, string $path, string $query): void
    {
        $url = Url::parse($href, $base);
        self::assertNotNull($url);
        self::assertSame([$host, $path, $query], [$url['host'], $url['path'], $url['query']]);
    }

    public function testPercentEncodedForbiddenHostCharactersAreRejected(): void
    {
        foreach (['%5C', '%2F', '%00', '%25', '%23', '%3F', '%3A', '%40', '%5B', '%5D', '%7F'] as $encoded) {
            self::assertNull(Url::parse('https://shop.example.ca' . $encoded . '/p'), $encoded);
        }
    }

    public function testWhatwgUrlNormalizationPreservesPriceSignals(): void
    {
        self::assertSame('25.00 CAD', self::short('$25', ['url' => 'https:\\\\shop.example.ca\\p']));
        self::assertSame('url.tld', PriceParser::parsePrice('$25', ['url' => 'https:\\\\shop.example.ca\\p'])?->decidedBy);
        self::assertSame('25.00 CAD', self::short('$25', ['url' => 'https://shop.example.com\\en-ca\\p']));
        self::assertSame('url.path', PriceParser::parsePrice('$25', ['url' => 'https://shop.example.com\\en-ca\\p'])?->decidedBy);
        self::assertNull(Url::parse('https://shop.example.ca%5c/p'));
        $page = '<link rel="alternate" hreflang="en-CA" href="https://example.com/a%20b?x=%22"><link rel="alternate" hreflang="en-US" href="/other">';
        self::assertSame('url.hreflang', PriceParser::parsePrice('$25', ['url' => 'https://example.com/a b?x="', 'page' => $page])?->decidedBy);
        $page = '<link rel="alternate" hreflang="en-CA" href="\\p?x=\\raw"><link rel="alternate" hreflang="en-US" href="/other">';
        self::assertSame('url.hreflang', PriceParser::parsePrice('$25', ['url' => 'https://example.com/p?x=\\raw', 'page' => $page])?->decidedBy);
    }

    public static function hostileInputs(): iterable
    {
        yield 'microdata markup' => ['signals', str_repeat('<div itemprop=priceCurrency ', 1800), null, 0.5];
        yield 'script anchors' => ['price', '<script>' . str_repeat('prestashop={"currency":{', 2000) . '</script>$25', '25.00', 0.5];
        yield 'unclosed tags' => ['price', str_repeat('<a', 50000), null, 0.5];
        yield 'unclosed quotes' => ['price', '<div ' . str_repeat('"', 50000), null, 0.5];
        yield 'many raw text elements' => ['price', str_repeat('<script>var a=1;</script><p>word</p>', 20000) . '<p>€ 5</p>', '5.00', 2.0];
        yield 'long tag name' => ['price', '<' . str_repeat('a', 100000), null, 0.3, ['html' => true]];
        yield 'stray closing tags' => ['price', str_repeat('<b><i>', 20000) . str_repeat('</u>', 25000) . '$10', '10.00', 0.5];
        yield 'nested superscripts' => ['price', str_repeat('<sup>a', 10000) . str_repeat('</sup>', 10000) . ' $10', '10.00', 0.5];
        yield 'repeated quoted opening tags' => ['price', str_repeat('<a title="x', 20000) . '$10', '10.00', 0.5];
        yield 'forced HTML quoted opening tags' => ['price', str_repeat('<a title="x', 20000) . '$10', null, 0.5, ['html' => true]];
        yield 'unclosed comments and templates' => ['signals', str_repeat('<!--', 30000) . str_repeat('<template>', 30000), null, 0.5];
    }

    #[DataProvider('hostileInputs')]
    public function testHostileInputIsFast(string $fn, string $input, ?string $amount, float $limit, array $options = []): void
    {
        $start = hrtime(true);
        $result = $fn === 'signals' ? PriceParser::readPageSignals($input) : PriceParser::parsePrice($input, $options);
        $elapsed = (hrtime(true) - $start) / 1e9;
        if ($fn === 'signals') {
            self::assertSame([], $result->currency);
        } else {
            self::assertSame($amount, $result?->amount);
        }
        self::assertLessThan($limit * self::slow(), $elapsed);
        fwrite(STDOUT, sprintf("\nHostile %s: %.3f ms\n", $this->dataName(), $elapsed * 1000));
    }

    public function testSixteenThousandPricesAreWellUnderOneSecond(): void
    {
        $input = str_repeat('$1; ', 16000);
        $start = hrtime(true);
        $prices = PriceParser::parsePrices($input);
        $elapsed = (hrtime(true) - $start) / 1e9;
        self::assertCount(16000, $prices);
        self::assertSame(63996, $prices[15999]->index);
        self::assertLessThan(0.8 * self::slow(), $elapsed);
        fwrite(STDOUT, sprintf("\n16,000 prices: %.3f ms\n", $elapsed * 1000));
    }

    public function testLargePagesFitIn128M(): void
    {
        $autoload = var_export(dirname(__DIR__) . '/vendor/autoload.php', true);
        $code = 'require ' . $autoload . ';' . <<<'PHP'
use DontPayFull\GlobalPriceParser\PriceParser;
$results = [];
foreach (['x ', '字 '] as $piece) {
    $page = '<html lang="en-CA"><p>' . str_repeat($piece, intdiv(1500000, strlen($piece))) . '</p><p>$25</p></html>';
    $start = hrtime(true);
    $price = PriceParser::parsePrice($page);
    $results[] = ['bytes' => strlen($page), 'amount' => $price?->amount, 'currency' => $price?->currency, 'ms' => (hrtime(true) - $start) / 1e6];
}
echo json_encode(['results' => $results, 'peak' => memory_get_peak_usage(true)], JSON_THROW_ON_ERROR);
PHP;
        $process = proc_open([PHP_BINARY, '-d', 'memory_limit=128M', '-r', $code], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        self::assertIsResource($process);
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $error);
        $data = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
        foreach ($data['results'] as $result) {
            self::assertGreaterThanOrEqual(1500000, $result['bytes']);
            self::assertSame('25.00', $result['amount']);
            self::assertSame('CAD', $result['currency']);
        }
        self::assertLessThan(128 * 1024 * 1024, $data['peak']);
        fwrite(STDOUT, "\n128M subprocess: " . $output . "\n");
    }
}
