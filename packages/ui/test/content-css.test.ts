import { describe, expect, it } from 'vitest'
import { contentCssUrls, scopeContentCss } from '../src/content-css.js'

describe('content CSS', () => {
  it('scopes host selectors under the canvas', () => {
    const scoped = scopeContentCss('p.lead { font-size: 1.2em }')
    expect(scoped).toContain('.ol-editor .ol-content .ProseMirror p.lead')
  })

  it('splits the content-css attribute', () => {
    expect(contentCssUrls('/a.css, /b.css')).toEqual(['/a.css', '/b.css'])
  })
})
