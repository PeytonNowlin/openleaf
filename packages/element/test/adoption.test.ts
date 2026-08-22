/**
 * Cross-document adoption, and the listeners that have to follow the element.
 *
 * `adoptNode` reassigns `ownerDocument`, so any code that removes a
 * document-level listener by re-deriving `this.ownerDocument` removes it from
 * the wrong document -- silently, because removing a listener that is not there
 * is a no-op. That is why `#boundDoc` exists, and this file is the coverage for
 * the same class one scope smaller: the chrome's own listeners, which are
 * rebuilt on every observed attribute change and so can be re-registered in a
 * document the element has since moved on from.
 *
 * jsdom is honest here: `createHTMLDocument()` gives a real second document, an
 * adopted-and-inserted element stays connected through the move, and observed
 * attributes still fire their callback afterwards.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

const live: OpenLeafEditor[] = []

afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await flush()
})

/** Let the deferred teardown decide. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function isCapture(options: unknown): boolean {
  if (options === true) return true
  return typeof options === 'object' && options !== null && (options as AddEventListenerOptions).capture === true
}

/**
 * The set of capture-phase listeners of one type currently registered on a
 * document.
 *
 * A SET rather than a counter, deliberately: a removal aimed at the wrong
 * document is a no-op, and a signed counter would report that as -1 and make
 * the leak look like a double-free. The set only ever holds what is really
 * armed, which is the thing under test.
 */
function captureListeners(doc: Document, type: string): Set<unknown> {
  const armed = new Set<unknown>()
  const add = doc.addEventListener.bind(doc)
  const remove = doc.removeEventListener.bind(doc)
  doc.addEventListener = ((t: string, fn: unknown, options?: unknown) => {
    if (t === type && isCapture(options)) armed.add(fn)
    return add(t as never, fn as never, options as never)
  }) as typeof doc.addEventListener
  doc.removeEventListener = ((t: string, fn: unknown, options?: unknown) => {
    if (t === type && isCapture(options)) armed.delete(fn)
    return remove(t as never, fn as never, options as never)
  }) as typeof doc.removeEventListener
  return armed
}

function makeEditor(): OpenLeafEditor {
  const el = document.createElement('openleaf-editor') as OpenLeafEditor
  el.innerHTML = '<p>hi</p>'
  live.push(el)
  return el
}

describe('the context menu across a cross-document move', () => {
  /*
   * The leak needs two moves, or one move and a return, which is why a
   * single-adoption test would have missed it:
   *
   *   build in D1                       -> D1 armed
   *   adopt into D2, change an attribute -> #destroyChrome removes from the
   *     CURRENT ownerDocument (D2, a no-op) and remounts on D2. D1 is now stale
   *     and D2 is armed.
   *   adopt back into D1, change again   -> removes from D1, which takes the
   *     ORIGINAL registration, and remounts on D1. D2 is never touched again.
   *   teardown                          -> removes from `#boundDoc` (D1) and,
   *     via #destroyChrome, from ownerDocument (D1 again).
   *
   * D2 keeps a capture listener holding the whole torn-down editor -- including
   * the serialized-document cache -- for the life of that document.
   */
  it('leaves no listener behind in a document it has left', async () => {
    const first = captureListeners(document, 'pointerdown')
    const el = makeEditor()
    document.body.appendChild(el)
    await flush()
    expect(first.size).toBe(1)

    const other = document.implementation.createHTMLDocument('second')
    const second = captureListeners(other, 'pointerdown')

    // Adopted AND inserted, so the element stays connected through the move and
    // the deferred teardown lets the session live -- the supported scenario.
    other.body.appendChild(el)
    await flush()
    expect(el.ownerDocument).toBe(other)
    expect(el.view).not.toBeNull()

    el.setAttribute('toolbar', 'bold italic')
    await flush()
    // Armed in exactly one document: the one it is in.
    expect(second.size).toBe(1)
    expect(first.size).toBe(0)

    document.body.appendChild(el)
    await flush()
    el.setAttribute('toolbar', 'bold')
    await flush()
    expect(first.size).toBe(1)
    expect(second.size).toBe(0)

    el.remove()
    await flush()
    expect(first.size).toBe(0)
    expect(second.size).toBe(0)
  })

  it('cleans up after a single move, without a chrome rebuild', async () => {
    const first = captureListeners(document, 'pointerdown')
    const el = makeEditor()
    document.body.appendChild(el)
    await flush()

    const other = document.implementation.createHTMLDocument('second')
    const second = captureListeners(other, 'pointerdown')
    other.body.appendChild(el)
    await flush()

    el.remove()
    await flush()
    expect(first.size).toBe(0)
    expect(second.size).toBe(0)
  })

  it('arms nothing at all with contextmenu="none"', async () => {
    const first = captureListeners(document, 'pointerdown')
    const el = makeEditor()
    el.setAttribute('contextmenu', 'none')
    document.body.appendChild(el)
    await flush()
    expect(first.size).toBe(0)

    el.setAttribute('toolbar', 'bold')
    await flush()
    expect(first.size).toBe(0)
    el.remove()
    await flush()
    expect(first.size).toBe(0)
  })
})
