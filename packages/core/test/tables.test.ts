import { describe, expect, it } from 'vitest'
import { parseHtml, schema, serializeHtml } from '../src/index.js'

const roundTrip = (html: string): string => serializeHtml(parseHtml(html))

/** The node type names a document parses into, in order. */
function nodeTypes(html: string): string[] {
  const seen: string[] = []
  parseHtml(html).descendants((node) => {
    seen.push(node.type.name)
    return true
  })
  return seen
}

describe('tables are real nodes, not preserved atoms', () => {
  it('parses into table nodes', () => {
    const types = nodeTypes('<table><tr><td>A</td></tr></table>')
    expect(types).toContain('table')
    expect(types).toContain('table_row')
    expect(types).toContain('table_cell')
    // The whole point: without these node types a table becomes a single
    // opaque atom that an author cannot edit.
    expect(types).not.toContain('unknown_block')
  })

  it('distinguishes header cells from data cells', () => {
    const types = nodeTypes('<table><tr><th>H</th><td>D</td></tr></table>')
    expect(types).toContain('table_header')
    expect(types).toContain('table_cell')
  })

  it('skips tbody, thead and tfoot without losing their rows', () => {
    // `skip` rather than `ignore`: the wrapper carries nothing but its rows are
    // the entire content, so ignoring would delete the table.
    const out = roundTrip(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>',
    )
    expect(out).toContain('<th>H</th>')
    expect(out).toContain('<td>D</td>')
    expect(nodeTypes(out).filter((t) => t === 'table_row')).toHaveLength(2)
  })

  it('allows block content inside cells', () => {
    const out = roundTrip('<table><tr><td><p>One</p><ul><li><p>Two</p></li></ul></td></tr></table>')
    expect(out).toContain('<ul>')
    expect(out).toContain('Two')
  })
})

describe('legacy and accessibility attributes survive', () => {
  it('keeps presentational table attributes from 2009 content', () => {
    // A clean-slate schema would drop these. They are how HTML expressed table
    // styling for fifteen years and dropping them changes how a page renders.
    const html = '<table border="1" cellpadding="4" cellspacing="0" width="100%"><tbody><tr><td>A</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps scope on header cells', () => {
    // scope is what tells a screen reader which cells a header governs.
    // Dropping it turns a navigable table into a grid of unrelated values.
    const html = '<table><tbody><tr><th scope="col">Region</th></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps headers and abbr', () => {
    const html = '<table><tbody><tr><td headers="r1 c1" abbr="Q1">x</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps colspan and rowspan', () => {
    const html = '<table><tbody><tr><td colspan="2" rowspan="3">A</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('omits colspan and rowspan when they are the default', () => {
    expect(roundTrip('<table><tr><td colspan="1">A</td></tr></table>')).not.toContain('colspan')
  })

  it('keeps class on tables, rows and cells', () => {
    const html = '<table class="data"><tbody><tr class="odd"><td class="num">1</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })
})

describe('declared limitations', () => {
  /*
   * These assert current behaviour that is WRONG and known. They exist so the
   * gap is visible in the suite rather than discovered by a user, and so it
   * cannot quietly get worse.
   */

  it('drops <caption>, which is an accessibility regression to be fixed', () => {
    // A caption is a table's accessible name. It cannot be modelled today
    // because prosemirror-tables computes its cell map by treating every child
    // of a table as a row, so a leading caption node breaks its indexing.
    // Tracked as a bug: the fix is a caption node plus an upstream change.
    const out = roundTrip('<table><caption>Q1 results</caption><tr><td>A</td></tr></table>')
    expect(out).not.toContain('caption')
    expect(out).not.toContain('Q1 results')
  })

  it('drops <colgroup> and <col>', () => {
    const out = roundTrip('<table><colgroup><col width="200"></colgroup><tr><td>A</td></tr></table>')
    expect(out).not.toContain('colgroup')
    expect(out).toContain('<td>A</td>')
  })
})

describe('tables and the security rules interact correctly', () => {
  it('drops a script inside a cell but keeps the cell', () => {
    const out = roundTrip('<table><tr><td>ok<script>alert(1)</script></td></tr></table>')
    expect(out).not.toContain('script')
    expect(out).toContain('ok')
  })

  it('strips event handlers from cells', () => {
    const out = roundTrip('<table><tr><td onclick="alert(1)" class="k">x</td></tr></table>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).toContain('class="k"')
  })

  it('drops a javascript: link inside a cell but keeps the text', () => {
    const out = roundTrip('<table><tr><td><a href="javascript:alert(1)">go</a></td></tr></table>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('go')
  })
})

describe('the schema exposes the table roles prosemirror-tables needs', () => {
  it('tags each node with its tableRole', () => {
    // The opt-in editing plugin finds these nodes by role, not by name, so a
    // missing role silently disables every table command.
    expect(schema.nodes['table']?.spec['tableRole']).toBe('table')
    expect(schema.nodes['table_row']?.spec['tableRole']).toBe('row')
    expect(schema.nodes['table_cell']?.spec['tableRole']).toBe('cell')
    expect(schema.nodes['table_header']?.spec['tableRole']).toBe('header_cell')
  })
})
