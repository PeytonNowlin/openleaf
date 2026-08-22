import { describe, expect, it } from 'vitest'
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import { coreSchema, parseHtml, serializeHtml } from '../src/index.js'
import { tableCaptionNodeView } from '../src/tables.js'

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

  it('parses a nested table as a table, not a preserved atom', () => {
    const types = nodeTypes(
      '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>',
    )
    expect(types.filter((name) => name === 'table')).toHaveLength(2)
    expect(types).not.toContain('unknown_block')
  })

  it('round-trips a nested table', () => {
    const html =
      '<table><tbody><tr><td><table><tbody><tr><td>inner</td></tr></tbody></table></td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
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

  it('keeps cell vertical alignment', () => {
    const html = '<table><tbody><tr><td valign="middle">A</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('folds CSS vertical-align into valign so it is editable', () => {
    const out = roundTrip(
      '<table><tbody><tr><td style="vertical-align:bottom">A</td></tr></tbody></table>',
    )
    expect(out).toContain('valign="bottom"')
    expect(out).not.toContain('vertical-align')
  })

  it('keeps a cell background as modelled style', () => {
    const html =
      '<table><tbody><tr><td style="background-color:#cc0000">A</td></tr></tbody></table>'
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
    // toDOM used to mark a caption inert for the EDITOR. Clipboard serialization
    // shares toDOM and is not serializeHtml, so that marker leaked. It is not
    // the author's, and must not end up in what the server stores.
    const out = roundTrip('<table><caption>Q1</caption><tr><td>A</td></tr></table>')
    expect(out).not.toContain('contenteditable')
  })

  it('does not emit contenteditable from toDOM, including clipboard serialization', () => {
    // Issue #105: DOMSerializer.serializeFragment is what clipboardSerializer
    // uses, and it does not wrap withSerializationDocument.
    const doc = parseHtml('<table><caption>Cap</caption><tr><td>a</td></tr></table>')
    const frag = DOMSerializer.fromSchema(coreSchema()).serializeFragment(doc.content, { document })
    const host = document.createElement('div')
    host.appendChild(frag)
    expect(host.innerHTML).not.toContain('contenteditable')
    expect(roundTrip(host.innerHTML)).not.toContain('contenteditable')
  })

  it('drops a leaked contenteditable marker when parsing furniture', () => {
    const out = roundTrip(
      '<table><caption contenteditable="false">Q1</caption><tr><td>A</td></tr></table>',
    )
    expect(out).toContain('<caption>Q1</caption>')
    expect(out).not.toContain('contenteditable')
  })

  it('does not stamp the caption inert from toDOM', () => {
    const doc = parseHtml('<table><caption>Q1</caption><tr><td>A</td></tr></table>')
    let table: unknown = null
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
      return true
    })
    const toDOM = coreSchema().nodes['table']?.spec.toDOM
    expect(toDOM).toBeDefined()
    const rendered = toDOM?.(table as never) as { dom: Element; contentDOM?: Element }
    expect(rendered.contentDOM?.nodeName).toBe('TBODY')
    const caption = rendered.dom.querySelector('caption')
    expect(caption?.hasAttribute('contenteditable')).toBe(false)
    expect(caption?.textContent).toBe('Q1')
  })

  it('marks the caption inert when the EDITOR node view renders it', () => {
    // Serialization must not emit contenteditable; the editor must, or a caret
    // gets into a region ProseMirror does not manage and the typing is reverted.
    const doc = parseHtml('<table><caption>Q1</caption><tr><td>A</td></tr></table>')
    let table: PMNode | undefined
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
      return true
    })
    expect(table).toBeDefined()
    const rendered = tableCaptionNodeView(table!)
    const caption = (rendered.dom as Element).querySelector('caption')
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

describe('thead and tfoot grouping survives the round trip', () => {
  /*
   * The grouping was skipped on parse and never written back, so every save
   * flattened a grouped table into one `<tbody>`. `<thead>` is what repeats a
   * header across printed pages, what sticky-header CSS and `thead th`
   * selectors hook onto, and what tells assistive technology which rows label
   * the data -- losing it changes how the page renders.
   */

  it('keeps a thead and its rows', () => {
    const html =
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps a two-row thead', () => {
    const html =
      '<table><thead><tr><th>h1</th></tr><tr><th>h2</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps a tfoot', () => {
    const html =
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('keeps a tfoot with no thead', () => {
    const html =
      '<table><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('does not invent a thead for header cells that never had one', () => {
    // Deriving `<thead>` from the presence of `<th>` would rewrite every table
    // in an archive that never used one. Same rule as the caption.
    const html = '<table><tbody><tr><th>h</th></tr><tr><td>a</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
    expect(roundTrip(html)).not.toContain('thead')
  })

  it('is stable across repeated round trips', () => {
    const html =
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'
    const once = roundTrip(html)
    expect(roundTrip(once)).toBe(once)
  })

  it('attributes a nested table thead to the nested table', () => {
    // Direct children only, at both levels. Counting with querySelectorAll
    // would credit the inner table's header to the outer one and lift the
    // wrong row out of the outer body -- silently, and permanently.
    const html =
      '<table><tbody><tr><td><table><thead><tr><th>inner</th></tr></thead>' +
      '<tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table>'
    const out = roundTrip(html)
    expect(out).toBe(html)
    expect(out.match(/<thead>/g)).toHaveLength(1)
  })

  it('keeps the rows direct children of the table node', () => {
    // The reason the grouping is a count and not a node: prosemirror-tables
    // reads height as table.childCount and every child as a row.
    const doc = parseHtml(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>',
    )
    let table: unknown = null
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
      return true
    })
    const found = table as unknown as {
      childCount: number
      child: (i: number) => { type: { name: string } }
      attrs: Record<string, unknown>
    }
    expect(found.childCount).toBe(2)
    expect(found.child(0).type.name).toBe('table_row')
    expect(found.child(1).type.name).toBe('table_row')
    expect(found.attrs['headerRows']).toBe(1)
  })

  it('degrades cleanly when the header rows were deleted in the editor', () => {
    // The document can change after it was parsed, so the count is clamped to
    // the rows actually present rather than trusted: a table whose header row
    // was deleted loses a section, it does not throw and it does not leave an
    // empty `<tbody>` behind.
    const schema = coreSchema()
    const cell = schema.nodes['table_cell']?.create(null, schema.nodes['paragraph']?.create(null, schema.text('a')))
    const row = schema.nodes['table_row']?.create(null, cell)
    const table = schema.nodes['table']?.create({ headerRows: 4 }, row)
    const doc = schema.nodes['doc']?.create(null, table)
    const out = serializeHtml(doc as never)
    expect(out).toBe('<table><thead><tr><td>a</td></tr></thead></table>')
  })

  it('leaves a tfoot written before its tbody alone rather than moving rows', () => {
    // HTML 4 required tfoot before tbody. The counts describe a leading and a
    // trailing run of rows, and those rows are neither; taking the last row
    // regardless would move a data row into a tfoot it never belonged to.
    const out = roundTrip(
      '<table><tfoot><tr><td>f</td></tr></tfoot><tbody><tr><td>a</td></tr></tbody></table>',
    )
    expect(out).toBe('<table><tbody><tr><td>f</td></tr><tr><td>a</td></tr></tbody></table>')
  })

  it('does not restructure a table inside preserved markup', () => {
    const html =
      '<div class="wrapper"><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></div>'
    expect(roundTrip(html)).toBe(html)
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

/**
 * Cell spans, clamped on parse.
 *
 * `colspan` was read straight off the attribute and never bounded, so a single
 * cell could ask `prosemirror-tables` for an arbitrarily wide table -- and both
 * of its consumers scale linearly: `TableMap.get` allocates `width * height` map
 * cells, and the resizing plugin appends one real `<col>` element per column. A
 * fifty-byte `<td colspan="5000000">` was five million DOM elements built
 * synchronously, reached through every entry point into the schema.
 *
 * The bounds are HTML's own, so a document a browser would have parsed the same
 * way loses nothing.
 */
describe('cell spans are bounded', () => {
  /** The first cell's attributes, which is where a span lands. */
  function cellAttrs(html: string): Record<string, unknown> {
    let found: Record<string, unknown> | null = null
    parseHtml(html).descendants((node) => {
      if (found === null && (node.type.name === 'table_cell' || node.type.name === 'table_header')) {
        found = node.attrs
      }
      return true
    })
    if (found === null) throw new Error(`no cell parsed from ${html}`)
    return found
  }

  const cell = (attr: string): Record<string, unknown> =>
    cellAttrs(`<table><tr><td ${attr}>A</td></tr></table>`)

  it('clamps colspan to the limit HTML itself imposes', () => {
    expect(cell('colspan="5000000"')['colspan']).toBe(1000)
    expect(cell('colspan="1000"')['colspan']).toBe(1000)
    expect(cell('colspan="999"')['colspan']).toBe(999)
  })

  it('clamps rowspan the same way', () => {
    expect(cell('rowspan="99999999"')['rowspan']).toBe(65534)
    expect(cell('rowspan="3"')['rowspan']).toBe(3)
  })

  it('normalizes a span below one, which walked the cell map backwards', () => {
    // `|| 1` caught NaN and 0 and nothing else, so -5 landed verbatim and
    // computeMap did `mapPos += colspan` with a negative operand.
    expect(cell('colspan="-5"')['colspan']).toBe(1)
    expect(cell('colspan="0"')['colspan']).toBe(1)
    // rowspan="0" means "to the end of the section" in HTML, but the cell map
    // cannot use a zero, so it normalizes up rather than being carried.
    expect(cell('rowspan="0"')['rowspan']).toBe(1)
    expect(cell('colspan="nonsense"')['colspan']).toBe(1)
  })

  it('does not build a five-million-cell table map', async () => {
    const { TableMap } = await import('prosemirror-tables')
    const doc = parseHtml('<table><tr><td colspan="5000000">x</td></tr></table>')
    const table = doc.firstChild
    if (!table) throw new Error('no table parsed')
    const map = TableMap.get(table)
    expect(map.width).toBe(1000)
    expect(map.map.length).toBe(1000)
  })

  it('writes the clamped value back out, not the one it was given', () => {
    expect(roundTrip('<table><tr><td colspan="5000000">A</td></tr></table>')).toContain(
      'colspan="1000"',
    )
  })

  /*
   * The per-cell clamp does not bound the sum, and the sum is what both
   * consumers scale in. At 5,000 cells -- about 125 KB of input -- the
   * unclamped sum was five million columns, the same hung tab reached by
   * addition rather than by one large number. So a row carries a total too, and
   * each cell is clamped against what is left of it.
   *
   * 200 cells rather than 5,000: the amplification is what is being tested, and
   * 200 is already 200,000 columns without the budget while staying far inside
   * the default test timeout. The 5,000-cell version took 8.6s under a loaded
   * full-suite run and failed on time rather than on the assertion, which is a
   * flake, not a finding.
   */
  it('does not let many maximal spans add up to the same table', async () => {
    const { TableMap } = await import('prosemirror-tables')
    const CELLS = 200
    const doc = parseHtml(`<table><tr>${'<td colspan="1000">x</td>'.repeat(CELLS)}</tr></table>`)
    const table = doc.firstChild
    if (!table) throw new Error('no table parsed')
    const map = TableMap.get(table)
    // The first cell spends the budget; every later one still claims its own
    // single column, because dropping a cell would change the document silently.
    // So the width is bounded by the markup that had to be written for it --
    // never the product of the cell count and the per-cell ceiling.
    expect(map.width).toBeLessThanOrEqual(1000 + CELLS)
    expect(map.map.length).toBe(map.width)
  })

  it('spends the row budget in document order', () => {
    const doc = parseHtml(
      '<table><tr><td colspan="999">a</td><td colspan="1000">b</td><td colspan="7">c</td></tr></table>',
    )
    const row = doc.firstChild?.firstChild
    if (!row) throw new Error('no row parsed')
    const spans: number[] = []
    row.forEach((c) => spans.push(c.attrs['colspan'] as number))
    // 999 fits, the next gets the single remaining column, the last gets one.
    expect(spans).toEqual([999, 1, 1])
  })

  it('gives a second row its own budget', () => {
    const doc = parseHtml(
      `<table><tr><td colspan="1000">a</td></tr><tr><td colspan="4">b</td></tr></table>`,
    )
    const second = doc.firstChild?.child(1)
    if (!second) throw new Error('no second row')
    expect(second.child(0).attrs['colspan']).toBe(4)
  })

  it('leaves an ordinary span exactly as it was', () => {
    const html = '<table><tbody><tr><td colspan="2" rowspan="3">A</td></tr></tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })
})

/**
 * Stored column widths, which land in `col.style.width` unexamined.
 *
 * The digits-only test and the length check are `prosemirror-tables`' own rules
 * for this attribute; the ceiling is ours. What they replace accepted anything
 * `Number.isFinite` did, which included negatives.
 */
describe('colwidth is bounded', () => {
  function firstColwidth(html: string): number[] | null {
    let found: number[] | null | undefined
    parseHtml(html).descendants((node) => {
      if (found === undefined && node.type.name === 'table_cell') {
        found = node.attrs['colwidth'] as number[] | null
      }
      return true
    })
    if (found === undefined) throw new Error(`no cell parsed from ${html}`)
    return found
  }

  const width = (attr: string): number[] | null =>
    firstColwidth(`<table><tr><td ${attr}>A</td></tr></table>`)

  it('keeps a usable width', () => {
    expect(width('data-colwidth="120"')).toEqual([120])
  })

  it('keeps one entry per covered column', () => {
    expect(width('colspan="2" data-colwidth="80,90"')).toEqual([80, 90])
  })

  it('drops a negative width rather than writing it into the layout', () => {
    expect(width('data-colwidth="-9999"')).toBeNull()
  })

  it('drops an absurd width', () => {
    expect(width('data-colwidth="99999999"')).toBeNull()
  })

  it('drops a zero, which is not a column width', () => {
    expect(width('data-colwidth="0"')).toBeNull()
  })

  it('drops an array that does not match colspan, which would be indexed past its end', () => {
    expect(width('colspan="2" data-colwidth="80"')).toBeNull()
    expect(width('data-colwidth="80,90"')).toBeNull()
  })

  it('drops a non-numeric entry', () => {
    expect(width('data-colwidth="80,nonsense"')).toBeNull()
    expect(width('data-colwidth="8e9"')).toBeNull()
  })
})
