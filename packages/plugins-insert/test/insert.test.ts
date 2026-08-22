import { describe, expect, it } from 'vitest'
import { CHARACTERS, EMOJI, GLYPH_COLUMNS } from '../src/glyphs.js'
import { listedSnippets, registerHtmlSnippets } from '../src/snippets.js'

describe('insert plugin data', () => {
  it('names every character in the map', () => {
    expect(CHARACTERS.length).toBeGreaterThan(20)
    expect(CHARACTERS.every((item) => item.char && item.name)).toBe(true)
  })

  it('keeps both glyph lists a multiple of the grid width', () => {
    expect(CHARACTERS.length % GLYPH_COLUMNS).toBe(0)
    expect(EMOJI.length % GLYPH_COLUMNS).toBe(0)
  })

  it('stores registered snippets', () => {
    registerHtmlSnippets([{ id: 'byline', title: 'Byline', html: '<p>x</p>' }])
    expect(listedSnippets()[0]?.id).toBe('byline')
  })
})
