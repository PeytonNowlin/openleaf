import { TextSelection, EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { buildKeymap, coreSchema, parseHtml, serializeHtml, shortcutFor, shortcuts } from '../src/index.js'

function stateFrom(html: string, pos = 3): EditorState {
  const state = EditorState.create({ doc: parseHtml(html), schema: coreSchema() })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** Fire a binding by key string and return the resulting HTML. */
function press(state: EditorState, keys: string): string | null {
  const command = buildKeymap()[keys]
  if (!command) throw new Error(`no binding for ${keys}`)
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled && next ? serializeHtml(next.doc) : null
}

describe('the shortcut table', () => {
  it('has no duplicate labels pointing at different keys', () => {
    // Two shortcuts may share a KEY (Mod-y and Mod-Shift-z both redo), but a
    // label appearing twice with different keys means the tooltip and the help
    // dialog would disagree about what to tell the user.
    const byLabel = new Map<string, Set<string>>()
    for (const { label, keys } of shortcuts) {
      const set = byLabel.get(label) ?? new Set()
      set.add(keys)
      byLabel.set(label, set)
    }
    const ambiguous = [...byLabel].filter(([, keys]) => keys.size > 1).map(([label]) => label)
    expect(ambiguous).toEqual(['Redo'])
  })

  it('does not bind Tab, which would trap keyboard users', () => {
    // WCAG 2.1.2. Capturing Tab inside a contenteditable removes the only way
    // out of the editor. Indentation uses Mod-[ and Mod-] instead.
    const bindings = buildKeymap()
    expect(bindings['Tab']).toBeUndefined()
    expect(bindings['Shift-Tab']).toBeUndefined()
    expect(bindings['Mod-]']).toBeDefined()
    expect(bindings['Mod-[']).toBeDefined()
  })

  it('binds every shortcut it advertises', () => {
    const bindings = buildKeymap()
    for (const { keys } of shortcuts) {
      expect(bindings[keys], `missing binding for ${keys}`).toBeDefined()
    }
  })

  it('accepts custom overrides', () => {
    const noop = () => true
    expect(buildKeymap({ 'Mod-b': noop })['Mod-b']).toBe(noop)
  })
})

describe('bindings actually work', () => {
  it('Mod-Alt-2 makes a heading', () => {
    expect(press(stateFrom('<p>Title</p>'), 'Mod-Alt-2')).toBe('<h2>Title</h2>')
  })

  it('Mod-Shift-8 makes a bulleted list', () => {
    expect(press(stateFrom('<p>item</p>'), 'Mod-Shift-8')).toBe('<ul><li><p>item</p></li></ul>')
  })

  it('Mod-Shift-7 makes a numbered list', () => {
    expect(press(stateFrom('<p>item</p>'), 'Mod-Shift-7')).toBe('<ol><li><p>item</p></li></ol>')
  })

  it('Mod-Shift-. quotes a paragraph', () => {
    expect(press(stateFrom('<p>quote</p>'), 'Mod-Shift-.')).toBe(
      '<blockquote><p>quote</p></blockquote>',
    )
  })

  it('Mod-Alt-c makes a code block', () => {
    expect(press(stateFrom('<p>code</p>'), 'Mod-Alt-c')).toBe('<pre><code>code</code></pre>')
  })

  it('Enter splits a list item rather than making a paragraph', () => {
    // Without chaining splitListItem ahead of the base Enter, pressing Enter in
    // a list drops out of the list entirely.
    // Position 6 is the end of "one"; 5 would split mid-word, which is also
    // correct behaviour but not what this test is about.
    const out = press(stateFrom('<ul><li><p>one</p></li></ul>', 6), 'Enter')
    expect(out).toBe('<ul><li><p>one</p></li><li><p></p></li></ul>')
  })

  it('Enter still splits an ordinary paragraph', () => {
    expect(press(stateFrom('<p>ab</p>', 2), 'Enter')).toBe('<p>a</p><p>b</p>')
  })

  it('Shift-Enter inserts a line break', () => {
    expect(press(stateFrom('<p>ab</p>', 2), 'Shift-Enter')).toBe('<p>a<br>b</p>')
  })
})

describe('shortcutFor', () => {
  it('renders mac bindings with symbols and no separators', () => {
    expect(shortcutFor('Bold', true)).toBe('⌘b')
    expect(shortcutFor('Heading 2', true)).toBe('⌘⌥2')
  })

  it('renders non-mac bindings with Ctrl and plus signs', () => {
    expect(shortcutFor('Bold', false)).toBe('Ctrl+b')
    expect(shortcutFor('Bulleted list', false)).toBe('Ctrl+Shift+8')
  })

  it('returns null for an unknown label', () => {
    expect(shortcutFor('Teleport', false)).toBeNull()
  })
})
