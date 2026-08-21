/**
 * When the textarea is written, and -- more to the point -- when it is not.
 *
 * `dispatchTransaction` used to call `sync()` on every document-changing
 * transaction, which sets `textarea.value = serializeHtml(doc)`: a full
 * `DOMSerializer` pass over the whole document and a ~0.33 MB string, per
 * keystroke, on the documented form-integration path. It measured 12.1 ms on a
 * plain 100-page document and 74.3 ms with 250 tables, against a 16.7 ms frame,
 * and nothing read the result until the form was posted.
 *
 * Counting tests, not timing tests: "how many times was the document
 * serialized" is the same number on every machine and is the quantity that
 * regressed. Each assertion here was confirmed to go red against the unfixed
 * code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormBridge } from '../src/form-bridge.js'

let host: HTMLElement
let area: HTMLTextAreaElement
let form: HTMLFormElement
/** How many times the bridge asked for the document as a string. */
let reads: number

function bridge(): FormBridge {
  return new FormBridge(
    host,
    () => {
      reads += 1
      return '<p>serialized</p>'
    },
    (html) => {
      host.dataset['written'] = html
    },
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  reads = 0
  form = document.createElement('form')
  area = document.createElement('textarea')
  area.id = 'body'
  area.name = 'body'
  host = document.createElement('div')
  host.setAttribute('for', 'body')
  form.append(area, host)
  document.body.append(form)
})

afterEach(() => {
  vi.useRealTimers()
  form.remove()
})

describe('marking the document dirty', () => {
  it('does not serialize the document when a transaction changes it', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    for (let i = 0; i < 50; i += 1) b.markDirty()

    // Fifty keystrokes, no serialization. This is the whole point: before the
    // change this was fifty full passes over the document.
    expect(reads).toBe(0)
  })

  it('writes the textarea once on the trailing timer, however much was typed', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    for (let i = 0; i < 50; i += 1) b.markDirty()
    vi.advanceTimersByTime(1000)

    // One write for the burst, so a host watching the textarea with a
    // MutationObserver still sees the document catch up.
    expect(reads).toBe(1)
    expect(area.value).toBe('<p>serialized</p>')
  })

  it('does not rearm the timer for every keystroke in a burst', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    // Typing that never pauses must still reach the textarea: the timer is a
    // trailing one from the first change, not a debounce that keeps resetting.
    for (let i = 0; i < 20; i += 1) {
      b.markDirty()
      vi.advanceTimersByTime(100)
    }
    expect(reads).toBeGreaterThan(0)
  })
})

describe('the flush points', () => {
  it('writes the document before the form submits', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    b.markDirty()
    form.dispatchEvent(new Event('submit'))

    expect(reads).toBe(1)
    expect(area.value).toBe('<p>serialized</p>')
  })

  it('writes the document into a FormData snapshot', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    b.markDirty()
    const data = new FormData()
    form.dispatchEvent(
      Object.assign(new Event('formdata'), { formData: data }) as unknown as Event,
    )

    expect(data.get('body')).toBe('<p>serialized</p>')
  })

  it('writes the document when the bridge is detached', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    b.markDirty()
    b.detach()

    expect(reads).toBe(1)
    expect(area.value).toBe('<p>serialized</p>')
  })

  /**
   * A flush point with nothing to flush must cost nothing. Submitting a form
   * the author never typed into used to serialize the whole document anyway.
   */
  it('does not serialize at a flush point when nothing changed', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    form.dispatchEvent(new Event('submit'))
    b.detach()

    expect(reads).toBe(0)
  })

  /** Flushing early must not leave the trailing timer to write again later. */
  it('cancels the pending timer once it has flushed', () => {
    const b = bridge()
    b.bind()
    b.attach()
    reads = 0

    b.markDirty()
    form.dispatchEvent(new Event('submit'))
    expect(reads).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(reads).toBe(1)
  })
})
