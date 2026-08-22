import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { autolinkPlugin, coreSchema, hrefFromTypedUrl, parseHtml, serializeHtml } from '../src/index.js'

function htmlAfterAutolinkSpace(html: string): string {
  const schema = coreSchema()
  let state = EditorState.create({
    doc: parseHtml(html, { schema }),
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
  return serializeHtml(state.doc)
}

describe('hrefFromTypedUrl', () => {
  it('accepts http(s) and promotes www to https', () => {
    expect(hrefFromTypedUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(hrefFromTypedUrl('www.example.org')).toBe('https://www.example.org')
  })

  it('strips prose punctuation and unmatched closers from the href', () => {
    expect(hrefFromTypedUrl('www.example.com.')).toBe('https://www.example.com')
    expect(hrefFromTypedUrl('https://example.com,')).toBe('https://example.com')
    expect(hrefFromTypedUrl('www.example.com]')).toBe('https://www.example.com')
    expect(hrefFromTypedUrl('www.example.com)')).toBe('https://www.example.com')
  })

  it('keeps a balanced parenthesis that is part of the path', () => {
    expect(hrefFromTypedUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('refuses javascript URLs', () => {
    expect(hrefFromTypedUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('autolinkPlugin', () => {
  it('turns a finished URL into a link when a space is typed', () => {
    expect(htmlAfterAutolinkSpace('<p>See https://example.org</p>')).toContain(
      '<a href="https://example.org">',
    )
  })

  it('marks the trimmed URL, not the sentence punctuation after it', () => {
    expect(htmlAfterAutolinkSpace('<p>Visit www.example.com.</p>')).toBe(
      '<p>Visit <a href="https://www.example.com">www.example.com</a>.</p>',
    )
    expect(htmlAfterAutolinkSpace('<p>See https://example.com,</p>')).toBe(
      '<p>See <a href="https://example.com">https://example.com</a>,</p>',
    )
  })

  it('does not put a wrapping bracket into the href or the mark', () => {
    expect(htmlAfterAutolinkSpace('<p>see [www.example.com]</p>')).toBe(
      '<p>see [<a href="https://www.example.com">www.example.com</a>]</p>',
    )
  })

  it('autolinks a URL wrapped in parentheses', () => {
    expect(htmlAfterAutolinkSpace('<p>ref (www.example.com)</p>')).toBe(
      '<p>ref (<a href="https://www.example.com">www.example.com</a>)</p>',
    )
  })

  it('keeps a balanced closing paren that belongs to the path', () => {
    expect(htmlAfterAutolinkSpace('<p>https://en.wikipedia.org/wiki/Foo_(bar)</p>')).toBe(
      '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">https://en.wikipedia.org/wiki/Foo_(bar)</a></p>',
    )
  })
})
