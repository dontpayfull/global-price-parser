import { RAW_TEXT, tokenize } from './markup'
import { DECIMAL_MARK, asciiDigits } from './normalize'

/** Visible text of an HTML fragment, with a struck-through flag per character. */
export interface Extracted {
  text: string
  struck: boolean[]
}

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'svg', 'iframe', 'object', 'textarea', 'select'])
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'button', 'label'])
const STRUCK = new Set(['del', 's', 'strike'])
const RAISED = new Set(['sup', 'sub'])

const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', euro: '€', pound: '£',
  yen: '¥', cent: '¢', dollar: '$', curren: '¤', thinsp: '\u2009', ensp: '\u2002',
  emsp: '\u2003', minus: '\u2212', ndash: '\u2013', mdash: '\u2014', rsquo: '\u2019', lsquo: '\u2018',
  sup2: '²', sup3: '³', middot: '·',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]*);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      // Surrogates are not characters on their own: keep the reference as written.
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10FFFF && (cp < 0xD800 || cp > 0xDFFF) ? String.fromCodePoint(cp) : all
    }
    const name = body.toLowerCase()
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name]! : all
  })
}

export function parseAttributes(src: string): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null)
  for (const m of src.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))
    attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return attrs
}

// Text only for screen readers (the visible copy is usually `aria-hidden`, which humans DO see).
const SCREEN_READER_ONLY = /(?:^|\s)(?:sr-only|sr-text|[\w-]*__sr-text|screen-reader-text|screenreader-only|visually-?hidden|visuallyhidden|a-offscreen|aok-offscreen|offscreen|u-visually-hidden)(?:\s|$)/i

function isHidden(attrs: Record<string, string>): boolean {
  if ('hidden' in attrs || SCREEN_READER_ONLY.test(attrs.class ?? ''))
    return true
  const style = (attrs.style ?? '').toLowerCase()
  return /display\s*:\s*none|visibility\s*:\s*hidden/.test(style)
}

/** Computed-style version: also catches screen-reader-only text styled by a stylesheet. */
function isHiddenComputed(cs: CSSStyleDeclaration): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden')
    return true
  return cs.position === 'absolute'
    && (/rect\(0(?:px)?,? 0(?:px)?,? 0(?:px)?,? 0(?:px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)'
      || (Number.parseFloat(cs.width) <= 1 && Number.parseFloat(cs.height) <= 1))
}

function isStruckStyle(attrs: Record<string, string>): boolean {
  return /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(attrs.style ?? '')
}

/** Builds the text, deciding what a `<sup>`/`<sub>` means once its content is known. */
class Writer {
  // Pieces joined once at the end: reading the end of a long `+=` string copies all of it.
  private parts: string[] = []
  private length = 0
  struck: boolean[] = []

  get text(): string {
    return this.parts.join('')
  }

  /** The last `n` characters written. */
  tail(n: number): string {
    let out = ''
    for (let k = this.parts.length - 1; k >= 0 && out.length < n; k--)
      out = this.parts[k]! + out
    return out.slice(-n)
  }

  private last(): string {
    const p = this.parts[this.parts.length - 1]
    return p ? p[p.length - 1]! : ''
  }

  push(s: string, struck: boolean): void {
    if (!s)
      return
    this.parts.push(s)
    this.length += s.length
    for (let k = 0; k < s.length; k++)
      this.struck.push(struck)
  }

  space(struck: boolean): void {
    if (this.length && !/\s/.test(this.last()))
      this.push(' ', struck)
  }

  block(): void {
    if (!this.length || this.last() === '\n')
      return
    while (this.parts.length) {
      const p = this.parts[this.parts.length - 1]!
      const kept = p.replace(/ +$/, '')
      if (kept === p)
        break
      this.length -= p.length - kept.length
      if (kept)
        this.parts[this.parts.length - 1] = kept
      else
        this.parts.pop()
    }
    this.struck.length = this.length
    this.push('\n', false)
  }

  /** `decode` is false for DOM text, which the parser has already decoded. */
  addText(raw: string, struck: boolean, decode = true): void {
    // The decimal mark is ours: a private-use character in the page means nothing.
    const collapsed = (decode ? decodeEntities(raw) : raw).replaceAll(DECIMAL_MARK, '')
      .replace(/[\t\n\r\f ]+/g, ' ')
      .replace(/[ \u00A0\u202F\u2009\u2007\u2002-\u2006\u3000]{2,}/g, ' ')
    if (collapsed === ' ')
      this.space(struck)
    else if (collapsed)
      this.push(this.length === 0 || /\s/.test(this.last()) ? collapsed.replace(/^ /, '') : collapsed, struck)
  }

  /** `12<sup>99</sup>` -> `12` + decimal mark + `99`; a footnote `<sup>1</sup>` stays apart. */
  raised(content: string, struck: boolean): void {
    // Footnote marks (`99*`, `99†`) say nothing about the price.
    const t = asciiDigits(content.replaceAll(DECIMAL_MARK, '').replace(/[*†‡§¶]+/g, ' ').trim())
    const before = asciiDigits(this.tail(8))
    const afterNumber = /\d$/.test(before)
    const cents = /^(\d{2})(?:\s*(\D+))?$/.exec(t)
    if (cents && afterNumber && !/[.,]\d{1,2}$/.test(before)) {
      // `19<sup>99</sup>`, and `19<sup>99 €</sup>` with the symbol inside.
      this.push(DECIMAL_MARK + cents[1]! + (cents[2] ? ` ${cents[2].trim()}` : ''), struck)
    }
    else if (/^[.,]\d{1,2}$/.test(t) && afterNumber) {
      this.push(DECIMAL_MARK + t.slice(1), struck)
    }
    else if (/^[23]$/.test(t) && /m$/.test(before)) {
      this.push(t === '2' ? '\u00B2' : '\u00B3', struck)
    }
    else if ((/^[\d\p{P}\s]+$/u.test(t) || /^[a-z]?$/.test(t)) && content.trim() && afterNumber) {
      // A footnote right after a number (`999<sup>1</sup>`, `<sup>1,2</sup>`, `<sup>a</sup>`,
      // `<sup>*</sup>`): not part of the price.
      this.space(struck)
    }
    else if (/^\d+$/.test(t)) {
      this.push(` ${t} `, struck)
    }
    else if (t) {
      this.push(t, struck)
    }
  }
}

/**
 * Reads the visible text of an HTML string. `keepHidden` keeps hidden and screen-reader-only
 * text too (used when nothing visible was found, e.g. the caller passed an `a-offscreen` span).
 */
export function extractHtml(html: string, keepHidden = false): Extracted {
  const w = new Writer()
  // `apart`: a hidden element read anyway (keepHidden); its text is kept apart from its neighbours.
  // `raised`: the text of the outermost `<sup>`/`<sub>`, shared by the ones inside it.
  type Frame = { tag: string, hidden: boolean, struck: boolean, raised: { buf: string } | null, apart: boolean }
  const stack: Frame[] = [{ tag: '#root', hidden: false, struck: false, raised: null, apart: false }]
  // How many elements of each tag are open: a stray closing tag is ignored without a search.
  const open = new Map<string, number>()
  const top = () => stack[stack.length - 1]!
  const pop = (atEnd: boolean) => {
    const f = stack.pop()!
    open.set(f.tag, open.get(f.tag)! - 1)
    if (f.raised && !f.hidden && !top().raised)
      w.raised(f.raised.buf, f.struck)
    if (atEnd)
      return
    if (BLOCK.has(f.tag) && !f.hidden)
      w.block()
    else if (f.apart)
      w.space(f.struck)
  }
  for (const t of tokenize(html)) {
    const cur = top()
    if (t.type === 'text') {
      if (cur.hidden)
        continue
      if (cur.raised)
        cur.raised.buf += decodeEntities(t.text)
      else
        w.addText(t.text, cur.struck)
      continue
    }
    if (t.type === 'raw')
      continue
    if (t.type === 'close') {
      if (!open.get(t.name))
        continue
      while (top().tag !== t.name)
        pop(false)
      pop(false)
      continue
    }
    const tag = t.name
    // Script, style and the like come as raw text; the other skipped elements hide what they hold.
    if (RAW_TEXT.has(tag))
      continue
    const attrs = parseAttributes(t.attrs)
    if (BLOCK.has(tag) && !cur.hidden)
      w.block()
    if (VOID.has(tag) || t.selfClosing)
      continue
    const skip = SKIP.has(tag)
    const apart = keepHidden && !skip && !cur.hidden && isHidden(attrs)
    if (apart)
      w.space(cur.struck)
    open.set(tag, (open.get(tag) ?? 0) + 1)
    stack.push({
      tag,
      apart,
      hidden: cur.hidden || skip || (!keepHidden && isHidden(attrs)),
      struck: cur.struck || STRUCK.has(tag) || isStruckStyle(attrs),
      raised: cur.raised ?? (RAISED.has(tag) ? { buf: '' } : null),
    })
  }
  while (stack.length > 1)
    pop(true)
  return { text: w.text, struck: w.struck }
}

/** Reads the visible text of a DOM node (browser, jsdom, linkedom...). */
export function extractDom(node: Node, keepHidden = false): Extracted {
  const w = new Writer()
  const view = node.ownerDocument?.defaultView ?? (node as Document).defaultView ?? null
  const walk = (n: Node, struck: boolean, raised: { buf: string } | null): void => {
    if (n.nodeType === 3) {
      if (raised)
        raised.buf += n.nodeValue ?? ''
      else
        w.addText(n.nodeValue ?? '', struck, false)
      return
    }
    if (n.nodeType === 9 || n.nodeType === 11) {
      n.childNodes.forEach(c => walk(c, struck, raised))
      return
    }
    if (n.nodeType !== 1)
      return
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (SKIP.has(tag))
      return
    const attrs: Record<string, string> = Object.create(null)
    for (const a of Array.from(el.attributes))
      attrs[a.name.toLowerCase()] = a.value
    const isRoot = n === node
    const hidden = !isRoot && isHidden(attrs)
    if (hidden && !keepHidden)
      return
    let isStruck = struck || STRUCK.has(tag) || isStruckStyle(attrs)
    if (view?.getComputedStyle) {
      const cs = view.getComputedStyle(el)
      if (!isRoot && !keepHidden && isHiddenComputed(cs))
        return
      isStruck ||= /line-through/.test(cs.textDecorationLine || cs.textDecoration || '')
    }
    if (BLOCK.has(tag))
      w.block()
    else if (hidden)
      w.space(isStruck)
    if (RAISED.has(tag) && !raised) {
      const box = { buf: '' }
      el.childNodes.forEach(c => walk(c, isStruck, box))
      w.raised(box.buf, isStruck)
    }
    else {
      el.childNodes.forEach(c => walk(c, isStruck, raised))
    }
    if (BLOCK.has(tag))
      w.block()
    else if (hidden)
      w.space(isStruck)
  }
  walk(node, false, null)
  return { text: w.text, struck: w.struck }
}
