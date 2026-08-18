import { parseHtml, serializeHtml } from '@openleaf/core'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { addColumnAfter, toggleHeaderRow } from '../src/index.js'

function stateIn(html: string, text: string): EditorState {
  const doc = parseHtml(html)
  let pos = 1
  doc.descendants((node, nodePos) => {
    if (node.isText && node.text === text) {
      pos = nodePos
      return false
    }
    return true
  })
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos),
  })
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state
  const ok = command(state, (tr: Transaction) => {
    next = state.apply(tr)
  })
  expect(ok).toBe(true)
  return next
}

describe('header cell scope', () => {
  it('drops scope when a header row becomes body cells', () => {
    const start = stateIn(
      '<table><tbody><tr><th scope="col">Region</th><th scope="col">Total</th></tr><tr><td>North</td><td>412</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, toggleHeaderRow).doc)
    expect(html).not.toContain('<th')
    expect(html).not.toMatch(/<td[^>]*scope/)
    expect(html).toContain('<td>Region</td>')
  })

  it('restores scope="col" when a body row becomes a header', () => {
    const start = stateIn(
      '<table><tbody><tr><td>Region</td><td>Total</td></tr><tr><td>North</td><td>412</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, toggleHeaderRow).doc)
    expect(html).toMatch(/<th scope="col">Region<\/th>/)
    expect(html).toMatch(/<th scope="col">Total<\/th>/)
  })

  it('gives a new header cell the same scope insertTable uses', () => {
    const start = stateIn(
      '<table><tbody><tr><th scope="col">Region</th></tr><tr><td>North</td></tr></tbody></table>',
      'Region',
    )
    const html = serializeHtml(apply(start, addColumnAfter).doc)
    expect(html.match(/<th scope="col">/g)?.length).toBe(2)
    expect(html).not.toMatch(/<th>/)
  })
})
