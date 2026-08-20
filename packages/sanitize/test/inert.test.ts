/**
 * The sanitizer must not execute the payload it was called to remove.
 *
 * `sanitizeHtml` parses into a `<template>`, which is inert: images do not load
 * there and `on*` attributes are never compiled into handlers. It then used to
 * move that content into a `<div>` built from the live document, which adopts
 * every node across that boundary and makes the browser act on them at once --
 * the fetch starts and the handler compiles before the first line of policy
 * enforcement runs. Sanitizing client-side is a supported use, so this was a
 * way to fire a payload by trying to strip it.
 *
 * jsdom neither loads images nor compiles handler attributes, so "it did not
 * fire here" would be equally true of the vulnerable code and proves nothing.
 * What is provable in jsdom is the boundary crossing that causes the firing, so
 * these tests watch every DOM move the sanitizer makes.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, sanitizeHtml } from '../src/index.js'

const clean = (html: string): string => sanitizeHtml(html, { policy: DEFAULT_POLICY })

const PAYLOAD = '<p>ok</p><img src="https://attacker.example/pixel.png" onerror="window.__pwned=1">'

/**
 * Run `work`, reporting every node moved into a tree the live document owns.
 *
 * Adoption is transient -- a node can enter the live document and leave again
 * within one synchronous pass, and inspecting `ownerDocument` afterwards then
 * says nothing, while the fetch has already gone out. Only watching the move
 * itself catches it.
 *
 * Moves in the other direction, a live node into an inert tree, are not
 * adoptions into the live document and are not reported.
 */
function adoptionsInto(live: Document, work: () => void): string[] {
  const view = live.defaultView
  if (!view) throw new Error('this test needs a document with a window')

  const proto = view.Node.prototype
  const adopted: string[] = []

  const note = (host: Node, moved: Node): void => {
    const hostDocument = host.nodeType === 9 ? (host as Document) : host.ownerDocument
    if (hostDocument !== live) return
    if (moved.ownerDocument === live) return
    adopted.push(moved.nodeType === 1 ? (moved as Element).outerHTML.slice(0, 120) : '#fragment')
  }

  const realAppendChild = proto.appendChild
  const realInsertBefore = proto.insertBefore

  proto.appendChild = function appendChild<T extends Node>(this: Node, node: T): T {
    note(this, node)
    return realAppendChild.call(this, node) as T
  }
  proto.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    note(this, node)
    return realInsertBefore.call(this, node, child) as T
  }

  try {
    work()
  } finally {
    proto.appendChild = realAppendChild
    proto.insertBefore = realInsertBefore
  }

  return adopted
}

describe('sanitizing without adopting into the live document', () => {
  it('catches the shape these tests exist to prevent', () => {
    // A watcher that cannot fire would make every empty expectation below
    // vacuous, so this pins the mechanism against the exact old code.
    const seen = adoptionsInto(document, () => {
      const template = document.createElement('template')
      template.innerHTML = PAYLOAD
      const root = document.createElement('div')
      root.appendChild(template.content)
    })
    expect(seen).toHaveLength(1)
  })

  it('does not move a single node into the live document', () => {
    let out = ''
    const seen = adoptionsInto(document, () => {
      out = clean(PAYLOAD)
    })
    expect(seen).toEqual([])
    // The sanitizer really did run over the payload, so the empty list above is
    // not just an empty pass.
    expect(out).toContain('<p>ok</p>')
    expect(out).not.toContain('onerror')
  })

  it('leaves nothing behind in the live document', () => {
    clean(PAYLOAD)
    expect(document.documentElement.innerHTML).not.toContain('attacker.example')
    expect(document.documentElement.innerHTML).not.toContain('__pwned')
  })

  it('never compiles an on* attribute while the payload is being walked', () => {
    // The property that makes the fragment safe: its owner document has no
    // browsing context, so there is nothing for a handler to run in.
    const template = document.createElement('template')
    template.innerHTML = PAYLOAD
    expect(template.content.ownerDocument).not.toBe(document)
    expect(template.content.ownerDocument.defaultView).toBeNull()
    const img = template.content.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('onerror')).toBe('window.__pwned=1')
    expect(img.onerror).toBeNull()
  })

  it('still drops the elements a fragment has no getElementsByTagName for', () => {
    // `dropWithContent` used to be resolved with `getElementsByTagName`, which
    // a DocumentFragment does not have. The foreign-namespace names are the
    // interesting half of the switch to `querySelectorAll`, since a type
    // selector has to match their local names to reach them.
    const out = clean(
      '<p>ok</p><script>alert(1)</script><svg><circle></circle></svg>' +
        '<math><mtext>x</mtext></math><template><p>hidden</p></template>',
    )
    expect(out).toBe('<p>ok</p>')
  })
})
