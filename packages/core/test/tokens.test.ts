/**
 * `safeClassList` is a syntactic filter, not a CSS-identifier parser.
 *
 * An ASCII-identifier regex used to drop Tailwind, leading-digit and
 * non-ASCII tokens while keeping a neighbour that passed -- so whether a
 * class survived depended on what sat beside it. HTML's class token is a
 * non-empty run of non-whitespace, the same rule `safeId` already uses.
 */

import { describe, expect, it } from 'vitest'
import { IMAGE_ALIGN_CLASSES, parseHtml, roundTrip, safeClassList, serializeHtml } from '../src/index.js'

describe('safeClassList keeps modern HTML class tokens', () => {
  it.each([
    ['md:w-1/2', 'md:w-1/2'],
    ['w-1/2', 'w-1/2'],
    ['p-[10px]', 'p-[10px]'],
    ['2col', '2col'],
    ['größe-mittel', 'größe-mittel'],
    ['标题', '标题'],
    ['rounded md:w-1/2', 'rounded md:w-1/2'],
    ['ol-float-left md:flex', 'ol-float-left md:flex'],
    ['hover:underline', 'hover:underline'],
    ['2xl:hidden', '2xl:hidden'],
    ['lg:w-1/2', 'lg:w-1/2'],
  ])('%j stays intact', (input, expected) => {
    expect(safeClassList(input)).toBe(expected)
  })

  it('still strips modelled alignment classes when asked, without eating neighbours', () => {
    expect(safeClassList('ol-float-left md:flex', IMAGE_ALIGN_CLASSES)).toBe('md:flex')
    expect(safeClassList('rounded ol-align-center p-[10px]', IMAGE_ALIGN_CLASSES)).toBe(
      'rounded p-[10px]',
    )
  })

  it('still returns null when nothing remains', () => {
    expect(safeClassList('')).toBeNull()
    expect(safeClassList('   ')).toBeNull()
    expect(safeClassList(null)).toBeNull()
    expect(safeClassList('ol-float-left', IMAGE_ALIGN_CLASSES)).toBeNull()
  })

  it('deduplicates tokens and ignores extra whitespace', () => {
    expect(safeClassList('  rounded   rounded  md:flex  ')).toBe('rounded md:flex')
  })
})

describe('image class round-trips no longer depend on a surviving neighbour', () => {
  it.each([
    '<p><img src="/a.png" class="md:w-1/2"></p>',
    '<p><img src="/a.png" class="rounded md:w-1/2"></p>',
    '<p><img src="/a.png" class="ol-float-left md:flex"></p>',
    '<p><img src="/a.png" class="größe-mittel bild"></p>',
    '<p><img src="/a.png" class="2col wide"></p>',
    '<p><img src="/a.png" class="标题"></p>',
  ])('keeps every token in %s', (html) => {
    const out = serializeHtml(parseHtml(html))
    const original = html.match(/class="([^"]*)"/)?.[1]
    expect(original).toBeDefined()
    expect(out).toContain(`class="${original}"`)
  })

  it('round-trips a non-ASCII-only class byte-identical', () => {
    // Serializer writes attributes in name order, so the stored form puts
    // `class` before `src`. That string is the one that must be a fixed point.
    const html = '<p><img class="标题" src="/a.png"></p>'
    expect(roundTrip(html)).toBe(html)
  })
})
