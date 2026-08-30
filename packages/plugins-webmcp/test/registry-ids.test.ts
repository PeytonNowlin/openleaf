/**
 * Two live editors must never answer to one name.
 *
 * The identifier is the whole of an agent's addressing: every call after
 * `openleaf_list_editors` names an editor by it, and `findEditor` returns the
 * first match. A collision is therefore not a cosmetic duplicate in a listing --
 * it silently aims a write at the wrong document and reports `{"ok":true}`.
 *
 * Each test imports a fresh copy of the register. The ordinal counter is
 * module-global and deliberately never reset, so that a removed editor's name
 * cannot be handed to a new one; that also means a test sharing the module with
 * the tests before it cannot say which ordinal comes next, and the collision
 * being pinned here is exactly a collision between an ordinal and an id.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Registry = typeof import('../src/registry.js')

let registry: Registry
const views: EditorView[] = []

beforeEach(async () => {
  vi.resetModules()
  registry = await import('../src/registry.js')
})

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

/** An editor with the given `id` attribute; pass `''` for one with none. */
function editor(id: string, html = '<p>x</p>'): EditorView {
  const host = document.createElement('openleaf-editor')
  if (id !== '') host.id = id
  document.body.appendChild(host)
  const mount = document.createElement('div')
  host.appendChild(mount)

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [registry.agentRegistry()],
    }),
  })
  views.push(view)
  return view
}

const ids = (): string[] => registry.listEditors().map((editor) => editor.id)

describe('identifiers', () => {
  it('uses the id attribute when there is one', () => {
    editor('post')
    expect(ids()).toEqual(['post'])
  })

  it('falls back to an ordinal when there is none', () => {
    editor('')
    editor('')
    expect(ids()).toEqual(['editor-1', 'editor-2'])
  })

  it('counts every editor, so the ordinal is a position on the page', () => {
    // Not "the second editor that happened to be missing an id".
    editor('post')
    editor('')
    expect(ids()).toEqual(['post', 'editor-2'])
  })

  it('refuses to hand one id attribute to two editors', () => {
    editor('post')
    editor('post')
    expect(ids()).toEqual(['post', 'editor-2'])
  })

  /**
   * The collision the attribute check alone did not cover: `editor-2` is a
   * perfectly ordinary integrator id -- the README documents that spelling as
   * what the fallback produces -- so an editor claiming it by attribute and the
   * editor that is simply second on the page were handed the same name. Both
   * then answered to it, and a write aimed at one landed in the other.
   */
  it('does not hand an ordinal to an editor whose id attribute already claimed it', () => {
    editor('editor-2')
    editor('')
    expect(ids()).toEqual(['editor-2', 'editor-3'])
  })

  it('resolves each of those two editors to its own document', () => {
    const body = editor('editor-2', '<p>body</p>')
    const comments = editor('', '<p>comments</p>')
    expect(registry.findEditor('editor-2')?.view).toBe(body)
    expect(registry.findEditor('editor-3')?.view).toBe(comments)
  })

  it('walks past a whole run of claimed ordinals', () => {
    editor('editor-2')
    editor('editor-3')
    editor('')
    expect(ids()).toEqual(['editor-2', 'editor-3', 'editor-4'])
  })
})
