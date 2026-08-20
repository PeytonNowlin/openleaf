import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { autolinkPlugin, coreSchema, hrefFromTypedUrl, parseHtml, serializeHtml } from '../src/index.js'

describe('hrefFromTypedUrl', () => {
  it('accepts http(s) and promotes www to https', () => {
    expect(hrefFromTypedUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(hrefFromTypedUrl('www.example.org')).toBe('https://www.example.org')
  })

  it('refuses javascript URLs', () => {
    expect(hrefFromTypedUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('autolinkPlugin', () => {
  it('turns a finished URL into a link when a space is typed', () => {
    const schema = coreSchema()
    let state = EditorState.create({
      doc: parseHtml('<p>See https://example.org</p>', { schema }),
      plugins: [autolinkPlugin()],
    })
    const end = state.doc.content.size - 1
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)))

    const view = {
      get state() {
        return state
      },
      dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
        state = state.apply(tr)
      },
    } as unknown as EditorView

    const plugin = autolinkPlugin()
    const handle = plugin.props.handleTextInput
    // Called on the plugin the handler belongs to, which is what it declares as
    // its `this`. The fifth argument is ProseMirror's default action; the plugin
    // ignores it and returns false so the space is still inserted normally.
    handle?.call(plugin, view, end, end, ' ', () => state.tr)
    expect(serializeHtml(state.doc)).toContain('<a href="https://example.org">')
  })
})
