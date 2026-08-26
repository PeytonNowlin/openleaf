/**
 * Size-claim matching for the docs gate.
 *
 * Whole-number claims used to require an exact `Math.round`, so a badge of
 * `123 KB` passed at 123.25 KB (Node 26) and failed at 123.6 KB (CI Node 22)
 * with no number both machines would accept. These tests pin the tolerance
 * on that path. They import the predicate rather than spawning the script
 * because the script also weighs real bundles, and this is a pure function
 * of (claimed, measured, integer).
 */

import { describe, expect, it } from 'vitest'
// @ts-expect-error untyped .mjs — the docs gate is a script, not a package
import { claimMatches, expectedClaim } from './check-docs.mjs'

describe('claimMatches', () => {
  it('accepts a whole-number claim 0.6 KB under the measurement', () => {
    expect(claimMatches(123, 123.6, true)).toBe(true)
  })

  it('rejects a whole-number claim far outside the tolerance', () => {
    expect(claimMatches(100, 123.6, true)).toBe(false)
  })

  it('accepts a decimal claim within the 1% tolerance', () => {
    // The numbers the tolerance comment already records: CI 125.4 vs a
    // Node 26 workstation 124.5, for the same docx bytes.
    expect(claimMatches(124.5, 125.4, false)).toBe(true)
    expect(claimMatches(125.4, 124.5, false)).toBe(true)
  })

  it('rejects a decimal claim outside the tolerance', () => {
    expect(claimMatches(124.5, 130, false)).toBe(false)
  })

  it('applies the 0.1 KB floor on small bundles where 1% is smaller', () => {
    // 1% of 5 KB is 0.05 KB; the floor is 0.1. 5.09 is inside the floor,
    // 5.15 is not — and a whole-number claim does not get a free pass
    // just because `Math.round(5.15) === 5`.
    expect(claimMatches(5, 5.09, true)).toBe(true)
    expect(claimMatches(5, 5.15, true)).toBe(false)
    expect(claimMatches(5.0, 5.09, false)).toBe(true)
    expect(claimMatches(5.0, 5.15, false)).toBe(false)
  })

  // The CI failure that blocked #226, #227 and #228: same bytes, CI's
  // Node 22 zlib 0.35 KB heavier than a Node 26 workstation, and the
  // whole-number path refused the 1% band that would have absorbed it.
  it('accepts claimed 123 KB against CI\'s measured 123.6 KB (demo core badge)', () => {
    expect(claimMatches(123, 123.6, true)).toBe(true)
  })
})

describe('expectedClaim', () => {
  it('suggests a whole number that passes on both the CI and workstation weights', () => {
    // CI at 123.6 would previously say "Use 124 KB (nearest whole)", and
    // 124 then failed locally at 123.25 because that rounds to 123. The
    // suggestion must itself be a claim both measurements accept.
    expect(expectedClaim(123.6, true)).toBe('124 KB (nearest whole)')
    expect(claimMatches(124, 123.6, true)).toBe(true)
    expect(claimMatches(124, 123.25, true)).toBe(true)
  })

  it('does not suggest a nearest whole that sits outside the 0.1 KB floor', () => {
    expect(expectedClaim(5.6, true)).toBe('5.6 KB gzipped')
    expect(claimMatches(6, 5.6, true)).toBe(false)
  })

  it('keeps the one-decimal spelling for a decimal claim', () => {
    expect(expectedClaim(123.6, false)).toBe('123.6 KB gzipped')
  })
})
