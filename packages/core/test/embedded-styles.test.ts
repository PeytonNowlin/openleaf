import { describe, expect, it } from 'vitest'
import { parseHtml, roundTrip, serializeHtml } from '../src/index.js'

const hero = '<style media="screen">.hero{background:#123;color:white}</style><section class="hero"><style>.hero h1{font-size:48px}</style><h1>Built Right.</h1></section>'

describe('opt-in CMS styles', () => {
  it('keeps nested and leading CSS through repeated source round trips', () => {
    const once = roundTrip(hero, { preserveStyles: true })
    expect(once).toContain('<style media="screen">.hero{background:#123;color:white}</style>')
    expect(once).toContain('<style>.hero h1{font-size:48px}</style>')
    expect(once).toContain('<section class="hero"><h1>Built Right.</h1></section>')
    expect(roundTrip(once, { preserveStyles: true })).toBe(once)
  })

  it('keeps the default filter and script filtering intact', () => {
    expect(roundTrip(hero)).not.toContain('<style')
    const result = roundTrip(hero + '<script>alert(1)</script><form><style>.bad{color:red}</style></form>', { preserveStyles: true })
    expect(result).not.toContain('script')
    expect(result).not.toContain('.bad')
  })

  it('keeps CSS as inert document metadata, separate from the editable DOM', () => {
    const doc = parseHtml(hero, { preserveStyles: true })
    expect(doc.textContent).not.toContain('.hero')
    expect(doc.attrs['embeddedStyles']).toHaveLength(2)
    expect(serializeHtml(doc)).toContain('<style')
  })
})

it('requires an explicit schema to opt in and keeps non-CSS/foreign styles out', () => {
  const plain = parseHtml('<p>Default</p>').type.schema
  expect(() => parseHtml(hero, { schema: plain, preserveStyles: true })).toThrow('explicit schema')
  const result = roundTrip('<style type="text/plain">not CSS</style><svg><style>.foreign{color:red}</style></svg><p>Body</p>', { preserveStyles: true })
  expect(result).toBe('<p>Body</p>')
})
