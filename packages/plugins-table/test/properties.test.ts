/**
 * What the property dialogs and the resize sync write into stored HTML.
 *
 * The commands set node attributes directly, so nothing here passes through a
 * parse rule. That is the whole risk: the schema's validation runs on the way in
 * from HTML, and these paths skip it.
 */

import { parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  colgroupHtmlWithWidths,
  colgroupSyncPlugin,
  mergeStyle,
  styleValueOrNull,
  widthsFromColgroup,
} from '../src/index.js'

describe('mergeStyle', () => {
  // serializeDeclarations joins on `;`, so an unchecked value carrying one
  // becomes extra declarations -- `position:fixed;inset:0` covers the page.
  it('refuses a padding that smuggles in more declarations', () => {
    expect(mergeStyle(null, { padding: '0;position:fixed;inset:0' })).toBe(null)
  })

  it('keeps a padding the schema would accept', () => {
    expect(mergeStyle(null, { padding: '2px 4px' })).toBe('padding:2px 4px')
  })

  it('keeps one to four lengths and refuses five', () => {
    expect(styleValueOrNull('padding', '1px 2px 3px 4px')).toBe('1px 2px 3px 4px')
    expect(styleValueOrNull('padding', '1px 2px 3px 4px 5px')).toBe(null)
  })

  it('refuses a colour that is not one', () => {
    expect(mergeStyle(null, { 'background-color': 'url(https://evil.example/x)' })).toBe(null)
    expect(mergeStyle(null, { 'background-color': '#cc0000' })).toBe('background-color:#cc0000')
  })

  it('drops a property the table schema does not model', () => {
    expect(mergeStyle(null, { position: 'fixed' })).toBe(null)
  })

  it('removes a declaration when the value is cleared', () => {
    expect(mergeStyle('padding: 4px; background-color: #fff', { padding: null })).toBe(
      'background-color:#fff',
    )
  })
})

describe('colgroup widths', () => {
  const inherited = '<colgroup class="layout"><col span="2" width="120"><col width="80"></colgroup>'

  // Reading positionally reported the second column as having no width, and
  // then a save wrote that back.
  it('honours span when reading widths', () => {
    expect(widthsFromColgroup(inherited, 3)).toEqual(['120', '120', '80'])
  })

  it('returns inherited markup untouched when no width changed', () => {
    expect(colgroupHtmlWithWidths(inherited, ['120', '120', '80'])).toBe(inherited)
  })

  it('keeps the class and the span when another column changes', () => {
    const out = colgroupHtmlWithWidths(inherited, ['120', '120', '200'])
    expect(out).toContain('class="layout"')
    expect(out).toContain('<col span="2" width="120">')
    expect(out).toContain('<col width="200">')
  })

  it('splits a span only when its columns stop agreeing', () => {
    const out = colgroupHtmlWithWidths(inherited, ['120', '90', '80'])
    expect(out).toBe('<colgroup class="layout"><col width="120"><col width="90"><col width="80"></colgroup>')
  })

  it('appends columns the stored colgroup did not describe', () => {
    expect(colgroupHtmlWithWidths(inherited, ['120', '120', '80', '55'])).toContain('<col width="55">')
  })

  it('builds a fresh colgroup when there is none', () => {
    expect(colgroupHtmlWithWidths(null, ['10', '20'])).toBe(
      '<colgroup><col width="10"><col width="20"></colgroup>',
    )
  })
})

describe('colgroup sync after a resize', () => {
  /** Run the sync plugin over a doc whose cell colwidths were just set. */
  function synced(html: string, colwidths: Record<number, number[]>): string {
    const doc = parseHtml(html)
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: [colgroupSyncPlugin()],
    })
    // Stand in for prosemirror-tables' column resize, which writes colwidth
    // onto cells and nothing onto the colgroup.
    let tr = state.tr
    let index = 0
    state.doc.descendants((node, pos) => {
      if (node.type.spec['tableRole'] !== 'cell' && node.type.spec['tableRole'] !== 'header_cell') {
        return true
      }
      const widths = colwidths[index]
      index += 1
      if (widths) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: widths })
      return false
    })
    state = state.apply(tr)
    return serializeHtml(state.doc)
  }

  // A cell spanning two columns appears twice in the table map and holds one
  // width per column. Reading entry 0 both times wrote the first width to both.
  it('gives each column of a spanning cell its own width', () => {
    const out = synced(
      '<table><tbody><tr><td colspan="2">Wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>',
      { 0: [120, 200] },
    )
    expect(out).toContain('<col width="120">')
    expect(out).toContain('<col width="200">')
  })

  it('keeps inherited colgroup attributes through a resize', () => {
    const out = synced(
      '<table><colgroup class="layout"><col><col></colgroup><tbody>' +
        '<tr><td>a</td><td>b</td></tr></tbody></table>',
      { 0: [140], 1: [60] },
    )
    expect(out).toContain('class="layout"')
    expect(out).toContain('<col width="140">')
    expect(out).toContain('<col width="60">')
  })
})
