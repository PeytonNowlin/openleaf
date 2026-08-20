import { describe, expect, it } from 'vitest'
import { safeColor } from '../src/css.js'

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
