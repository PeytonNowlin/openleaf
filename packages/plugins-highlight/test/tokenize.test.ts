import { describe, expect, it } from 'vitest'
import { tokenize, tokenizeCss, tokenizeHtml, tokenizeJs, type Token } from '../src/tokenize.js'

const text = (tokens: Token[]): string => tokens.map((t) => t.value).join('')
/**
 * Types of tokens whose text is `value`.
 *
 * Trimmed comparison because adjacent same-type tokens are merged -- which is
 * deliberate, since it produces far fewer spans when rendering -- so an
 * identifier arrives glued to the whitespace around it.
 */
const types = (tokens: Token[], value: string): string[] =>
  tokens.filter((t) => t.value.trim() === value).map((t) => t.type)

/**
 * The invariant that makes highlighting safe.
 *
 * Concatenating every token's value must reproduce the input byte for byte. As
 * long as that holds, highlighting cannot lose, duplicate or reorder a single
 * character -- whatever else it gets wrong is a colour, not a corruption. Every
 * other test in this file is about quality; this one is about safety.
 */
const SAMPLES: Array<[string, 'html' | 'css' | 'js', string]> = [
  ['plain html', 'html', '<p class="x">Hello &amp; goodbye</p>'],
  ['nested html', 'html', '<div id="a"><ul><li>one</li><li>two</li></ul></div>'],
  ['html comment', 'html', '<!-- a comment --><p>after</p>'],
  ['doctype', 'html', '<!DOCTYPE html><html><body>x</body></html>'],
  ['unclosed tag', 'html', '<p class="broken'],
  ['stray angle bracket', 'html', 'a < b and c > d'],
  ['attribute without quotes', 'html', '<img src=/a.png alt=hi>'],
  ['empty', 'html', ''],
  ['embedded script', 'html', '<script>const a = 1;</script>'],
  ['embedded style', 'html', '<style>a { color: red }</style>'],
  ['unclosed script', 'html', '<script>const a = 1;'],
  ['css basics', 'css', '.a > .b { color: #fff; margin: 0 auto }'],
  ['css at rule', 'css', '@media (min-width: 40em) { .a { color: red } }'],
  ['css comment', 'css', '/* note */ .a { /* inner */ color: red }'],
  ['css unterminated comment', 'css', '.a { /* never closed'],
  ['css string', 'css', '.a::after { content: "}" }'],
  ['js basics', 'js', 'const x = 1; function f(a) { return a + 1 }'],
  ['js string', 'js', "const s = 'it\\'s'; const t = \"x\""],
  ['js template', 'js', 'const t = `a ${b} c`'],
  ['js comments', 'js', '// line\n/* block */ const x = 1'],
  ['js regex', 'js', 'const r = /ab+c/gi; const d = a / b / c'],
  ['js numbers', 'js', 'const n = 0xff + 1_000 + 1.5e10 + 10n'],
  ['js unterminated string', 'js', "const s = 'oops"],
  ['js arrow', 'js', 'const f = (a, b) => a ?? b'],
]

describe('tokens reconstruct the input exactly', () => {
  for (const [name, language, source] of SAMPLES) {
    it(name, () => {
      expect(text(tokenize(source, language))).toBe(source)
    })
  }

  it('holds for a large mixed document', () => {
    const big = SAMPLES.filter(([, l]) => l === 'html').map(([, , s]) => s).join('\n').repeat(20)
    expect(text(tokenizeHtml(big))).toBe(big)
  })
})

describe('html', () => {
  const tokens = tokenizeHtml('<a href="/x" data-k>text &amp; more</a>')

  it('distinguishes tag name, attribute name and value', () => {
    expect(types(tokens, 'a')).toContain('tag')
    expect(types(tokens, 'href')).toContain('attr-name')
    expect(types(tokens, '"/x"')).toContain('attr-value')
  })

  it('marks entities', () => {
    expect(types(tokens, '&amp;')).toContain('entity')
  })

  it('marks comments and doctypes', () => {
    expect(tokenizeHtml('<!-- c -->')[0]?.type).toBe('comment')
    expect(tokenizeHtml('<!DOCTYPE html>')[0]?.type).toBe('doctype')
  })

  it('hands script contents to the JavaScript tokenizer', () => {
    // Colouring embedded JS as markup is the difference between a source view
    // that helps and one that lies.
    const inner = tokenizeHtml('<script>const x = 1</script>')
    expect(types(inner, 'const')).toContain('keyword')
  })

  it('hands style contents to the CSS tokenizer', () => {
    const inner = tokenizeHtml('<style>.a { color: red }</style>')
    expect(types(inner, 'color')).toContain('property')
  })
})

describe('css', () => {
  const tokens = tokenizeCss('.card > p { color: #333; margin: 0 }')

  it('separates selectors from properties', () => {
    expect(types(tokens, '.card')).toContain('selector')
    expect(types(tokens, 'color')).toContain('property')
  })

  it('treats values as values, not properties', () => {
    // `margin: 0` and `0 auto` differ only by position; getting this wrong
    // colours half of every stylesheet as a property name.
    const v = tokenizeCss('.a { font: bold }')
    expect(types(v, 'bold')).toContain('attr-value')
    expect(types(v, 'font')).toContain('property')
  })

  it('marks at-rules', () => {
    expect(types(tokenizeCss('@media print { }'), '@media')).toContain('at-rule')
  })
})

describe('javascript', () => {
  it('marks keywords and literals apart', () => {
    const tokens = tokenizeJs('const ok = true')
    expect(types(tokens, 'const')).toContain('keyword')
    expect(types(tokens, 'true')).toContain('literal')
  })

  it('marks a called name as a function', () => {
    expect(types(tokenizeJs('doThing(1)'), 'doThing')).toContain('function')
    expect(types(tokenizeJs('const doThing = 1'), 'doThing')).toContain('text')
  })

  it('treats a slash after an identifier as division, not a regex', () => {
    // The classic lightweight-highlighter failure: `a / b / c` swallowed as a
    // regex colours the rest of the line as a string.
    const tokens = tokenizeJs('const r = a / b / c')
    expect(tokens.some((t) => t.type === 'string')).toBe(false)
  })

  it('treats a slash after an operator as a regex', () => {
    expect(tokenizeJs('const r = /ab+/g').some((t) => t.type === 'string')).toBe(true)
  })

  it('does not treat // inside a string as a comment', () => {
    const tokens = tokenizeJs('const u = "https://example.org"')
    expect(tokens.some((t) => t.type === 'comment')).toBe(false)
  })

  it('does not treat a quote inside a comment as a string', () => {
    const tokens = tokenizeJs("// it's fine\nconst x = 1")
    expect(tokens[0]?.type).toBe('comment')
    expect(types(tokens, 'const')).toContain('keyword')
  })

  it('handles an unterminated string without consuming the rest of the file', () => {
    const tokens = tokenizeJs("const s = 'oops\nconst t = 2")
    expect(types(tokens, 'const')).toContain('keyword')
  })
})
