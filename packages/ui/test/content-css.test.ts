import { describe, expect, it } from 'vitest'
import { contentCssUrls, scopeContentCss } from '../src/content-css.js'

describe('content CSS', () => {
  it('scopes host selectors under the canvas', () => {
    const scoped = scopeContentCss('p.lead { font-size: 1.2em }')
    expect(scoped).toContain('.ol-editor .ol-content .ProseMirror p.lead')
  })

  const SCOPE = '.ol-editor .ol-content .ProseMirror'

  /*
   * The old implementation matched a selector only where it was preceded by the
   * start of the input or a `}`. A rule inside `@media` is preceded by the media
   * block's `{`, so it never matched and shipped unscoped into the host page --
   * where "the host page" is a CMS admin screen. Media queries are in nearly
   * every real stylesheet, so this was the common case.
   */
  it('scopes a rule inside @media', () => {
    const scoped = scopeContentCss('@media (min-width: 40em) { p.lead { color: red } }')
    expect(scoped).toContain(`${SCOPE} p.lead`)
    expect(scoped).toContain('@media (min-width: 40em)')
  })

  it('scopes a rule inside @supports, and inside a nested at-rule', () => {
    const scoped = scopeContentCss(
      '@supports (display: grid) { @media print { blockquote { margin: 0 } } }',
    )
    expect(scoped).toContain(`${SCOPE} blockquote`)
  })

  it('scopes every rule in a block, not just the first', () => {
    const scoped = scopeContentCss('@media screen { h1 { color: red } h2 { color: blue } }')
    expect(scoped).toContain(`${SCOPE} h1`)
    expect(scoped).toContain(`${SCOPE} h2`)
  })

  /*
   * The commas inside `:is()` belong to the function. Splitting on them
   * produced `a:is(.b, SCOPE .c)` -- an invalid selector whose rule the browser
   * drops, so the rule silently stopped applying to the canvas at all.
   */
  it('does not split a functional pseudo-class on its inner comma', () => {
    const scoped = scopeContentCss('a:is(.b, .c) { color: red }')
    expect(scoped).toBe(`${SCOPE} a:is(.b, .c){ color: red }`)
  })

  it('leaves a comma inside an attribute value alone', () => {
    const scoped = scopeContentCss('a[title="x,y"] { color: red }')
    expect(scoped).toBe(`${SCOPE} a[title="x,y"]{ color: red }`)
  })

  it('still scopes each selector of a real selector list', () => {
    const scoped = scopeContentCss('h1, h2 { margin: 0 }')
    expect(scoped).toBe(`${SCOPE} h1, ${SCOPE} h2{ margin: 0 }`)
  })

  /*
   * Keyframe offsets are not selectors. Prefixing `from` with a class produces
   * an offset that matches nothing, which kills the animation silently -- so
   * the block of an at-rule that does not contain rules is passed through.
   */
  it('leaves keyframe offsets alone', () => {
    const scoped = scopeContentCss('@keyframes fade { from { opacity: 0 } to { opacity: 1 } }')
    expect(scoped).not.toContain(SCOPE)
    expect(scoped).toContain('from { opacity: 0 }')
  })

  it('leaves @font-face and @import alone', () => {
    const scoped = scopeContentCss("@import url('/a.css');\n@font-face { font-family: X }")
    expect(scoped).not.toContain(SCOPE)
    expect(scoped).toContain("@import url('/a.css');")
  })

  it('does not scope a nested rule twice', () => {
    const scoped = scopeContentCss('p { & .lead { color: red } }')
    // The parent carries the scope; the nested selector is relative to it.
    expect(scoped.match(new RegExp(SCOPE.replace(/\./g, '\\.'), 'g'))).toHaveLength(1)
  })

  it('leaves a selector the author already scoped as written', () => {
    const scoped = scopeContentCss('.ol-content p { color: red }')
    expect(scoped).toBe('.ol-content p{ color: red }')
  })

  it('is not confused by a brace inside a string', () => {
    const scoped = scopeContentCss('p::after { content: "}" } h1 { color: red }')
    expect(scoped).toContain(`${SCOPE} h1`)
  })

  it('returns a truncated stylesheet rather than half-scoping it', () => {
    const scoped = scopeContentCss('p { color: red')
    expect(scoped).toBe('p { color: red')
  })

  it('splits the content-css attribute', () => {
    expect(contentCssUrls('/a.css, /b.css')).toEqual(['/a.css', '/b.css'])
  })
})
