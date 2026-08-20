import { describe, expect, it } from 'vitest'
import { coreSchema, parseHtml, serializeHtml } from '../src/index.js'

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

describe('caption and colgroup survive the round trip', () => {
  /*
   * These were dropped until they were not. A caption is a table's accessible
   * name, so losing it was an accessibility defect as much as a fidelity one:
   * opening and saving an inherited document removed the only element telling a
   * screen-reader user what the table was.
   */

  it('keeps a caption and its text', () => {
    const out = roundTrip('<table><caption>Q1 results</caption><tr><td>A</td></tr></table>')
    expect(out).toContain('<caption>Q1 results</caption>')
    expect(out).toContain('<td>A</td>')
  })

  it('keeps markup and attributes inside a caption', () => {
    const out = roundTrip(
      '<table><caption class="cap">Q1 <strong>results</strong></caption><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('class="cap"')
    expect(out).toContain('<strong>results</strong>')
  })

  it('keeps colgroup and col with their widths', () => {
    const out = roundTrip(
      '<table><colgroup><col width="200"><col width="80"></colgroup><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('<colgroup>')
    expect(out).toContain('width="200"')
    expect(out).toContain('width="80"')
    expect(out).toContain('<td>A</td>')
  })

  it('keeps bare col elements that have no colgroup wrapper', () => {
    const out = roundTrip('<table><col width="200"><tr><td>A</td></tr></table>')
    expect(out).toContain('<col')
    expect(out).toContain('width="200"')
  })

  it('emits caption before colgroup, the order HTML requires', () => {
    const out = roundTrip(
      '<table><caption>C</caption><colgroup><col width="200"></colgroup><tr><td>A</td></tr></table>',
    )
    expect(out.indexOf('<caption')).toBeLessThan(out.indexOf('<colgroup'))
    expect(out.indexOf('<colgroup')).toBeLessThan(out.indexOf('<td'))
  })

  it('does not invent a caption for a table that never had one', () => {
    expect(roundTrip('<table><tr><td>A</td></tr></table>')).not.toContain('caption')
  })

  it('never writes contenteditable into saved HTML', () => {
    // toDOM marks a caption inert for the EDITOR, because it renders inside the
    // editable area but outside the node's contentDOM. That attribute is ours,
    // not the author's, and must not end up in what the server stores.
    const out = roundTrip('<table><caption>Q1</caption><tr><td>A</td></tr></table>')
    expect(out).not.toContain('contenteditable')
  })

  it('marks the caption inert when the EDITOR renders it', () => {
    // The other half of the pair above. Serialization must not emit
    // contenteditable; the editor must, or a caret gets into a region
    // ProseMirror does not manage and the typing is reverted on redraw.
    const doc = parseHtml('<table><caption>Q1</caption><tr><td>A</td></tr></table>')
    let table: unknown = null
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
      return true
    })
    const toDOM = coreSchema().nodes['table']?.spec.toDOM
    expect(toDOM).toBeDefined()
    const rendered = toDOM?.(table as never) as { dom: Element; contentDOM?: Element }
    // A content hole inside a later child is why this returns an element rather
    // than an output-spec array at all.
    expect(rendered.contentDOM?.nodeName).toBe('TBODY')
    const caption = rendered.dom.querySelector('caption')
    expect(caption?.getAttribute('contenteditable')).toBe('false')
    expect(caption?.textContent).toBe('Q1')
  })

  it('scrubs event handlers out of preserved furniture', () => {
    // The furniture path hands markup back unmodified, so it has to be scrubbed
    // on the way in or it becomes a route around the security rules.
    const out = roundTrip(
      '<table><caption onclick="steal()">Q1</caption><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('Q1')
    expect(out).not.toContain('onclick')
  })

  it('drops a script hidden inside a caption', () => {
    const out = roundTrip(
      '<table><caption>Q1<script>alert(1)</script></caption><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('Q1')
    expect(out).not.toContain('script')
  })

  it('takes only the first caption when a document has two', () => {
    const out = roundTrip(
      '<table><caption>One</caption><caption>Two</caption><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('One')
    expect(out).not.toContain('Two')
  })

  it('leaves the cell map intact, so table editing still indexes correctly', () => {
    // The reason caption is an attribute and not a child node: prosemirror-tables
    // reads height as table.childCount and every child as a row. A captioned
    // table must still parse to rows only.
    const doc = parseHtml('<table><caption>C</caption><tr><td>A</td><td>B</td></tr></table>')
    let table: ReturnType<typeof parseHtml> | null = null
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
      return true
    })
    expect(table).not.toBeNull()
    const found = table as unknown as { childCount: number; child: (i: number) => { type: { name: string } } }
    expect(found.childCount).toBe(1)
    expect(found.child(0).type.name).toBe('table_row')
  })

  it('keeps a caption on a table nested inside preserved markup', () => {
    const out = roundTrip(
      '<div class="callout"><table><caption>Q1</caption><tr><td>A</td></tr></table></div>',
    )
    expect(out).toContain('Q1')
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
    expect(coreSchema().nodes['table']?.spec['tableRole']).toBe('table')
    expect(coreSchema().nodes['table_row']?.spec['tableRole']).toBe('row')
    expect(coreSchema().nodes['table_cell']?.spec['tableRole']).toBe('cell')
    expect(coreSchema().nodes['table_header']?.spec['tableRole']).toBe('header_cell')
  })
})

describe('normalization must not reach inside preserved markup', () => {
  /*
   * Regression. The cell pass that unwraps `<td><p>x</p></td>` to `<td>x</td>`
   * originally ran over the whole serialized output, which meant it also
   * rewrote tables nested inside PRESERVED markup -- content the editor
   * undertook to return byte-identical.
   *
   * A normalization that is correct for our own tables is a broken promise
   * inside an unrecognised wrapper, and the difference is invisible unless
   * something asserts it.
   */

  it('leaves a table inside an unrecognised wrapper exactly as authored', () => {
    const html = '<div class="wrapper"><table><tbody><tr><td><p>hi</p></td></tr></tbody></table></div>'
    expect(roundTrip(html)).toBe(html)
  })

  it('still normalizes a table that is genuinely ours', () => {
    expect(roundTrip('<table><tbody><tr><td><p>hi</p></td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td>hi</td></tr></tbody></table>',
    )
  })

  it('adds no marker of its own to the output', () => {
    // Preserved elements are identified out of band, so nothing internal can
    // reach a customer's database -- and nothing in their content can collide
    // with it. See the WeakSet in preserve.ts.
    const out = roundTrip('<div class="wrapper"><table><tr><td><p>hi</p></td></tr></table></div>')
    expect(out).not.toContain('data-ol')
    expect(out).not.toContain('openleaf')
  })

  it('is stable across repeated round trips', () => {
    const html = '<div class="wrapper"><table><tbody><tr><td><p>hi</p></td></tr></tbody></table></div>'
    const once = roundTrip(html)
    expect(roundTrip(once)).toBe(once)
  })
})

describe('the preservation marker must not collide with customer content', () => {
  /*
   * The marker that tells normalization passes to keep out of preserved markup
   * was originally a real DOM attribute, stripped afterwards with a blanket
   * querySelectorAll. That loop could not distinguish the attribute it had just
   * added from the same attribute occurring in somebody's document -- so a
   * customer who happened to use `data-ol-preserved` had it silently deleted.
   *
   * Destroying an attribute inside preserved content is exactly the failure the
   * marker was introduced to prevent, wearing a different costume.
   */

  it('keeps a customer attribute that happens to match the marker name', () => {
    const html = '<div class="k" data-ol-preserved="mine"><p>x</p></div>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps it on a nested element too', () => {
    const html = '<div class="k"><span data-ol-preserved="v">y</span></div>'
    expect(roundTrip(html)).toBe(html)
  })

  it('still keeps preserved tables out of the cell normalization', () => {
    const html = '<div class="wrapper"><table><tbody><tr><td><p>hi</p></td></tr></tbody></table></div>'
    expect(roundTrip(html)).toBe(html)
  })
})
