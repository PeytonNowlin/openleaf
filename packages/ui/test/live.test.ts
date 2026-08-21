/**
 * The live region every toolbar speaks through.
 *
 * The bug this exists to prevent: each Toolbar used to build its own detached
 * `<div>` and rely on the host to mount exactly one of them. A secondary or
 * floating bar therefore announced into a node that was never in the document,
 * and `toolbar="none" toolbar2="bold"` announced nowhere at all -- Ctrl+B was
 * completely silent.
 *
 * So the assertions here are about the region being CONNECTED and SHARED, not
 * about an attribute existing.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerDefaultItems } from '../src/items.js'
import { announce, liveRegion } from '../src/live.js'
import { Toolbar } from '../src/toolbar.js'

registerDefaultItems()

function editor(html = '<p>hello</p>') {
  const host = document.createElement('div')
  host.className = 'ol-editor'
  document.body.appendChild(host)

  let state = EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
  )

  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
    },
    focus: () => undefined,
  } as unknown as EditorView

  return {
    host,
    view,
    get state() {
      return state
    },
    /**
     * Apply bold, and hand back the transaction that did it.
     *
     * The toolbar announces only on a real formatting transition, so the
     * transaction it is given has to be the one that changed the document --
     * handing it a fresh no-op transaction is how a test of announcements ends
     * up asserting nothing.
     */
    bolden: (): Transaction => {
      const strong = state.schema.marks['strong']
      if (!strong) throw new Error('no strong mark')
      const tr = state.tr.addMark(1, state.doc.content.size - 1, strong.create())
      state = state.apply(tr)
      return tr
    },
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('the shared live region', () => {
  it('is in the document, not a detached node', () => {
    const { host } = editor()
    const region = liveRegion(host)
    expect(region.isConnected).toBe(true)
    expect(region.parentElement).toBe(host)
  })

  it('is created once and reused', () => {
    const { host } = editor()
    expect(liveRegion(host)).toBe(liveRegion(host))
    expect(host.querySelectorAll('.ol-live-region')).toHaveLength(1)
  })

  it('speaks after clearing, so an identical message is announced again', () => {
    vi.useFakeTimers()
    const { host } = editor()
    announce(host, 'Bold on')
    // Cleared first: replacing identical text is not a change and would be
    // silently dropped by the platform.
    expect(liveRegion(host).textContent).toBe('')
    vi.advanceTimersByTime(100)
    expect(liveRegion(host).textContent).toBe('Bold on')
  })
})

describe('a secondary toolbar', () => {
  it('announces into a region that is actually in the document', () => {
    vi.useFakeTimers()
    const { host, view, bolden } = editor()

    // The failing scenario in full: no primary bar at all, so nothing else has
    // mounted a region on this host.
    const secondary = new Toolbar(host, document, { layout: 'bold italic', label: 'More formatting' })
    host.appendChild(secondary.el)
    secondary.mount(view)

    const tr = bolden()
    secondary.update(view.state, tr)
    vi.advanceTimersByTime(100)

    const regions = [...host.querySelectorAll('.ol-live-region')]
    expect(regions).toHaveLength(1)
    expect(regions[0]?.isConnected).toBe(true)
    expect(regions[0]?.textContent).toBe('Bold on')
  })

  it('shares one region with the primary bar rather than building a second', () => {
    const { host, view } = editor()
    const primary = new Toolbar(host, document, { layout: 'bold' })
    const secondary = new Toolbar(host, document, { layout: 'italic', label: 'More formatting' })
    host.append(primary.el, secondary.el)
    primary.mount(view)
    secondary.mount(view)

    expect(primary.liveRegion).toBe(secondary.liveRegion)
    expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
  })
})
