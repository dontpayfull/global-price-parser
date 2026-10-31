/**
 * An HTML tokenizer that follows the browser's rules where they matter for prices: a quoted
 * attribute value may hold `<` and `>`, a comment ends at `-->`, and the content of a raw-text
 * element (script, style...) ends only at its own closing tag. Every character is read once,
 * so no input can make it slow.
 */
export type Token =
  | { type: 'text', text: string }
  | { type: 'open', name: string, attrs: string, selfClosing: boolean }
  | { type: 'close', name: string }
  /** The content of a raw-text element, never markup. */
  | { type: 'raw', name: string, text: string }

export const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'iframe', 'noembed', 'noframes'])

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f'
const isLetter = (ch: string | undefined): boolean => ch !== undefined && /[a-z]/i.test(ch)

interface Tag {
  name: string
  attrs: string
  selfClosing: boolean
  end: number
}

/** A tag starting at `from` (just after `<` or `</`), or null when the page ends inside it. */
function readTag(html: string, from: number): Tag | null {
  let q = from
  while (q < html.length && !isSpace(html[q]) && html[q] !== '/' && html[q] !== '>')
    q++
  const name = html.slice(from, q).toLowerCase()
  const attrsStart = q
  while (q < html.length) {
    const ch = html[q]
    if (ch === '>')
      return { name, attrs: html.slice(attrsStart, q), selfClosing: q > attrsStart && html[q - 1] === '/', end: q + 1 }
    q++
    if (ch !== '=')
      continue
    while (isSpace(html[q]))
      q++
    const quote = html[q]
    if (quote === '"' || quote === '\'') {
      const close = html.indexOf(quote, q + 1)
      if (close < 0)
        return null
      q = close + 1
    }
  }
  return null
}

const RAW_CLOSE = new Map<string, RegExp>()
/** `</script>`, `</SCRIPT >`, `</script/>`; not `</script"` or `</scripts>`. */
function rawClose(name: string): RegExp {
  let re = RAW_CLOSE.get(name)
  if (!re) {
    re = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi')
    RAW_CLOSE.set(name, re)
  }
  return re
}

/** What starts at `lt` (a `<`): a token and where it ends, `null` token for comments, or null when `<` is text. */
function readAt(html: string, lt: number): { token: Token | null, end: number } | null {
  const n = html.length
  const c = html[lt + 1]
  if (html.startsWith('<!--', lt)) {
    if (html.startsWith('>', lt + 4))
      return { token: null, end: lt + 5 }
    if (html.startsWith('->', lt + 4))
      return { token: null, end: lt + 6 }
    const close = html.indexOf('-->', lt + 4)
    return { token: null, end: close < 0 ? n : close + 3 }
  }
  if (c === '!' || c === '?') {
    // Doctype, CDATA, processing instructions: skipped up to the next `>`.
    const gt = html.indexOf('>', lt + 2)
    return { token: null, end: gt < 0 ? n : gt + 1 }
  }
  if (c === '/') {
    const c2 = html[lt + 2]
    if (c2 === undefined)
      return null
    if (c2 === '>')
      return { token: null, end: lt + 3 }
    if (!isLetter(c2)) {
      const gt = html.indexOf('>', lt + 2)
      return { token: null, end: gt < 0 ? n : gt + 1 }
    }
    const tag = readTag(html, lt + 2)
    return tag ? { token: { type: 'close', name: tag.name }, end: tag.end } : { token: null, end: n }
  }
  if (!isLetter(c))
    return null
  const tag = readTag(html, lt + 1)
  if (!tag)
    return { token: null, end: n }
  return { token: { type: 'open', name: tag.name, attrs: tag.attrs, selfClosing: tag.selfClosing }, end: tag.end }
}

export function* tokenize(html: string): Generator<Token> {
  let text = 0
  let i = 0
  for (let lt = html.indexOf('<', i); lt >= 0; lt = html.indexOf('<', i)) {
    const at = readAt(html, lt)
    if (!at) {
      i = lt + 1
      continue
    }
    if (lt > text)
      yield { type: 'text', text: html.slice(text, lt) }
    i = text = at.end
    const t = at.token
    if (!t)
      continue
    yield t
    if (t.type === 'open' && RAW_TEXT.has(t.name)) {
      const close = rawClose(t.name)
      close.lastIndex = i
      const end = close.exec(html)?.index ?? html.length
      yield { type: 'raw', name: t.name, text: html.slice(i, end) }
      i = text = end
    }
  }
  if (text < html.length)
    yield { type: 'text', text: html.slice(text) }
}
