/**
 * Where the visual-aid decorations actually land.
 *
 * These are view-only marks, so nothing about them shows up in a round-trip
 * test: a decoration on the wrong character serializes exactly like a decoration
 * on the right one.
 */

import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { coreSchema, parseHtml, visualAidsPlugin } from '../src/index.js'

/** The ranges the plugin decorates, paired with the class it used. */
function decorations(html: string): Array<{ from: number; to: number; className: string }> {
  const schema = coreSchema()
  const state = EditorState.create({
    doc: parseHtml(html, { schema }),
    plugins: [visualAidsPlugin()],
  })
  const set = visualAidsPlugin().props.decorations?.call(
    { getState: () => undefined },
    state,
  )
  const found = (set as { find(): Array<{ from: number; to: number; type: unknown }> } | undefined)
    ?.find() ?? []
  return found.map((d) => ({
    from: d.from,
    to: d.to,
    className: String((d.type as { attrs?: { class?: string } }).attrs?.class ?? ''),
  }))
}

/** The characters a decoration actually covers. */
function covered(html: string, className: string): string[] {
  const doc = parseHtml(html, { schema: coreSchema() })
  return decorations(html)
    .filter((d) => d.className === className)
    .map((d) => doc.textBetween(d.from, d.to))
}

describe('non-breaking space decorations', () => {
  // `pos` already addresses the first character of a text node -- there is no
  // opening token to step over. Adding one marked the character *after* each
  // nbsp, so the aid pointed at the wrong glyph.
  it('marks the nbsp itself, not the character after it', () => {
    expect(covered('<p>a&nbsp;b</p>', 'ol-nbsp')).toEqual([' '])
  })

  it('marks a leading nbsp', () => {
    expect(covered('<p>&nbsp;ab</p>', 'ol-nbsp')).toEqual([' '])
  })

  // A trailing one produced a range past the end of the text node, where the
  // decoration was dropped altogether.
  it('marks a trailing nbsp', () => {
    expect(covered('<p>ab&nbsp;</p>', 'ol-nbsp')).toEqual([' '])
  })

  it('marks every nbsp in a run', () => {
    expect(covered('<p>a&nbsp;&nbsp;b</p>', 'ol-nbsp')).toEqual([' ', ' '])
  })

  it('marks nothing when there is no nbsp', () => {
    expect(covered('<p>plain text</p>', 'ol-nbsp')).toEqual([])
  })
})

describe('other visual aids', () => {
  it('marks an empty block', () => {
    const found = decorations('<p></p>').filter((d) => d.className === 'ol-empty-block')
    expect(found).toHaveLength(1)
  })
})
