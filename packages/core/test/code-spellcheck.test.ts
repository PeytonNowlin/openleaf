/**
 * Where the code spellcheck decorations land, and where they must not.
 *
 * The whole point of doing this with decorations is that stored HTML is not
 * touched, so the round-trip assertion at the bottom is not a formality: it is
 * the test that fails if someone "simplifies" this into the schema's `toDOM`.
 */

import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { codeSpellcheckPlugin, coreSchema, parseHtml, serializeHtml } from '../src/index.js'

interface Found {
  from: number
  to: number
  spellcheck: string | undefined
  /** `Decoration.inline` vs `Decoration.node`, which is a getter on the decoration. */
  node: boolean
}

function stateFor(html: string): { state: EditorState; plugin: ReturnType<typeof codeSpellcheckPlugin> } {
  const schema = coreSchema()
  const plugin = codeSpellcheckPlugin()
  return {
    plugin,
    state: EditorState.create({ doc: parseHtml(html, { schema }), plugins: [plugin] }),
  }
}

function read(state: EditorState, plugin: ReturnType<typeof codeSpellcheckPlugin>): Found[] {
  // Bound to the plugin the state was built with, which is what `decorations`
  // declares as its `this`.
  const set = plugin.props.decorations?.call(plugin, state)
  const found =
    (set as { find(): Array<{ from: number; to: number; type: unknown }> } | undefined)?.find() ?? []
  return found.map((d) => ({
    from: d.from,
    to: d.to,
    spellcheck: (d.type as { attrs?: Record<string, string> }).attrs?.['spellcheck'],
    node: !(d as unknown as { inline: boolean }).inline,
  }))
}

function decorations(html: string): Found[] {
  const { state, plugin } = stateFor(html)
  return read(state, plugin)
}

describe('code blocks', () => {
  it('turns spellcheck off over the block', () => {
    const found = decorations('<pre><code>const getElementById = 1</code></pre>')
    expect(found).toHaveLength(1)
    expect(found[0]?.spellcheck).toBe('false')
    expect(found[0]?.node).toBe(true)
  })

  it('covers the whole node, opening and closing token included', () => {
    const doc = parseHtml('<pre><code>abc</code></pre>', { schema: coreSchema() })
    const block = doc.child(0)
    const found = decorations('<pre><code>abc</code></pre>')
    expect(found[0]).toMatchObject({ from: 0, to: block.nodeSize })
  })

  it('reaches a block nested in a blockquote', () => {
    const found = decorations('<blockquote><pre><code>abc</code></pre></blockquote>')
    expect(found).toHaveLength(1)
    expect(found[0]?.node).toBe(true)
  })
})

describe('inline code', () => {
  it('turns spellcheck off over a <code> run', () => {
    const found = decorations('<p>call <code>getElementById</code> here</p>')
    expect(found).toHaveLength(1)
    expect(found[0]?.spellcheck).toBe('false')
    expect(found[0]?.node).toBe(false)
  })

  it('covers the code text and nothing either side of it', () => {
    const doc = parseHtml('<p>call <code>xy</code> here</p>', { schema: coreSchema() })
    const found = decorations('<p>call <code>xy</code> here</p>')
    expect(doc.textBetween(found[0]?.from ?? 0, found[0]?.to ?? 0)).toBe('xy')
  })

  it('merges a run split into two text nodes by another mark', () => {
    // `<code>` holding a bold half is two ProseMirror text nodes and one DOM
    // element; two decorations would be two spans over one <code>.
    const found = decorations('<p><code>ab<strong>cd</strong></code></p>')
    expect(found).toHaveLength(1)
    const doc = parseHtml('<p><code>ab<strong>cd</strong></code></p>', { schema: coreSchema() })
    expect(doc.textBetween(found[0]?.from ?? 0, found[0]?.to ?? 0)).toBe('abcd')
  })

  it('keeps two separate runs separate', () => {
    expect(decorations('<p><code>a</code> and <code>b</code></p>')).toHaveLength(2)
  })

  it('leaves prose alone', () => {
    expect(decorations('<p>ordinary writing, spellchecked</p>')).toEqual([])
  })
})

describe('incremental rebuild', () => {
  /**
   * The bug this guards is not hypothetical: `DecorationSet.find` reports a
   * decoration that merely touches the queried range, so a code block ending
   * exactly where the next paragraph starts was removed as stale and never
   * rebuilt -- the attribute fell off the block above as soon as anyone typed
   * in the paragraph below it.
   */
  it('keeps the decoration on the block above the paragraph being typed in', () => {
    const { state, plugin } = stateFor('<pre><code>abc</code></pre><p>hi</p>')
    expect(read(state, plugin)).toHaveLength(1)

    const end = state.doc.content.size - 1
    const typed = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, end)).insertText('!', end),
    )
    const after = read(typed, plugin)
    expect(after).toHaveLength(1)
    expect(after[0]?.node).toBe(true)
    expect(after[0]).toMatchObject({ from: 0, to: state.doc.child(0).nodeSize })
  })

  it('decorates a code block created after the state was built', () => {
    const { state, plugin } = stateFor('<p>hi</p>')
    expect(read(state, plugin)).toEqual([])

    const schema = state.schema
    const block = schema.nodes['code_block']?.create(null, schema.text('abc'))
    if (!block) throw new Error('no code_block in the core schema')
    const inserted = state.apply(state.tr.replaceWith(0, state.doc.content.size, block))
    expect(read(inserted, plugin)).toHaveLength(1)
  })

  it('adds the decoration when the code mark is applied', () => {
    // A mark step moves no position, so its `StepMap` is empty. Reading the
    // maps alone, toggling `<code>` on a word looks like a transaction that
    // changed nothing, and the decoration never appeared until the author
    // typed somewhere in the same block.
    const { state, plugin } = stateFor('<p>abc</p>')
    expect(read(state, plugin)).toEqual([])

    const code = state.schema.marks['code']
    if (!code) throw new Error('no code mark in the core schema')
    const marked = state.apply(state.tr.addMark(1, 4, code.create()))
    expect(read(marked, plugin)).toMatchObject([{ from: 1, to: 4, spellcheck: 'false' }])
  })

  it('drops the decoration when the code mark is removed', () => {
    const { state, plugin } = stateFor('<p><code>abc</code></p>')
    expect(read(state, plugin)).toHaveLength(1)

    const code = state.schema.marks['code']
    if (!code) throw new Error('no code mark in the core schema')
    const stripped = state.apply(state.tr.removeMark(0, state.doc.content.size, code))
    expect(read(stripped, plugin)).toEqual([])
  })
})

describe('stored HTML', () => {
  it('never carries the attribute, which is why this is a decoration', () => {
    for (const html of [
      '<pre><code>abc</code></pre>',
      '<p><code>abc</code></p>',
      '<blockquote><pre><code>abc</code></pre></blockquote>',
    ]) {
      const { state } = stateFor(html)
      expect(serializeHtml(state.doc)).not.toContain('spellcheck')
    }
  })
})
