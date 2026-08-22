import { history, undo } from 'prosemirror-history'
import { TextSelection, type Command, EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  activeHeadingLevel,
  activeLink,
  canInsert,
  coreSchema,
  insertHorizontalRule,
  insertImage,
  isolatingSelectionPlugin,
  isMarkActive,
  isNodeActive,
  parseHtml,
  serializeHtml,
  setLink,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  unsetLink,
} from '../src/index.js'

function stateFrom(html: string): EditorState {
  return EditorState.create({ doc: parseHtml(html), schema: coreSchema() })
}

/** Select the whole document's text content. */
function selectAll(state: EditorState): EditorState {
  const { doc } = state
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

/** Put the cursor at a position without selecting anything. */
function cursorAt(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** Run a command; returns the resulting state, or null when it declined. */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied ? next : null
}

function html(state: EditorState | null): string {
  if (!state) throw new Error('command declined to apply')
  return serializeHtml(state.doc)
}

describe('mark commands', () => {
  it('applies bold across a selection', () => {
    const state = selectAll(stateFrom('<p>hello</p>'))
    expect(html(run(state, toggleBold))).toBe('<p><strong>hello</strong></p>')
  })

  it('removes bold when the selection is already bold', () => {
    const state = selectAll(stateFrom('<p><strong>hello</strong></p>'))
    expect(html(run(state, toggleBold))).toBe('<p>hello</p>')
  })

  it('combines with other marks rather than replacing them', () => {
    const state = selectAll(stateFrom('<p><em>hello</em></p>'))
    expect(html(run(state, toggleBold))).toContain('<strong>')
    expect(html(run(state, toggleBold))).toContain('<em>')
  })

  it('leaves surrounding text alone', () => {
    let state = stateFrom('<p>keep bold keep</p>')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6, 10)))
    expect(html(run(state, toggleBold))).toBe('<p>keep <strong>bold</strong> keep</p>')
  })
})

describe('isMarkActive', () => {
  it('is false in plain text', () => {
    expect(isMarkActive(cursorAt(stateFrom('<p>plain</p>'), 3), 'strong')).toBe(false)
  })

  it('is true with the cursor inside a bold run', () => {
    expect(isMarkActive(cursorAt(stateFrom('<p><strong>bold</strong></p>'), 3), 'strong')).toBe(true)
  })

  it('is true across a fully bold selection', () => {
    expect(isMarkActive(selectAll(stateFrom('<p><strong>bold</strong></p>')), 'strong')).toBe(true)
  })

  it('respects storedMarks, so the button stays lit right after being pressed', () => {
    // Pressing Bold with no selection makes the mark *pending* rather than
    // applied. A toolbar that ignored storedMarks would show Bold as inactive
    // immediately after the user turned it on -- the most common toolbar bug.
    const state = cursorAt(stateFrom('<p>plain</p>'), 3)
    const toggled = run(state, toggleBold)
    expect(toggled).not.toBeNull()
    expect(isMarkActive(toggled!, 'strong')).toBe(true)
    // ...and the document is untouched, because nothing was selected.
    expect(serializeHtml(toggled!.doc)).toBe('<p>plain</p>')
  })
})

describe('heading commands', () => {
  it('converts a paragraph to a heading', () => {
    const state = cursorAt(stateFrom('<p>Title</p>'), 3)
    expect(html(run(state, toggleHeading(2)))).toBe('<h2>Title</h2>')
  })

  it('toggles back to a paragraph when applying the level already in use', () => {
    // Users expect a heading control to be a toggle even though setBlockType
    // alone is not one.
    const state = cursorAt(stateFrom('<h2>Title</h2>'), 3)
    expect(html(run(state, toggleHeading(2)))).toBe('<p>Title</p>')
  })

  it('switches between levels rather than toggling off', () => {
    const state = cursorAt(stateFrom('<h2>Title</h2>'), 3)
    expect(html(run(state, toggleHeading(3)))).toBe('<h3>Title</h3>')
  })

  it('reports the active level', () => {
    expect(activeHeadingLevel(cursorAt(stateFrom('<h4>x</h4>'), 2))).toBe(4)
    expect(activeHeadingLevel(cursorAt(stateFrom('<p>x</p>'), 2))).toBeNull()
  })

  it('does not treat a mixed heading/paragraph selection as uniformly heading', () => {
    const state = selectAll(stateFrom('<h2>A</h2><p>B</p>'))
    expect(isNodeActive(state, 'heading')).toBe(false)
    expect(activeHeadingLevel(state)).toBeNull()
    // Applying Heading 2 to a mixed range sets both blocks, rather than
    // unwrapping the heading because the control thought it was already on.
    expect(html(run(state, toggleHeading(2)))).toBe('<h2>A</h2><h2>B</h2>')
  })
})

describe('list commands', () => {
  it('wraps a paragraph in a bullet list', () => {
    const state = cursorAt(stateFrom('<p>item</p>'), 3)
    expect(html(run(state, toggleBulletList))).toBe('<ul><li>item</li></ul>')
  })

  it('unwraps an existing bullet list', () => {
    const state = cursorAt(stateFrom('<ul><li><p>item</p></li></ul>'), 4)
    expect(html(run(state, toggleBulletList))).toBe('<p>item</p>')
  })

  it('wraps in an ordered list', () => {
    const state = cursorAt(stateFrom('<p>item</p>'), 3)
    expect(html(run(state, toggleOrderedList))).toBe('<ol><li>item</li></ol>')
  })

  it('converts a bullet list to an ordered list', () => {
    const state = cursorAt(stateFrom('<ul><li><p>item</p></li></ul>'), 4)
    expect(html(run(state, toggleOrderedList))).toBe('<ol><li>item</li></ol>')
  })

  it('converts an ordered list to a bullet list', () => {
    const state = cursorAt(stateFrom('<ol><li><p>item</p></li></ol>'), 4)
    expect(html(run(state, toggleBulletList))).toBe('<ul><li>item</li></ul>')
  })

  it('reports list membership', () => {
    const inList = cursorAt(stateFrom('<ul><li><p>item</p></li></ul>'), 4)
    expect(isNodeActive(inList, 'bullet_list')).toBe(true)
    expect(isNodeActive(inList, 'ordered_list')).toBe(false)
  })
})

describe('block commands', () => {
  it('wraps in a blockquote and lifts back out', () => {
    const quoted = run(cursorAt(stateFrom('<p>quote me</p>'), 3), toggleBlockquote)
    expect(html(quoted)).toBe('<blockquote>quote me</blockquote>')

    const unquoted = run(cursorAt(quoted!, 4), toggleBlockquote)
    expect(html(unquoted)).toBe('<p>quote me</p>')
  })

  it('unwraps a quoted list without throwing', () => {
    // The previous lift targeted the paragraph inside the list item, which
    // `bullet_list` will not accept. Unwrapping has to replace the blockquote
    // itself, leaving the list intact.
    const state = cursorAt(
      stateFrom('<blockquote><ul><li><p>item</p></li></ul></blockquote>'),
      5,
    )
    expect(html(run(state, toggleBlockquote))).toBe('<ul><li>item</li></ul>')
  })

  it('does not throw when a selection spans a quote into details (#130)', () => {
    let state = EditorState.create({
      doc: parseHtml(
        '<blockquote><p>quote</p></blockquote><details open><summary>s</summary><p>body</p></details>',
      ),
      plugins: [history(), isolatingSelectionPlugin()],
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 12)))
    expect(() => {
      state = state.apply(state.tr.insertText('X'))
    }).not.toThrow()
    expect(html(state)).toContain('<p>body</p></details>')
    let undone: EditorState | null = null
    undo(state, (tr) => {
      undone = state.apply(tr)
    })
    expect(html(undone)).toBe(
      serializeHtml(
        parseHtml(
          '<blockquote><p>quote</p></blockquote><details open><summary>s</summary><p>body</p></details>',
        ),
      ),
    )
  })

  it('toggles a code block on and off', () => {
    const code = run(cursorAt(stateFrom('<p>const x = 1</p>'), 3), toggleCodeBlock)
    expect(html(code)).toBe('<pre><code>const x = 1</code></pre>')

    const back = run(cursorAt(code!, 3), toggleCodeBlock)
    expect(html(back)).toBe('<p>const x = 1</p>')
  })

  it('inserts a horizontal rule', () => {
    const state = cursorAt(stateFrom('<p>above</p>'), 6)
    expect(html(run(state, insertHorizontalRule))).toContain('<hr>')
  })
})

describe('links', () => {
  it('applies a link to the selection', () => {
    const state = selectAll(stateFrom('<p>docs</p>'))
    const out = html(run(state, setLink({ href: 'https://example.org' })))
    expect(out).toBe('<p><a href="https://example.org">docs</a></p>')
  })

  it('declines on an empty selection rather than creating an empty link', () => {
    const state = cursorAt(stateFrom('<p>docs</p>'), 3)
    expect(run(state, setLink({ href: 'https://example.org' }))).toBeNull()
  })

  it('replaces an existing link instead of nesting or splitting it', () => {
    // Updating a link that only partially overlaps the selection must not
    // leave two adjacent links with different hrefs.
    const state = selectAll(stateFrom('<p><a href="https://old.example">docs</a></p>'))
    const out = html(run(state, setLink({ href: 'https://new.example' })))
    expect(out).toBe('<p><a href="https://new.example">docs</a></p>')
    expect(out).not.toContain('old.example')
  })

  it('removes a link', () => {
    const state = selectAll(stateFrom('<p><a href="https://example.org">docs</a></p>'))
    expect(html(run(state, unsetLink))).toBe('<p>docs</p>')
  })

  it('reports the active link attributes', () => {
    const state = cursorAt(stateFrom('<p><a href="https://example.org" title="T">docs</a></p>'), 3)
    expect(activeLink(state)).toMatchObject({ href: 'https://example.org', title: 'T' })
    expect(activeLink(cursorAt(stateFrom('<p>plain</p>'), 3))).toBeNull()
  })
})

describe('images', () => {
  it('inserts an image with alt text', () => {
    const state = cursorAt(stateFrom('<p>x</p>'), 2)
    const out = html(run(state, insertImage({ src: '/a.png', alt: 'A chart' })))
    expect(out).toContain('src="/a.png"')
    expect(out).toContain('alt="A chart"')
  })

  it('keeps an explicitly empty alt, which means decorative', () => {
    const state = cursorAt(stateFrom('<p>x</p>'), 2)
    expect(html(run(state, insertImage({ src: '/a.png', alt: '' })))).toContain('alt=""')
  })

  it('omits alt entirely when none is given, which means undescribed', () => {
    // An absent alt and alt="" are different statements to a screen reader.
    const state = cursorAt(stateFrom('<p>x</p>'), 2)
    expect(html(run(state, insertImage({ src: '/a.png' })))).not.toContain('alt=')
  })
})

describe('canInsert', () => {
  it('permits an image inside a paragraph', () => {
    expect(canInsert(cursorAt(stateFrom('<p>x</p>'), 2), 'image')).toBe(true)
  })

  it('refuses an image inside a code block, where inline nodes are not allowed', () => {
    expect(canInsert(cursorAt(stateFrom('<pre><code>x</code></pre>'), 2), 'image')).toBe(false)
  })
})
