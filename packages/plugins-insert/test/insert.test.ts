import { describe, expect, it } from 'vitest'
import { CHARACTERS } from '../src/glyphs.js'
import { listedSnippets, registerHtmlSnippets } from '../src/snippets.js'

describe('insert plugin data', () => {
  it('names every character in the map', () => {
    expect(CHARACTERS.length).toBeGreaterThan(20)
    expect(CHARACTERS.every((item) => item.char && item.name)).toBe(true)
  })

  it('stores registered snippets', () => {
    registerHtmlSnippets([{ id: 'byline', title: 'Byline', html: '<p>x</p>' }])
    expect(listedSnippets()[0]?.id).toBe('byline')
  })
})
