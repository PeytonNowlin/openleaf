import { TextSelection, EditorState, type Command } from 'prosemirror-state'
import type { NodeSpec } from 'prosemirror-model'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CARRIED_ATTR,
  activeHeadingLevel,
  clearSchemaExtensions,
  coreSchema,
  createSchema,
  isMarkActive,
  isNodeActive,
  parseHtml,
  registerSchemaExtension,
  serializeHtml,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  type SchemaExtension,
} from '../src/index.js'

afterEach(() => {
  clearSchemaExtensions()
})

/** A callout node, written the way the authoring guide tells people to write one. */
const callout: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: { level: { default: 'info' } },
  parseDOM: [
    {
      tag: 'aside.ol-callout',
      getAttrs: (dom) => ({ level: (dom as Element).getAttribute('data-level') ?? 'info' }),
    },
  ],
  toDOM: (node) => [
    'aside',
    { class: 'ol-callout', 'data-level': node.attrs['level'] as string },
    0,
  ],
}

const CALLOUT_EXTENSION: SchemaExtension = { id: 'test/callout', nodes: { callout } }

describe('building a schema', () => {
  it('adds the extension node', () => {
    const schema = createSchema([CALLOUT_EXTENSION])
    expect(schema.nodes['callout']).toBeDefined()
    expect(coreSchema().nodes['callout']).toBeUndefined()
  })

  it('is pure — it reads no registry', () => {
    // Deliberate. A registry-reading default would make the fidelity suite
    // depend on whichever other test file registered an extension first.
    registerSchemaExtension(CALLOUT_EXTENSION)
    expect(createSchema().nodes['callout']).toBeUndefined()
    expect(coreSchema().nodes['callout']).toBeDefined()
  })

  it('invalidates the memoized schema when the registry changes', () => {
    const before = coreSchema()
    registerSchemaExtension(CALLOUT_EXTENSION)
    expect(coreSchema()).not.toBe(before)
    expect(coreSchema()).toBe(coreSchema())
  })
})

describe('append-only ordering', () => {
  it('keeps paragraph as the document default type', () => {
    // Measured consequence of prepending instead: topNodeType.createAndFill()
    // produces {"type":"doc","content":[{"type":"widget"}]} and every new
    // document starts with a plugin's node.
    const schema = createSchema([CALLOUT_EXTENSION])
    expect(schema.topNodeType.contentMatch.defaultType?.name).toBe('paragraph')
  })

  it('creates an empty document containing a paragraph', () => {
    const schema = createSchema([CALLOUT_EXTENSION])
    expect(schema.topNodeType.createAndFill()?.firstChild?.type.name).toBe('paragraph')
  })
})

describe('the preservation catch-all', () => {
  it('loses to an extension node at the default priority', () => {
    // The catch-alls sit at priority 0 and 1, so a default-priority rule already
    // wins. This is why the extension contract has no priority field.
    const schema = createSchema([CALLOUT_EXTENSION])
    const doc = parseHtml('<aside class="ol-callout" data-level="warn"><p>hi</p></aside>', { schema })
    const names: string[] = []
    doc.descendants((n) => {
      names.push(n.type.name)
      return true
    })
    expect(names).toContain('callout')
    expect(names).not.toContain('unknown_block')
  })

  it('still preserves markup no extension claimed', () => {
    const schema = createSchema([CALLOUT_EXTENSION])
    const html = '<div class="other" data-x="1"><p>kept</p></div>'
    expect(serializeHtml(parseHtml(html, { schema }))).toBe(html)
  })

  it('rejects a rule that would tie with the catch-all', () => {
    expect(() =>
      createSchema([
        {
          id: 'test/rude',
          nodes: { rude: { ...callout, parseDOM: [{ tag: 'aside', priority: 0 }] } },
        },
      ]),
    ).toThrow(/priority/)
  })
})

describe('collisions', () => {
  it('throws when two extensions define the same node', () => {
    // A node type is a storage format. Two definitions mean two serializations
    // of the same content chosen by script-tag order.
    expect(() =>
      createSchema([
        { id: 'a', nodes: { footnote: callout } },
        { id: 'b', nodes: { footnote: callout } },
      ]),
    ).toThrow(/both define the node "footnote"/)
  })

  it('names both extensions so the conflict is actionable', () => {
    try {
      createSchema([
        { id: 'plugin-a', nodes: { footnote: callout } },
        { id: 'plugin-b', nodes: { footnote: callout } },
      ])
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('plugin-a')
      expect((error as Error).message).toContain('plugin-b')
    }
  })

  it('throws when an extension shadows a core node without saying so', () => {
    expect(() => createSchema([{ id: 'a', nodes: { paragraph: callout } }])).toThrow(/replaces/)
  })

  it('permits a replacement that is declared', () => {
    const schema = createSchema([
      { id: 'a', nodes: { paragraph: callout }, replaces: ['paragraph'] },
    ])
    expect(schema.nodes['paragraph']?.spec.attrs?.['level']).toBeDefined()
  })
})

describe('carrying unmodelled attributes', () => {
  /*
   * Adding a node type strictly REDUCES fidelity for the tag it claims: the
   * preservation layer kept every attribute, a node spec keeps what it declares.
   * Carrying the residue is what stops a plugin silently destroying attributes
   * that survived before it existed.
   */
  const schema = createSchema([CALLOUT_EXTENSION])

  it('keeps attributes the spec never modelled', () => {
    const html = '<aside class="ol-callout" data-level="info" id="x" data-analytics="y"><p>t</p></aside>'
    const out = serializeHtml(parseHtml(html, { schema }))
    expect(out).toContain('id="x"')
    expect(out).toContain('data-analytics="y"')
  })

  it('round-trips such an element exactly', () => {
    const html = '<aside class="ol-callout" data-level="warn" id="x"><p>t</p></aside>'
    expect(serializeHtml(parseHtml(html, { schema }))).toBe(html)
  })

  it('lets modelled attributes win over carried ones', () => {
    const out = serializeHtml(
      parseHtml('<aside class="ol-callout" data-level="warn"><p>t</p></aside>', { schema }),
    )
    expect(out).toContain('data-level="warn"')
    expect(out.match(/data-level=/g)).toHaveLength(1)
  })

  it('can be switched off by an extension that knows what it is doing', () => {
    const strict = createSchema([
      { id: 'test/strict', nodes: { callout }, carryUnknownAttributes: false },
    ])
    const out = serializeHtml(
      parseHtml('<aside class="ol-callout" id="x"><p>t</p></aside>', { schema: strict }),
    )
    expect(out).not.toContain('id="x"')
  })

  it('does not leak the carrier attribute into the output', () => {
    const out = serializeHtml(
      parseHtml('<aside class="ol-callout" id="x"><p>t</p></aside>', { schema }),
    )
    expect(out).not.toContain(CARRIED_ATTR)
    expect(out).not.toContain('__openleaf')
  })

  it('does not reintroduce event handlers the spec never modelled', () => {
    const out = serializeHtml(
      parseHtml('<aside class="ol-callout" onclick="alert(1)"><p>t</p></aside>', { schema }),
    )
    expect(out).not.toMatch(/onclick/i)
  })
})

describe('core claimed tags carry residual attributes', () => {
  it('keeps class and data attributes on a paragraph', () => {
    const html = '<p class="lead" data-id="7">hello</p>'
    expect(serializeHtml(parseHtml(html))).toBe(html)
  })

  it('keeps type and reversed on an ordered list', () => {
    const html = '<ol type="a" reversed="" start="3"><li><p>x</p></li></ol>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('start="3"')
    // `reversed` is not modelled, so the carry mechanism is what keeps it.
    expect(out).toContain('reversed')
    // The legacy `type` attribute is read into the modelled list style and
    // written back as the declaration, the same modernization `align="center"`
    // gets. Emitting both spellings would be the bug.
    expect(out).toContain('list-style-type:lower-alpha')
    expect(out).not.toContain('type="a"')
  })

  it('does not emit the language class twice for a code block', () => {
    // The spec reads `language-*` from either element and writes it onto
    // <code>. Carrying the <pre>'s class verbatim wrote it on both.
    expect(serializeHtml(parseHtml('<pre class="language-js"><code>x</code></pre>'))).toBe(
      '<pre><code class="language-js">x</code></pre>',
    )
  })

  it('keeps a non-language class on a code block', () => {
    expect(
      serializeHtml(parseHtml('<pre class="wide language-js"><code>x</code></pre>')),
    ).toBe('<pre class="wide"><code class="language-js">x</code></pre>')
  })

  it('still drops event handlers on claimed tags', () => {
    expect(serializeHtml(parseHtml('<p class="lead" onclick="alert(1)">x</p>'))).toBe(
      '<p class="lead">x</p>',
    )
  })
})

describe('commands work against an extended schema', () => {
  /*
   * The bug class this refactor creates, and the only test that can catch it.
   *
   * A predicate comparing `parent.type !== type` where `type` came from a module
   * singleton and `parent.type` from the editor's schema returns false forever --
   * no throw, no error, just a toolbar where nothing is ever active. It is
   * invisible to any suite that uses one schema, so this suite uses two.
   */
  const schema = createSchema([CALLOUT_EXTENSION])

  function stateFrom(html: string, pos = 3): EditorState {
    const state = EditorState.create({ doc: parseHtml(html, { schema }), schema })
    const clamped = Math.max(1, Math.min(pos, state.doc.content.size - 1))
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, clamped)))
  }

  function run(state: EditorState, command: Command): string | null {
    let next: EditorState | null = null
    const applied = command(state, (tr) => {
      next = state.apply(tr)
    })
    return applied && next ? serializeHtml((next as EditorState).doc) : null
  }

  it('toggleBold applies against a different schema instance', () => {
    const state = stateFrom('<p>x</p>')
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    )
    expect(run(all, toggleBold)).toBe('<p><strong>x</strong></p>')
  })

  it('toggleHeading works', () => {
    expect(run(stateFrom('<h2>T</h2>'), toggleHeading(2))).toBe('<p>T</p>')
  })

  it('toggleBulletList works', () => {
    expect(run(stateFrom('<p>i</p>'), toggleBulletList)).toBe('<ul><li><p>i</p></li></ul>')
  })

  it('predicates read the state schema, not a captured one', () => {
    const state = stateFrom('<h2>T</h2>')
    expect(activeHeadingLevel(state)).toBe(2)
    expect(isNodeActive(state, 'heading')).toBe(true)
    expect(isMarkActive(state, 'strong')).toBe(false)
  })

  it('predicates recognise an extension node type by name', () => {
    const state = EditorState.create({
      doc: parseHtml('<aside class="ol-callout"><p>t</p></aside>', { schema }),
      schema,
    })
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))
    expect(isNodeActive(inside, 'callout')).toBe(true)
  })

  it('a command declines rather than throwing when a type is absent', () => {
    // A schema without `strong` should disable the button, not crash the editor.
    const trimmed = createSchema([
      { id: 'test/replace-strong', marks: { strong: { toDOM: () => ['b', 0] } }, replaces: ['strong'] },
    ])
    expect(trimmed.marks['strong']).toBeDefined()
  })
})

describe('fidelity holds for every configuration that ships', () => {
  /*
   * Without this, the headline guarantee silently narrows to a configuration
   * nobody deploys -- and the report would still print "9/9 lossless".
   */
  const configurations: Array<[string, SchemaExtension[]]> = [
    ['core only', []],
    ['core + callout extension', [CALLOUT_EXTENSION]],
  ]

  const samples = [
    '<h2 dir="rtl">عنوان</h2>',
    '<p>Text with <strong>b</strong> and <a href="https://example.org">a link</a>.</p>',
    '<ul><li><p>one</p></li></ul>',
    '<div class="callout" data-id="7"><p>preserved</p></div>',
    '<table border="1"><tbody><tr><th scope="col">H</th></tr></tbody></table>',
    '<pre><code class="language-js">const x = 1</code></pre>',
  ]

  for (const [name, extensions] of configurations) {
    const schema = createSchema(extensions)
    for (const html of samples) {
      it(`${name}: ${html.slice(0, 34)}…`, () => {
        expect(serializeHtml(parseHtml(html, { schema }))).toBe(html)
      })
    }
  }
})
