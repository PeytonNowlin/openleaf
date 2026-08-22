/**
 * The toolbar's media button: which node type an address becomes, and whether a
 * click inserts or edits.
 *
 * The dialog itself is tested in `packages/ui`; what is tested here is the
 * wiring around it, which is where the two decisions live that the author
 * notices -- a YouTube link becoming an embed rather than a broken `<video>`,
 * and a selected player being edited rather than a second one appearing beside
 * it.
 */

import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { NodeSelection, TextSelection, EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { promptInsertMedia } from '../src/prompts.js'

let view: EditorView | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  const proto = Object.getPrototypeOf(document.createElement('dialog')) as {
    showModal?: () => void
    close?: () => void
  }
  proto.showModal = function (this: HTMLElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLElement) {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  view?.destroy()
  view = undefined
  host = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function mount(html: string): void {
  host = document.createElement('div')
  document.body.append(host)
  view = new EditorView(host, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      schema: coreSchema(),
    }),
  })
}

/** Put the caret in the first text position, so nothing is node-selected. */
function caret(): void {
  const state = view!.state
  view!.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1)))
}

function selectMedia(): void {
  const state = view!.state
  let pos: number | null = null
  state.doc.descendants((node, at) => {
    if (pos === null && ['video', 'audio', 'iframe'].includes(node.type.name)) pos = at
    return pos === null
  })
  if (pos === null) throw new Error('no media node to select')
  view!.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
}

/** Fill the dialog the way a person would, then submit it. */
async function answer(values: Record<string, string>): Promise<void> {
  const pending = promptInsertMedia(view!, host!)
  const form = document.querySelector('dialog form')
  if (!(form instanceof HTMLFormElement)) throw new Error('no dialog opened')
  for (const [name, value] of Object.entries(values)) {
    const el = form.elements.namedItem(name)
    if (!el) throw new Error(`no control named ${name}`)
    ;(el as HTMLInputElement).value = value
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await pending
}

function stored(): string {
  return serializeHtml(view!.state.doc)
}

describe('choosing the node type', () => {
  it('makes a video from a plain file address', async () => {
    mount('<p></p>')
    caret()
    await answer({ src: '/clip.mp4' })
    expect(stored()).toContain('<video')
  })

  it('makes an audio player from an audio file', async () => {
    mount('<p></p>')
    caret()
    await answer({ src: '/song.mp3' })
    expect(stored()).toContain('<audio')
  })

  it('makes an embed from a watch page, not a broken video', async () => {
    mount('<p></p>')
    caret()
    await answer({ src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    const html = stored()
    expect(html).toContain('<iframe')
    expect(html).not.toContain('<video')
  })

  it('classifies by the alternatives when there is no main address', async () => {
    mount('<p></p>')
    caret()
    await answer({ alt0: '/song.ogg' })
    expect(stored()).toContain('<audio')
  })

  it('stays a video when the alternatives are mixed', async () => {
    mount('<p></p>')
    caret()
    await answer({ src: '', alt0: '/clip.webm', alt1: '/song.ogg' })
    expect(stored()).toContain('<video')
  })

  it('writes the alternatives as source children', async () => {
    mount('<p></p>')
    caret()
    await answer({ src: '/clip.mp4', alt0: '/clip.webm', altType0: 'video/webm' })
    expect(stored()).toContain('<source src="/clip.webm" type="video/webm">')
  })
})

describe('editing the selected player', () => {
  it('changes the player in place rather than inserting a second one', async () => {
    mount('<video src="/old.mp4" controls></video>')
    selectMedia()
    await answer({ src: '/new.mp4' })
    const html = stored()
    expect(html).toContain('/new.mp4')
    expect(html).not.toContain('/old.mp4')
    expect(html.match(/<video/g)?.length).toBe(1)
  })

  it('prefills the dialog from the selected player', async () => {
    mount('<video src="/v.mp4" width="640" controls><source src="/v.webm"></video>')
    selectMedia()
    const pending = promptInsertMedia(view!, host!)
    const form = document.querySelector('dialog form') as HTMLFormElement
    expect((form.elements.namedItem('src') as HTMLInputElement).value).toBe('/v.mp4')
    expect((form.elements.namedItem('width') as HTMLInputElement).value).toBe('640')
    expect((form.elements.namedItem('alt0') as HTMLInputElement).value).toBe('/v.webm')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await pending
  })

  it('keeps the node type when editing, even if the new address looks like an embed', async () => {
    // Retyping a selected video's address as a YouTube link should change the
    // address, not silently swap the node and drop what was beside it.
    mount('<video src="/v.mp4" controls></video>')
    selectMedia()
    await answer({ src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(stored()).toContain('<video')
  })

  it('inserts rather than edits when only a caret is near the player', async () => {
    mount('<p>text</p><video src="/v.mp4" controls></video>')
    caret()
    await answer({ src: '/second.mp4' })
    const html = stored()
    expect(html).toContain('/v.mp4')
    expect(html).toContain('/second.mp4')
  })
})
