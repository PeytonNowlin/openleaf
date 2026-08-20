/**
 * The recursive walk that was a sanitizer bypass.
 *
 * `visit` recursed once per level of nesting, so about 43 KB of nested `<div>`
 * threw `RangeError: Maximum call stack size exceeded`. That is worse than a
 * crashed request: `sanitize.ts` tells integrators to run this on the SERVER,
 * and the natural shape of that integration is a try/catch that keeps the
 * original HTML when sanitizing fails -- which turns a small payload into
 * unsanitized markup in the database.
 *
 * De-recursing `visit` was necessary but not sufficient, and the measurement is
 * worth recording: every remaining step is recursive inside the DOM
 * implementation itself. On jsdom 26 at Node 26's default stack, reading
 * `innerHTML` back throws at about 3,000 levels, moving the parsed fragment
 * into a host element at about 5,000, and the parser at about 20,000. So no
 * arrangement of this code returns a result for input nested that deep, and the
 * honest answer is an explicit limit with a named error -- checked after the
 * parse, which survives deepest, and before anything that does not.
 */

import { describe, expect, it } from 'vitest'
import { MAX_SANITIZE_DEPTH, SanitizeDepthError, sanitizeHtml } from '../src/index.js'

function nest(depth: number, inner: string): string {
  return '<div>'.repeat(depth) + inner + '</div>'.repeat(depth)
}

describe('deeply nested input', () => {
  it('sanitizes ordinary nesting, well past anything authored', () => {
    const html = nest(100, '<p>text</p><script>alert(1)</script>')
    const out = sanitizeHtml(html)
    expect(out).not.toMatch(/script/i)
    expect(out).toContain('text')
  })

  for (const depth of [1_000, 5_000, 20_000]) {
    it(`refuses ${depth} levels with a named error rather than overflowing`, () => {
      // The payload is a `<script>` behind enough nesting to knock the
      // sanitizer over on the way to removing it. A RangeError here is the
      // bypass; a SanitizeDepthError is a refusal the caller can act on.
      const html = nest(depth, '<p>text</p><script>alert(1)</script>')
      let thrown: unknown
      try {
        sanitizeHtml(html)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(SanitizeDepthError)
      expect((thrown as SanitizeDepthError).depthLimit).toBe(MAX_SANITIZE_DEPTH)
      expect((thrown as Error).name).toBe('SanitizeDepthError')
      // Never a bare RangeError, which is what a `catch` would have been
      // swallowing before.
      expect(thrown).not.toBeInstanceOf(RangeError)
      // Generous: jsdom's own parser takes seconds to build a tree this deep,
      // which is the cost of proving the refusal happens rather than a crash.
    }, 30_000)
  }

  it('draws the line exactly at the limit', () => {
    // `nest(n, '')` is n elements deep; the limit counts elements, not wrappers.
    expect(() => sanitizeHtml(nest(MAX_SANITIZE_DEPTH, ''))).not.toThrow()
    expect(() => sanitizeHtml(nest(MAX_SANITIZE_DEPTH + 1, ''))).toThrow(SanitizeDepthError)
  })

  it('keeps the same post-order result as the recursive walk it replaced', () => {
    // Children are filtered before their parents, so an unwrapped parent hands
    // up children that have already been cleaned. Sibling order is preserved.
    const html = '<div><p>a</p><section><p>b</p></section><p>c</p></div>'
    expect(sanitizeHtml(html)).toBe('<p>a</p><p>b</p><p>c</p>')
  })
})
