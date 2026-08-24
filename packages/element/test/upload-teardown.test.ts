/**
 * Image drop/paste must not insert into a view that was torn down while the
 * describe-and-upload dialog was open. Import already refuses that; the image
 * path did not (#171).
 */

import { Slice } from 'prosemirror-model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

const prompt = vi.hoisted(() => {
  let settle: (value: unknown) => void = () => {}
  return {
    wait: () =>
      new Promise((resolve) => {
        settle = resolve
      }),
    complete: (value: unknown) => settle(value),
  }
})

vi.mock('@openleaf-editor/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openleaf-editor/ui')>()
  return {
    ...actual,
    promptForImage: vi.fn(() => prompt.wait()),
  }
})

const live: OpenLeafEditor[] = []

afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

function png(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
}

describe('image upload after teardown', () => {
  it('does not insert or throw if the editor is removed during the dialog', async () => {
    const el = document.createElement('openleaf-editor') as OpenLeafEditor
    el.imageUploader = async () => ({ src: 'https://example.com/a.png' })
    document.body.append(el)
    live.push(el)
    const view = el.view
    expect(view).not.toBeNull()

    // jsdom has no DataTransfer, and ProseMirror's drop handler calls
    // posAtCoords before our `handleDrop`. Drive the plugin prop directly.
    const transfer = { files: [png()] } as unknown as DataTransfer
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: transfer })
    const claimed = view!.someProp('handlePaste', (fn) =>
      fn(view!, event as ClipboardEvent, Slice.empty),
    )
    expect(claimed).toBe(true)

    el.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view!.isDestroyed).toBe(true)

    const rejections: unknown[] = []
    const onReject = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason)
      event.preventDefault()
    }
    window.addEventListener('unhandledrejection', onReject)
    prompt.complete({
      src: 'https://example.com/a.png',
      alt: 'a photo',
      title: '',
      width: null,
      height: null,
      align: '',
      className: '',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.removeEventListener('unhandledrejection', onReject)

    expect(rejections).toEqual([])
  })
})
