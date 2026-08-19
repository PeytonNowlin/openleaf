import { TextSelection, EditorState, type Command } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'

/**
 * A characterization test over the public surface of @openleaf-editor/core.
 *
 * Written immediately before the schema-extensibility refactor, and its whole
 * purpose is to be boring. It asserts what integrators can currently rely on, so
 * that a refactor which changes how the schema is constructed can be shown NOT
 * to have changed what the package does.
 *
 * A test like this earns its keep exactly once. If the refactor breaks something
 * here, that is a conversation about whether the break is intended -- not a
 * surprise discovered by a user later.
 */

const EXPECTED_EXPORTS = [
  // schema and HTML I/O.
  // `schema` was DELETED rather than deprecated: a retained const typechecks and
  // then fails in the field, because a node built from one schema instance is
  // rejected by a document built from another.
  'baseSchema', 'coreNodes', 'coreMarks', 'parseHtml', 'serializeHtml', 'roundTrip',
  // schema extensions
  'createSchema', 'coreSchema', 'registerSchemaExtension', 'registeredSchemaExtensions',
  'onSchemaExtensionsChange', 'clearSchemaExtensions', 'CARRIED_ATTR',
  // preservation
  'isLosslesslyUnwrappable', 'unknownBlock', 'unknownInline',
  // url safety
  'isSafeUrl', 'safeUrlOrNull', 'isEventHandlerAttribute', 'URL_ATTRIBUTES',
  // css safety -- the vocabulary alignment and colour are allowed to write, which
  // @openleaf-editor/sanitize mirrors in its policy and pins with a test
  'ALIGNMENTS', 'MODELLED_PROPERTIES', 'COLOUR_PROPERTIES', 'safeAlign', 'safeColor',
  'parseDeclarations', 'serializeDeclarations', 'isFullyModelledStyle',
  // embed allowlist and class/id tokens
  'EMBED_HOSTS', 'isAllowedEmbedSrc', 'safeAllowList', 'safeEmbedSrc',
  'IMAGE_ALIGNMENTS', 'IMAGE_ALIGN_CLASS', 'IMAGE_ALIGN_CLASSES', 'imageAlignFromClass',
  'safeClassList', 'safeId',
  // predicates
  'isMarkActive', 'isNodeActive', 'canInsert', 'activeHeadingLevel', 'activeLink',
  'canUndo', 'canRedo', 'activeTextAlign', 'activeTextColor', 'activeBackgroundColor',
  // mark commands
  'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike', 'toggleInlineCode',
  'setTextColor', 'setBackgroundColor', 'clearTextColor', 'clearBackgroundColor',
  // block commands
  'setParagraph', 'setHeading', 'toggleHeading', 'toggleCodeBlock', 'toggleBlockquote',
  'wrapInBlockquote', 'insertHorizontalRule', 'setTextAlign', 'toggleTextAlign',
  // lists
  'toggleBulletList', 'toggleOrderedList', 'splitListItemCommand',
  'indentListItem', 'outdentListItem',
  // links and images
  'setLink', 'unsetLink', 'insertImage',
  'insertAudio', 'insertDetails', 'insertHtml', 'insertIframe', 'insertNamedAnchor',
  'insertNonBreakingSpace', 'insertPageBreak', 'insertText', 'insertVideo', 'setHeadingId',
  // history
  'undo', 'redo',
  // keymap
  'buildKeymap', 'shortcuts', 'shortcutFor',
  // plugin registry
  'registerEditorPlugin', 'createRegisteredPlugins', 'onEditorPluginsChange',
  // table nodes
  'table', 'table_row', 'table_cell', 'table_header',
] as const

describe('the public surface', () => {
  it('exports everything integrators currently import', () => {
    const missing = EXPECTED_EXPORTS.filter((name) => !(name in core))
    expect(missing).toEqual([])
  })

  it('has not quietly grown exports nobody decided to support', () => {
    // A new export is a new promise. This fails on addition so the addition is
    // deliberate, and the fix is to add the name above once it is intended.
    const unexpected = Object.keys(core).filter(
      (name) => !(EXPECTED_EXPORTS as readonly string[]).includes(name),
    )
    expect(unexpected).toEqual([])
  })
})

describe('the schema an integrator sees', () => {
  it('contains the documented node types', () => {
    const nodes = Object.keys(core.coreSchema().nodes).sort()
    expect(nodes).toEqual(
      [
        'blockquote', 'bullet_list', 'code_block', 'doc', 'hard_break', 'heading',
        'horizontal_rule', 'image', 'list_item', 'ordered_list', 'paragraph',
        'table', 'table_cell', 'table_header', 'table_row', 'text',
        'unknown_block', 'unknown_inline',
        'audio', 'details', 'figcaption', 'figure', 'iframe', 'named_anchor',
        'page_break', 'summary', 'video',
      ].sort(),
    )
  })

  it('contains the documented marks', () => {
    expect(Object.keys(core.coreSchema().marks).sort()).toEqual(
      [
        'code', 'em', 'link', 'strike', 'strong', 'underline',
        // Colour is two marks, not one: foreground and background are set
        // independently, and a single mark holding both would have each command
        // reset the other's value.
        'text_color', 'background_color',
      ].sort(),
    )
  })
})

/* ------------------------------------------------------------------ *
 * Behaviour, expressed through the public API only
 * ------------------------------------------------------------------ */

function stateFrom(html: string, pos = 3): EditorState {
  const state = EditorState.create({ doc: core.parseHtml(html), schema: core.coreSchema() })
  // Clamp: a fixed default position falls outside a one-character document, and
  // a command declining because the caret was out of range looks exactly like a
  // command that is broken.
  const clamped = Math.max(1, Math.min(pos, state.doc.content.size - 1))
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, clamped)))
}

function selectAll(state: EditorState): EditorState {
  const { doc } = state
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

function run(state: EditorState, command: Command): string | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied && next ? core.serializeHtml((next as EditorState).doc) : null
}

describe('round-trip behaviour', () => {
  const cases: Array<[string, string]> = [
    ['paragraph', '<p>text</p>'],
    ['heading with dir', '<h2 dir="rtl">عنوان</h2>'],
    ['marks', '<p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code></p>'],
    ['link', '<p><a href="https://example.org" title="T">x</a></p>'],
    ['image with empty alt', '<p><img src="/a.png" alt=""></p>'],
    ['nested list', '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>'],
    ['ordered list start', '<ol start="3"><li><p>a</p></li></ol>'],
    ['blockquote', '<blockquote><p>q</p></blockquote>'],
    ['code block', '<pre><code>x = 1</code></pre>'],
    ['horizontal rule', '<hr>'],
    ['preserved wrapper', '<div class="callout" data-id="7"><p>p</p></div>'],
    ['custom element', '<drupal-media data-entity-uuid="abc"></drupal-media>'],
    ['legacy font', '<p><font face="Verdana">old</font></p>'],
    ['table with legacy attrs', '<table border="1"><tbody><tr><th scope="col">H</th></tr></tbody></table>'],
    ['bare cell text', '<table><tbody><tr><td>A</td></tr></tbody></table>'],
  ]

  for (const [name, html] of cases) {
    it(`${name} survives unchanged`, () => {
      expect(core.roundTrip(html)).toBe(html)
    })
  }
})

describe('security behaviour', () => {
  const dropped: Array<[string, string, RegExp]> = [
    ['script', '<p>ok</p><script>alert(1)</script>', /script/i],
    ['iframe', '<p>ok</p><iframe src="x"></iframe>', /iframe/i],
    ['form', '<form action="/x"><input></form>', /form|input/i],
    ['event handler', '<div class="k" onclick="alert(1)">t</div>', /onclick/i],
    ['javascript href', '<p><a href="javascript:alert(1)">x</a></p>', /javascript:/i],
  ]
  for (const [name, html, pattern] of dropped) {
    it(`drops ${name}`, () => {
      expect(core.roundTrip(html)).not.toMatch(pattern)
    })
  }
})

describe('command behaviour', () => {
  it('toggleBold applies a mark', () => {
    expect(run(selectAll(stateFrom('<p>x</p>')), core.toggleBold)).toBe('<p><strong>x</strong></p>')
  })

  it('toggleHeading is a real toggle', () => {
    expect(run(stateFrom('<h2>T</h2>'), core.toggleHeading(2))).toBe('<p>T</p>')
  })

  it('toggleBulletList wraps and unwraps', () => {
    expect(run(stateFrom('<p>i</p>'), core.toggleBulletList)).toBe('<ul><li><p>i</p></li></ul>')
  })

  it('setLink replaces rather than nests', () => {
    const out = run(
      selectAll(stateFrom('<p><a href="https://old.example">x</a></p>')),
      core.setLink({ href: 'https://new.example' }),
    )
    expect(out).toBe('<p><a href="https://new.example">x</a></p>')
  })

  it('insertImage keeps an absent alt distinct from an empty one', () => {
    expect(run(stateFrom('<p>x</p>', 2), core.insertImage({ src: '/a.png' }))).not.toContain('alt=')
    expect(run(stateFrom('<p>x</p>', 2), core.insertImage({ src: '/a.png', alt: '' }))).toContain('alt=""')
  })

  it('isMarkActive respects storedMarks', () => {
    const state = stateFrom('<p>plain</p>')
    let next: EditorState | null = null
    core.toggleBold(state, (tr) => {
      next = state.apply(tr)
    })
    expect(core.isMarkActive(next as unknown as EditorState, 'strong')).toBe(true)
  })

  it('buildKeymap works with no editor state in existence', () => {
    // Called at plugin-construction time, before any EditorState exists. Any
    // refactor that makes commands depend on a live state must keep this true.
    const bindings = core.buildKeymap()
    expect(typeof bindings['Mod-b']).toBe('function')
    expect(bindings['Tab']).toBeUndefined()
  })
})

describe('explicit Document option', () => {
  it('serializes preserved nodes without a global document', () => {
    const html = '<div class="callout" data-id="7"><p>p</p></div>'
    const node = core.parseHtml(html)
    const held = document
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    // Simulate a Node serialize that was given `{ document }` and has no
    // global. The option used to be ignored for preserved atoms.
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    try {
      expect(core.serializeHtml(node, { document: held })).toBe(html)
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'document', originalDescriptor)
      else globalThis.document = held
    }
  })
})
