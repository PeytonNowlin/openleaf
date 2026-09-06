/**
 * What the read tools do while the author is editing the markup by hand.
 *
 * With source view open there are two documents: the textarea the author is
 * typing in, and `view.state.doc` as it was when the view opened, which is not
 * reparsed until the view closes. `openleaf_get_document` reads through
 * `host.value` and so answers with the first; every other tool reads the
 * second. An agent that read the document, searched it for a string it had just
 * been handed, and got nothing back would be right to conclude the string is
 * not there.
 *
 * Worse than the disagreement: a handle minted in that state names a position
 * in the hidden document, and that is the coordinate a later write would use.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { findTextTool } from '../src/find-text.js'
import { getDocumentTool } from '../src/get-document.js'
import { getStructureTool } from '../src/get-structure.js'
import { agentHandles } from '../src/handles.js'
import { agentRegistry } from '../src/registry.js'

const views: EditorView[] = []

function editor(id: string, html: string): EditorView {
  const host = document.createElement('openleaf-editor')
  host.id = id
  document.body.appendChild(host)
  const mount = document.createElement('div')
  host.appendChild(mount)

  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [agentRegistry(), agentHandles()],
    }),
  })
  views.push(view)
  return view
}

/** Open source view the way the element does: the property, plus what it reads back. */
function openSource(view: EditorView, markup: string): void {
  Object.assign(view.dom.closest('openleaf-editor') as object, {
    sourceMode: true,
    value: markup,
  })
}

interface Result {
  ok: boolean
  error?: string
  message?: string
  matches?: unknown[]
  outline?: unknown[]
  html?: string
}

const find = (id: string, text: string): Result =>
  JSON.parse(findTextTool.execute({ id, text })) as Result
const structure = (id: string): Result => JSON.parse(getStructureTool.execute({ id })) as Result
const document_ = (id: string): Result => JSON.parse(getDocumentTool.execute({ id })) as Result

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy()
  document.body.replaceChildren()
})

describe('with the HTML source view open', () => {
  it('refuses a search rather than answering from the hidden document', () => {
    const view = editor('post', '<p>alpha</p>')
    openSource(view, '<p>beta</p>')

    const refused = find('post', 'alpha')
    expect(refused).toMatchObject({ ok: false, error: 'refused' })
    // The agent is told what to do next, not merely that it failed.
    expect(refused.message).toContain('source view')
    expect(refused.matches).toBeUndefined()
  })

  it('refuses an outline for the same reason', () => {
    const view = editor('post', '<p>alpha</p>')
    openSource(view, '<p>beta</p>')

    const refused = structure('post')
    expect(refused).toMatchObject({ ok: false, error: 'refused' })
    expect(refused.outline).toBeUndefined()
  })

  /*
   * The disagreement itself, stated as a test: `get_document` returns the
   * markup on screen, so a search for text that only the hidden document holds
   * must not report a match, and a search for text only the textarea holds must
   * not report an absence. Refusing is how both stay true at once.
   */
  it('does not let a search contradict the document just returned', () => {
    const view = editor('post', '<p>alpha</p>')
    openSource(view, '<p>beta</p>')

    expect(document_('post')).toMatchObject({ ok: true, html: '<p>beta</p>' })
    expect(find('post', 'beta').ok).toBe(false)
    expect(find('post', 'alpha').ok).toBe(false)
  })

  it('still reads the document, which is the tool that knows about source view', () => {
    const view = editor('post', '<p>alpha</p>')
    openSource(view, '<p>beta</p>')
    expect(document_('post')).toMatchObject({ ok: true, html: '<p>beta</p>' })
  })
})

describe('with the source view closed again', () => {
  it('searches and outlines as before', () => {
    const view = editor('post', '<p>alpha</p>')
    openSource(view, '<p>alpha</p>')
    Object.assign(view.dom.closest('openleaf-editor') as object, { sourceMode: false })

    expect(find('post', 'alpha')).toMatchObject({ ok: true })
    expect(structure('post')).toMatchObject({ ok: true })
  })

  it('is the ordinary case for a host that has no source view at all', () => {
    // The element is a peer dependency over a range: one that predates source
    // view has no `sourceMode` property, and `undefined` is not `true`.
    editor('post', '<p>alpha</p>')
    expect(find('post', 'alpha')).toMatchObject({ ok: true })
    expect(structure('post')).toMatchObject({ ok: true })
  })
})
