<?php

declare(strict_types=1);

namespace DontPayFull\GlobalPriceParser;

/** Pieces joined once, with one byte (not one PHP zval) per struck flag. */
final class HtmlWriter
{
    private array $parts = [];
    private int $length = 0;
    public string $struck = '';

    public function text(): string
    {
        return implode('', $this->parts);
    }

    private function tail(int $n): string
    {
        $out = '';
        for ($k = count($this->parts) - 1; $k >= 0 && Text::length($out) < $n; --$k) {
            $out = mb_substr($this->parts[$k], -$n, null, 'UTF-8') . $out;
        }
        return mb_substr($out, -$n, null, 'UTF-8');
    }

    private function last(): string
    {
        $part = $this->parts[count($this->parts) - 1] ?? '';
        return $part === '' ? '' : mb_substr($part, -1, null, 'UTF-8');
    }

    public function push(string $s, bool $struck): void
    {
        if ($s === '') {
            return;
        }
        $this->parts[] = $s;
        $length = mb_strlen($s, 'UTF-8');
        $this->length += $length;
        $this->struck .= str_repeat($struck ? "\1" : "\0", $length);
    }

    public function space(bool $struck): void
    {
        if ($this->length && !preg_match('/\s/u', $this->last())) {
            $this->push(' ', $struck);
        }
    }

    public function block(): void
    {
        if (!$this->length || $this->last() === "\n") {
            return;
        }
        while ($this->parts) {
            $at = count($this->parts) - 1;
            $part = $this->parts[$at];
            $kept = rtrim($part, ' ');
            if ($kept === $part) {
                break;
            }
            $this->length -= strlen($part) - strlen($kept);
            if ($kept !== '') {
                $this->parts[$at] = $kept;
            } else {
                array_pop($this->parts);
            }
        }
        if (strlen($this->struck) !== $this->length) {
            $this->struck = substr($this->struck, 0, $this->length);
        }
        $this->push("\n", false);
    }

    public function addText(string $raw, bool $struck): void
    {
        $text = str_replace(Normalize::DECIMAL_MARK, '', Html::decodeEntities($raw));
        $collapsed = preg_replace('/[\t\n\r\f ]+/u', ' ', $text);
        $collapsed = preg_replace('/[ \x{00A0}\x{202F}\x{2009}\x{2007}\x{2002}-\x{2006}\x{3000}]{2,}/u', ' ', $collapsed);
        if ($collapsed === ' ') {
            $this->space($struck);
        } elseif ($collapsed !== '') {
            $leading = $this->length === 0 || preg_match('/\s/u', $this->last()) === 1;
            $this->push($leading ? preg_replace('/^ /u', '', $collapsed) : $collapsed, $struck);
        }
    }

    public function raised(string $content, bool $struck): void
    {
        $clean = preg_replace('/[*†‡§¶]+/u', ' ', str_replace(Normalize::DECIMAL_MARK, '', $content));
        $t = Normalize::asciiDigits(Text::trim($clean));
        $before = Normalize::asciiDigits($this->tail(8));
        $afterNumber = preg_match('/[0-9]\z/u', $before) === 1;
        if (preg_match('/^([0-9]{2})(?:\s*([^0-9]+))?\z/u', $t, $cents) && $afterNumber && !preg_match('/[.,][0-9]{1,2}\z/u', $before)) {
            $this->push(Normalize::DECIMAL_MARK . $cents[1] . (isset($cents[2]) && $cents[2] !== '' ? ' ' . Text::trim($cents[2]) : ''), $struck);
        } elseif (preg_match('/^[.,][0-9]{1,2}\z/u', $t) && $afterNumber) {
            $this->push(Normalize::DECIMAL_MARK . substr($t, 1), $struck);
        } elseif (preg_match('/^[23]\z/u', $t) && preg_match('/m\z/u', $before)) {
            $this->push($t === '2' ? '²' : '³', $struck);
        } elseif ((preg_match('/^[0-9\p{P}\s]+\z/u', $t) || preg_match('/^[a-z]?\z/u', $t)) && Text::trim($content) !== '' && $afterNumber) {
            $this->space($struck);
        } elseif (preg_match('/^[0-9]+\z/u', $t)) {
            $this->push(' ' . $t . ' ', $struck);
        } elseif ($t !== '') {
            $this->push($t, $struck);
        }
    }
}
