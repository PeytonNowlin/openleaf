import { describe, expect, it } from 'vitest'
import { isFullyModelledStyle, safeColor, safeFontFamily } from '../src/css.js'

/**
 * The colour patterns are ambiguous about whitespace and go quadratic on a raw
 * input; the collapse at the top of `safeColor` is what keeps them linear.
 * That makes the collapse a security control, and a security control with no
 * test is one refactor away from being deleted as redundant tidying. These
 * tests fail if it ever is -- verified by deleting the line and watching them.
 *
 * The budget is deliberately absolute rather than a ratio between two sizes.
 * A ratio has to be set below the ~16x that quadratic predicts for a 4x input,
 * which is close enough to linear's ~4x that timer noise on a loaded CI box
 * decides the outcome. An absolute budget has no such problem here: the gap
 * between the guarded and unguarded costs is four orders of magnitude.
 */
describe('safeColor is linear in the length of its input', () => {
  /**
   * The two patterns blow up on different shapes, so both are exercised.
   * `rgb(` plus spaces is FUNCTIONAL's bad case -- its `\s*` sits directly in
   * front of a class containing `\s`. `rgb(1` plus spaces then a non-digit is
   * RGB_CHANNELS', whose channel separator is `\s*[,\s]\s*`. Neither is
   * terminated, so every pattern must fail, and failure is the expensive
   * direction: a match can stop early, an exhaustive search cannot.
   */
  const payloads = (spaces: number): string[] => [
    `rgb(${' '.repeat(spaces)}`,
    `rgb(1${' '.repeat(spaces)}z`,
  ]

  it('rejects a 256k whitespace run in under 10 ms', () => {
    // Warm the JIT so the budget measures matching, not compilation.
    for (const value of payloads(1024)) safeColor(value)

    for (const value of payloads(256 * 1024)) {
      const started = performance.now()
      const result = safeColor(value)
      const elapsed = performance.now() - started

      expect(result).toBeNull()
      // Measured at ~0.2 ms with the collapse and 24,725 ms without it, so the
      // 10 ms budget sits five orders of magnitude below what it guards and
      // fifty times above the real cost. Deleting the collapse fails this.
      expect(elapsed).toBeLessThan(10)
    }
  })

  it('still normalizes the values the collapse exists to support', () => {
    // The collapse is deliberately not a strip: the space-separated CSS Color
    // 4 syntax needs its separators to survive.
    expect(safeColor('rgb(255   0   0)')).toBe('#ff0000')
    expect(safeColor('  rgb( 1 , 2 , 3 )  ')).toBe('#010203')
    expect(safeColor('rgba(255,\n0,\t0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)')
    expect(safeColor('#AABBCC')).toBe('#aabbcc')
    expect(safeColor('rebeccapurple')).toBe('rebeccapurple')
  })
})

/**
 * `oneFontFamily` is an allowlist. These tests fail if it is deleted, swapped
 * for a denylist of "dangerous" substrings, or widened to a character that
 * can leave the declaration -- verified by reverting the charset and watching
 * the named faces stay rejected, and by deleting the charset and watching
 * `url(`, `expression(`, a comment, an unbalanced quote, a newline and a
 * `;` start to pass.
 */
describe('safeFontFamily', () => {
  it('accepts the faces the previous charset dropped', () => {
    expect(safeFontFamily("Goudy's Old Style")).toBe('"Goudy\'s Old Style"')
    expect(safeFontFamily('"Goudy\'s Old Style"')).toBe('"Goudy\'s Old Style"')
    expect(safeFontFamily("'21st Century'")).toBe('"21st Century"')
    expect(safeFontFamily('"21st Century"')).toBe('"21st Century"')
    expect(safeFontFamily('21st Century')).toBe('"21st Century"')
    expect(safeFontFamily('"C++ Sans"')).toBe('"C++ Sans"')
    expect(safeFontFamily('C++ Sans')).toBe('"C++ Sans"')
    // Letters and spaces only -- a control that already passed, named in the
    // issue as wrongly rejected. It was not; this pins that it still is not.
    expect(safeFontFamily('Gill Sans MT Extra Condensed')).toBe('"Gill Sans MT Extra Condensed"')
    expect(safeFontFamily('"Gill Sans MT Extra Condensed"')).toBe('"Gill Sans MT Extra Condensed"')
  })

  it('rewrites every quoting style to one canonical spelling', () => {
    // Generic families stay keywords. A quoted "serif" would name a font
    // called serif rather than the generic, so the fold is load-bearing.
    expect(safeFontFamily('Georgia')).toBe('Georgia')
    expect(safeFontFamily("'Georgia'")).toBe('Georgia')
    expect(safeFontFamily('"Georgia"')).toBe('Georgia')
    expect(safeFontFamily('serif')).toBe('serif')
    expect(safeFontFamily('"serif"')).toBe('serif')
    expect(safeFontFamily("'Times New Roman'")).toBe('"Times New Roman"')
    expect(safeFontFamily('"Times New Roman"')).toBe('"Times New Roman"')
    expect(safeFontFamily('Times New Roman')).toBe('"Times New Roman"')
    expect(safeFontFamily('"Source Code Pro"')).toBe('"Source Code Pro"')
    expect(safeFontFamily('"Goudy\'s Old Style", Georgia, serif')).toBe(
      '"Goudy\'s Old Style",Georgia,serif',
    )
  })

  it('refuses every shape that can reach outside the declaration', () => {
    for (const value of [
      'url(https://evil.example/x)',
      'url("https://evil.example/x")',
      'expression(alert(1))',
      'var(--x)',
      'Georgia /* comment */',
      '"/*"',
      "'Times New Roman",
      '"Times New Roman',
      '"Times New Roman\'',
      'Georgia;\ncolor:red',
      'Georgia;position:fixed',
      'foo(bar)',
      'Foo "Bar"',
      '"Foo "Bar""',
      'Georgia\\9',
      '@import',
      'foo<>bar',
    ]) {
      expect(safeFontFamily(value), value).toBeNull()
    }
  })

  it('still models a span that carries only an apostrophe family', () => {
    expect(isFullyModelledStyle('font-family:"Goudy\'s Old Style"')).toBe(true)
    expect(isFullyModelledStyle('font-family:url(https://evil.example)')).toBe(false)
  })
})
