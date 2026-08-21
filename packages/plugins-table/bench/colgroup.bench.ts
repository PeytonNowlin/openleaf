/**
 * Task 40 item 5: `colgroupSyncPlugin` re-parses stored colgroup HTML twice per
 * table per transaction. jsdom, not a browser.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { describe, it } from 'vitest'
import { colgroupSyncPlugin } from '../src/commands.js'
import { time } from '../../../bench/_util.js'

/** One resized table: a colgroup with real widths, plus `colwidth` on the cells. */
function tableHtml(rows: number, cols: number): string {
  const group = Array.from({ length: cols }, (_, c) => `<col width="${80 + c}">`).join('')
  const body: string[] = []
  for (let r = 0; r < rows; r += 1) {
    const cells: string[] = []
    for (let c = 0; c < cols; c += 1)
      cells.push(`<td data-colwidth="${80 + c}"><p>cell ${r}-${c}</p></td>`)
    body.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table><colgroup>${group}</colgroup><tbody>${body.join('')}</tbody></table>`
}

describe('40.5 - colgroupSync appendTransaction', () => {
  it('measures', () => {
    const schema = coreSchema()
    for (const [label, html] of [
      ['1 resized 100x20 table', `${tableHtml(100, 20)}<p>after</p>`],
      ['20 resized 20x10 tables', `${Array.from({ length: 20 }, () => tableHtml(20, 10)).join('')}<p>after</p>`],
    ] as const) {
      const plugin = colgroupSyncPlugin()
      const state = EditorState.create({ doc: parseHtml(html, { schema }), plugins: [plugin] })
      const tr = state.tr.insertText('x', state.doc.content.size - 2)
      const next = state.apply(tr)
      const append = plugin.spec.appendTransaction
      if (!append) throw new Error('no appendTransaction')
      time(
        `40.5 appendTransaction  ${label}`,
        () => {
          append.call(plugin, [tr], state, next)
        },
        15,
        3,
      )
    }
  })
})
