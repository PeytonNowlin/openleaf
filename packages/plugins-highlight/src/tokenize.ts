/**
 * A small syntax tokenizer for HTML, CSS and JavaScript.
 *
 * ## Why this is hand-written rather than a dependency
 *
 * The project's usual rule is not to reinvent solved problems -- it builds on
 * ProseMirror rather than a home-made editing engine, and ships sanitizer
 * *configuration* rather than a home-made sanitizer. Highlighting is different
 * on both counts that made those calls go the other way:
 *
 *   - **The stakes are cosmetic.** A sanitizer that is 99% right is a
 *     vulnerability; a highlighter that is 99% right is a highlighter. Nothing
 *     here can corrupt a document -- it only ever produces spans over text that
 *     is displayed, never over text that is stored.
 *   - **The budget is real.** The core bundle sits at 84 KB against a 90 KB
 *     gate. Prism with three languages is several KB and highlight.js is tens;
 *     three focused grammars are about two.
 *
 * ## What it does not do, stated plainly
 *
 *   - JSX, TypeScript type syntax, and JavaScript decorators are not modelled.
 *   - Regex-versus-division is decided by a heuristic (see `regexAllowed`).
 *     `a = b / c / d` is highlighted correctly; a regex immediately after an
 *     identifier that happens to end a statement without a semicolon may not be.
 *   - CSS custom-property values are treated as plain values, not re-parsed.
 *
 * Each of those degrades to "this run is plain text", never to a wrong document.
 */

export type TokenType =
  | 'text'
  | 'comment'
  | 'doctype'
  | 'punctuation'
  | 'tag'
  | 'attr-name'
  | 'attr-value'
  | 'entity'
  | 'string'
  | 'keyword'
  | 'literal'
  | 'number'
  | 'function'
  | 'operator'
  | 'selector'
  | 'property'
  | 'at-rule'

export interface Token {
  type: TokenType
  value: string
}

export type Language = 'html' | 'css' | 'js'

/** Language aliases seen on `class="language-*"` in real content. */
const ALIASES: Record<string, Language> = {
  html: 'html', xml: 'html', xhtml: 'html', svg: 'html', markup: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  ts: 'js', typescript: 'js', tsx: 'js', json: 'js',
}

/** Resolve a language name, or null when it is one we do not model. */
export function resolveLanguage(name: string | null | undefined): Language | null {
  if (!name) return null
  return ALIASES[name.toLowerCase()] ?? null
}

export const SUPPORTED_LANGUAGES = [...new Set(Object.keys(ALIASES))].sort()

/* ------------------------------------------------------------------ *
 * Shared scanning helpers
 * ------------------------------------------------------------------ */

/** Append, merging with the previous token when the type matches. */
function push(out: Token[], type: TokenType, value: string): void {
  if (value === '') return
  const last = out[out.length - 1]
  if (last && last.type === type) last.value += value
  else out.push({ type, value })
}

function at(source: string, index: number, pattern: RegExp): string | null {
  pattern.lastIndex = index
  const match = pattern.exec(source)
  return match && match.index === index ? match[0] : null
}

/* ------------------------------------------------------------------ *
 * JavaScript
 * ------------------------------------------------------------------ */

const JS_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'of', 'return', 'set', 'static',
  'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void',
  'while', 'with', 'yield',
])

const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

/**
 * Closing brackets after which `/` is division rather than a regex.
 *
 * `}` is deliberately absent: it far more often ends a block than an object
 * literal, and after a block a regex is legal.
 */
const DIVISION_AFTER_PUNCT = new Set([')', ']'])

const JS_COMMENT_LINE = /\/\/[^\n]*/y
const JS_COMMENT_BLOCK = /\/\*[\s\S]*?(?:\*\/|$)/y
const JS_STRING = /(['"])(?:\\[\s\S]|(?!\1)[^\\\n])*(?:\1|\n|$)/y
const JS_TEMPLATE = /`(?:\\[\s\S]|[^\\`])*(?:`|$)/y
const JS_REGEX = /\/(?:\\[\s\S]|\[(?:\\[\s\S]|[^\]\\\n])*\]|[^/\\\n[])+\/[gimsuyd]*/y
const JS_NUMBER = /0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?n?/y
const JS_WORD = /[A-Za-z_$][\w$]*/y
const JS_OPERATOR = /=>|\.{3}|[?][.]|(?:[+\-*/%&|^!<>=]=?|&&|\|\||\?\?)=?|[~?:]/y
const JS_PUNCT = /[{}()[\];,.]/y

export function tokenizeJs(source: string): Token[] {
  const out: Token[] = []
  let i = 0

  /**
   * Whether a `/` here would start a regex rather than divide.
   *
   * Tracked as an explicit flag rather than inferred from the previous token
   * type, because identifiers are emitted as `text` and so is whitespace --
   * conflating them made `a / b / c` parse as a regex and colour the rest of
   * the line as a string. True at the start of input, since a regex may open a
   * program.
   */
  let regexAllowed = true

  const emit = (type: TokenType, value: string): void => {
    push(out, type, value)
    if (type === 'text' && value.trim() === '') {
      // Whitespace decides nothing.
    } else if (type === 'operator' || type === 'keyword') {
      regexAllowed = true
    } else if (type === 'punctuation') {
      regexAllowed = !DIVISION_AFTER_PUNCT.has(value)
    } else {
      // Identifier, number, literal, string, regex: a value just ended.
      regexAllowed = false
    }
    i += value.length
  }

  while (i < source.length) {
    const char = source[i] as string

    if (char === '/' ) {
      const line = at(source, i, JS_COMMENT_LINE)
      if (line) { emit('comment', line); continue }
      const block = at(source, i, JS_COMMENT_BLOCK)
      if (block) { emit('comment', block); continue }
      if (regexAllowed) {
        const regex = at(source, i, JS_REGEX)
        if (regex) { emit('string', regex); continue }
      }
    }

    if (char === '"' || char === "'") {
      const str = at(source, i, JS_STRING)
      if (str) { emit('string', str); continue }
    }

    if (char === '`') {
      const tpl = at(source, i, JS_TEMPLATE)
      if (tpl) { emit('string', tpl); continue }
    }

    if (char >= '0' && char <= '9') {
      const num = at(source, i, JS_NUMBER)
      if (num) { emit('number', num); continue }
    }

    const word = at(source, i, JS_WORD)
    if (word) {
      if (JS_KEYWORDS.has(word)) emit('keyword', word)
      else if (JS_LITERALS.has(word)) emit('literal', word)
      else {
        // A name immediately followed by `(` reads as a call, which is the one
        // distinction worth making without a parser.
        const after = source.slice(i + word.length)
        emit(/^\s*\(/.test(after) ? 'function' : 'text', word)
      }
      continue
    }

    const operator = at(source, i, JS_OPERATOR)
    if (operator) { emit('operator', operator); continue }

    const punct = at(source, i, JS_PUNCT)
    if (punct) { emit('punctuation', punct); continue }

    push(out, 'text', char)
    if (char.trim() !== '') regexAllowed = false
    i += 1
  }
  return out
}

/* ------------------------------------------------------------------ *
 * CSS
 * ------------------------------------------------------------------ */

const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y
const CSS_STRING = /(['"])(?:\\[\s\S]|(?!\1)[^\\\n])*(?:\1|$)/y
const CSS_AT_RULE = /@[\w-]+/y
const CSS_NUMBER = /[+-]?(?:\d*\.)?\d+(?:%|[a-z]{1,4})?/y
const CSS_WORD = /[\w-]+/y

export function tokenizeCss(source: string): Token[] {
  const out: Token[] = []
  let i = 0
  /** Inside `{ }` the words are properties and values, outside they are selectors. */
  let inBlock = false
  /** Between `:` and `;` the words are values, not property names. */
  let inValue = false

  while (i < source.length) {
    const char = source[i] as string

    const comment = at(source, i, CSS_COMMENT)
    if (comment) { push(out, 'comment', comment); i += comment.length; continue }

    if (char === '"' || char === "'") {
      const str = at(source, i, CSS_STRING)
      if (str) { push(out, 'string', str); i += str.length; continue }
    }

    if (char === '@' && !inBlock) {
      const rule = at(source, i, CSS_AT_RULE)
      if (rule) { push(out, 'at-rule', rule); i += rule.length; continue }
    }

    if (char === '{') { inBlock = true; inValue = false; push(out, 'punctuation', char); i += 1; continue }
    if (char === '}') { inBlock = false; inValue = false; push(out, 'punctuation', char); i += 1; continue }
    if (char === ':' && inBlock) { inValue = true; push(out, 'punctuation', char); i += 1; continue }
    if (char === ';') { inValue = false; push(out, 'punctuation', char); i += 1; continue }

    if (char >= '0' && char <= '9') {
      const num = at(source, i, CSS_NUMBER)
      if (num) { push(out, 'number', num); i += num.length; continue }
    }

    const word = at(source, i, CSS_WORD)
    if (word) {
      const after = source.slice(i + word.length)
      if (!inBlock) push(out, 'selector', word)
      else if (inValue) push(out, /^\s*\(/.test(after) ? 'function' : 'attr-value', word)
      else push(out, 'property', word)
      i += word.length
      continue
    }

    if ('()[],>+~*='.includes(char)) { push(out, 'punctuation', char); i += 1; continue }
    if (!inBlock && (char === '.' || char === '#')) { push(out, 'selector', char); i += 1; continue }

    push(out, 'text', char)
    i += 1
  }
  return out
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/y
const HTML_DOCTYPE = /<!DOCTYPE[^>]*>?/iy
const HTML_CDATA = /<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/y
const HTML_ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/y
const HTML_TAG_OPEN = /<\/?[a-zA-Z][\w:-]*/y
const HTML_ATTR_NAME = /[^\s/>"'=]+/y
const HTML_ATTR_VALUE = /"[^"]*"?|'[^']*'?|[^\s>]+/y
const HTML_RAW_BLOCK = /<(script|style)\b/iy

/** Tokenize the inside of a tag: name, attributes, values, punctuation. */
function tokenizeTag(source: string, start: number, out: Token[]): number {
  let i = start
  const open = at(source, i, HTML_TAG_OPEN) as string
  const slash = open.startsWith('</') ? 2 : 1
  push(out, 'punctuation', open.slice(0, slash))
  push(out, 'tag', open.slice(slash))
  i += open.length

  while (i < source.length) {
    const char = source[i] as string
    if (char === '>') { push(out, 'punctuation', '>'); return i + 1 }
    if (char === '/' && source[i + 1] === '>') { push(out, 'punctuation', '/>'); return i + 2 }
    if (/\s/.test(char)) { push(out, 'text', char); i += 1; continue }
    if (char === '=') { push(out, 'punctuation', '='); i += 1; continue }

    const value = source[i - 1] === '=' ? at(source, i, HTML_ATTR_VALUE) : null
    if (value) { push(out, 'attr-value', value); i += value.length; continue }

    const name = at(source, i, HTML_ATTR_NAME)
    if (name) { push(out, 'attr-name', name); i += name.length; continue }

    push(out, 'text', char)
    i += 1
  }
  return i
}

export function tokenizeHtml(source: string): Token[] {
  const out: Token[] = []
  let i = 0

  while (i < source.length) {
    const char = source[i] as string

    if (char === '<') {
      const comment = at(source, i, HTML_COMMENT)
      if (comment) { push(out, 'comment', comment); i += comment.length; continue }
      const cdata = at(source, i, HTML_CDATA)
      if (cdata) { push(out, 'comment', cdata); i += cdata.length; continue }
      const doctype = at(source, i, HTML_DOCTYPE)
      if (doctype) { push(out, 'doctype', doctype); i += doctype.length; continue }

      // <script> and <style> hold another language. Their contents are handed
      // to the right tokenizer rather than being coloured as markup, which is
      // the difference between a source view that helps and one that lies.
      const raw = at(source, i, HTML_RAW_BLOCK)
      if (raw) {
        const kind = raw.slice(1).toLowerCase() as 'script' | 'style'
        const afterTag = tokenizeTag(source, i, out)
        const closeAt = source.toLowerCase().indexOf(`</${kind}`, afterTag)
        const end = closeAt === -1 ? source.length : closeAt
        const body = source.slice(afterTag, end)
        if (body) {
          out.push(...(kind === 'script' ? tokenizeJs(body) : tokenizeCss(body)))
        }
        i = end
        continue
      }

      if (at(source, i, HTML_TAG_OPEN)) { i = tokenizeTag(source, i, out); continue }
    }

    if (char === '&') {
      const entity = at(source, i, HTML_ENTITY)
      if (entity) { push(out, 'entity', entity); i += entity.length; continue }
    }

    push(out, 'text', char)
    i += 1
  }
  return out
}

/** Tokenize source in the given language. */
export function tokenize(source: string, language: Language): Token[] {
  switch (language) {
    case 'html':
      return tokenizeHtml(source)
    case 'css':
      return tokenizeCss(source)
    case 'js':
      return tokenizeJs(source)
  }
}
