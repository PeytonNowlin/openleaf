/**
 * Inserting media with alternative sources, and editing a player already in the
 * document.
 *
 * The insert commands could only ever write a single `src`, so the source-only
 * and multi-source shapes the schema round-trips were unreachable from the
 * editor: an author could open such a document and save it unharmed, but could
 * not produce one. And no command read a selected player back out, so "edit
 * this video" had nothing to build a prefilled dialog from.
 */

import { NodeSelection, TextSelection, type Command, EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  coreSchema,
  insertAudio,
  insertVideo,
  parseHtml,
  selectedMedia,
  serializeHtml,
  updateMedia,
} from '../src/index.js'

function emptyState(): EditorState {
  const state = EditorState.create({ doc: parseHtml('<p></p>'), schema: coreSchema() })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
}

/** A document holding one media element, with that element selected. */
function selecting(html: string): EditorState {
  const state = EditorState.create({ doc: parseHtml(html), schema: coreSchema() })
  let pos: number | null = null
  state.doc.descendants((node, at) => {
    if (pos === null && ['video', 'audio', 'iframe'].includes(node.type.name)) pos = at
    return pos === null
  })
  if (pos === null) throw new Error(`no media node in ${html}`)
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
}

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied ? next : null
}

/** What the editor would store for this state. */
function stored(state: EditorState): string {
  return serializeHtml(state.doc)
}

describe('inserting media with alternative sources', () => {
  it('writes each source as a child of the player', () => {
    const next = run(
      emptyState(),
      insertVideo({
        src: '/main.mp4',
        sources: [
          { src: '/alt.webm', type: 'video/webm' },
          { src: '/alt.ogv' },
        ],
      }),
    )
    const html = stored(next!)
    expect(html).toContain('src="/main.mp4"')
    expect(html).toContain('<source src="/alt.webm" type="video/webm">')
    expect(html).toContain('<source src="/alt.ogv">')
  })

  it('accepts a source-only player, which has no src of its own', () => {
    const next = run(emptyState(), insertVideo({ sources: [{ src: '/only.webm' }] }))
    expect(next).not.toBeNull()
    const html = stored(next!)
    expect(html).toContain('<source src="/only.webm">')
    expect(html).not.toContain('<video src')
  })

  it('declines a player with nothing to play', () => {
    expect(run(emptyState(), insertVideo({}))).toBeNull()
    expect(run(emptyState(), insertVideo({ sources: [] }))).toBeNull()
  })

  it('drops an unsafe source rather than storing it', () => {
    const next = run(
      emptyState(),
      insertVideo({ src: '/ok.mp4', sources: [{ src: 'javascript:alert(1)' }] }),
    )
    const html = stored(next!)
    expect(html).toContain('src="/ok.mp4"')
    expect(html).not.toContain('javascript')
  })

  it('declines when every source is unsafe and there is no src', () => {
    expect(run(emptyState(), insertVideo({ sources: [{ src: 'javascript:alert(1)' }] }))).toBeNull()
  })

  it('cannot be broken out of by a quote in the address', () => {
    const next = run(
      emptyState(),
      insertVideo({ sources: [{ src: '/a.mp4" onerror="alert(1)' }] }),
    )
    expect(next).not.toBeNull()
    // The quote is escaped, so those characters stay inside the one attribute
    // value instead of closing it and starting a handler. Asserted by reparsing
    // rather than by substring: `&quot; onerror=&quot;` legitimately contains
    // the text `onerror=`, and what matters is that no such attribute exists.
    const el = new DOMParser().parseFromString(stored(next!), 'text/html').querySelector('source')
    expect(el).not.toBeNull()
    expect(el!.hasAttribute('onerror')).toBe(false)
    expect(el!.getAttribute('src')).toBe('/a.mp4" onerror="alert(1)')
  })

  it('carries sources onto audio too', () => {
    const next = run(emptyState(), insertAudio({ sources: [{ src: '/a.ogg', type: 'audio/ogg' }] }))
    expect(stored(next!)).toContain('<source src="/a.ogg" type="audio/ogg">')
  })
})

describe('reading a selected player', () => {
  it('reports the stored attributes and sources', () => {
    const state = selecting(
      '<video src="/v.mp4" title="Clip" width="640" height="360" poster="/p.jpg" controls>' +
        '<source src="/alt.webm" type="video/webm"></video>',
    )
    const found = selectedMedia(state)
    expect(found).not.toBeNull()
    expect(found!.kind).toBe('video')
    expect(found!.src).toBe('/v.mp4')
    expect(found!.title).toBe('Clip')
    expect(found!.width).toBe('640')
    expect(found!.height).toBe('360')
    expect(found!.poster).toBe('/p.jpg')
    expect(found!.controls).toBe(true)
    expect(found!.sources).toEqual([{ src: '/alt.webm', type: 'video/webm' }])
  })

  it('reads a source-only player back out', () => {
    const found = selectedMedia(selecting('<video controls><source src="/only.webm"></video>'))
    expect(found!.src).toBeNull()
    expect(found!.sources).toEqual([{ src: '/only.webm', type: null }])
  })

  it('recognises audio and iframe as well', () => {
    expect(selectedMedia(selecting('<audio src="/a.mp3" controls></audio>'))!.kind).toBe('audio')
    expect(
      selectedMedia(selecting('<iframe src="https://www.youtube.com/embed/x"></iframe>'))!.kind,
    ).toBe('iframe')
  })

  it('is null for a caret that merely sits beside a player', () => {
    const state = selecting('<p>text</p><video src="/v.mp4" controls></video>')
    const caret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    expect(selectedMedia(caret)).toBeNull()
  })

  it('is null when the selected node is not media', () => {
    const state = EditorState.create({ doc: parseHtml('<hr>'), schema: coreSchema() })
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(selectedMedia(selected)).toBeNull()
  })
})

describe('updating a selected player', () => {
  it('replaces the address and the sources in place', () => {
    const state = selecting('<video src="/old.mp4" controls><source src="/old.webm"></video>')
    const next = run(state, updateMedia({ src: '/new.mp4', sources: [{ src: '/new.webm' }] }))
    const html = stored(next!)
    expect(html).toContain('src="/new.mp4"')
    expect(html).toContain('<source src="/new.webm">')
    expect(html).not.toContain('/old')
  })

  it('keeps the player selected, so a second edit finds it', () => {
    const state = selecting('<video src="/v.mp4" controls></video>')
    const next = run(state, updateMedia({ src: '/w.mp4' }))
    expect(selectedMedia(next!)).not.toBeNull()
    expect(selectedMedia(next!)!.src).toBe('/w.mp4')
  })

  it('clears sources when the author empties them', () => {
    const state = selecting('<video src="/v.mp4" controls><source src="/alt.webm"></video>')
    const next = run(state, updateMedia({ src: '/v.mp4', sources: [] }))
    expect(stored(next!)).not.toContain('<source')
  })

  it('does not write width or height onto audio, which has no box', () => {
    const state = selecting('<audio src="/a.mp3" controls></audio>')
    const next = run(state, updateMedia({ src: '/b.mp3', width: '640', height: '360' }))
    const html = stored(next!)
    expect(html).toContain('src="/b.mp3"')
    expect(html).not.toContain('width')
    expect(html).not.toContain('height')
  })

  it('declines an update that would leave nothing to play', () => {
    const state = selecting('<video src="/v.mp4" controls></video>')
    expect(run(state, updateMedia({}))).toBeNull()
    expect(run(state, updateMedia({ src: 'javascript:alert(1)' }))).toBeNull()
  })

  it('declines an unsafe embed address for an iframe', () => {
    const state = selecting('<iframe src="https://www.youtube.com/embed/x"></iframe>')
    expect(run(state, updateMedia({ src: 'javascript:alert(1)' }))).toBeNull()
  })

  it('declines when nothing is selected', () => {
    expect(run(emptyState(), updateMedia({ src: '/v.mp4' }))).toBeNull()
  })

  it('drops an unsafe poster without losing the player', () => {
    const state = selecting('<video src="/v.mp4" poster="/p.jpg" controls></video>')
    const next = run(state, updateMedia({ src: '/v.mp4', poster: 'javascript:alert(1)' }))
    const html = stored(next!)
    expect(html).toContain('src="/v.mp4"')
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('poster')
  })
})
