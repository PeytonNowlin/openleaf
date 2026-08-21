/**
 * What the chrome says about itself when a mode changes.
 *
 * Both defects here are the same shape: a control that reports a state it is
 * not in. Source view left every formatting button enabled, so pressing Bold
 * ran the command against a hidden document that was then thrown away; and
 * `visualaids="false"` left a toggle that flipped `aria-pressed` over a plugin
 * that was never installed. A screen reader repeats both lies faithfully.
 */

import { SOURCE_TOGGLE_EVENT, VISUAL_AIDS_TOGGLE_EVENT } from '@openleaf-editor/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

if (!customElements.get('openleaf-editor')) {
  customElements.define('openleaf-editor', OpenLeafEditor)
}

function build(markup: string): OpenLeafEditor {
  document.body.innerHTML = markup
  const host = document.body.querySelector('openleaf-editor') as OpenLeafEditor
  host.connectedCallback()
  return host
}

function control(host: OpenLeafEditor, id: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`[data-ol-id="${id}"]`)
  if (!el) throw new Error(`no toolbar control ${id}`)
  return el
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the source view', () => {
  it('disables the formatting controls, which would otherwise lose the edit', () => {
    // Bold in source mode ran against the hidden document; leaving source then
    // reparsed the textarea over the top of it and the edit was gone, with
    // nothing anywhere saying so.
    const host = build('<openleaf-editor toolbar="bold italic source"><p>hi</p></openleaf-editor>')
    expect(control(host, 'bold').getAttribute('aria-disabled')).toBe('false')

    host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true }))

    expect(host.sourceMode).toBe(true)
    expect(control(host, 'bold').getAttribute('aria-disabled')).toBe('true')
    expect(control(host, 'italic').getAttribute('aria-disabled')).toBe('true')
    // The way out has to stay live, or the author is stranded in source view.
    expect(control(host, 'source').getAttribute('aria-disabled')).toBe('false')
  })

  it('gives them back on the way out', () => {
    const host = build('<openleaf-editor toolbar="bold source"><p>hi</p></openleaf-editor>')
    host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true }))
    host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true }))
    expect(host.sourceMode).toBe(false)
    expect(control(host, 'bold').getAttribute('aria-disabled')).toBe('false')
  })

  it('announces the change of mode', () => {
    vi.useFakeTimers()
    const host = build('<openleaf-editor toolbar="bold source"><p>hi</p></openleaf-editor>')
    host.dispatchEvent(new CustomEvent(SOURCE_TOGGLE_EVENT, { bubbles: true }))
    vi.advanceTimersByTime(100)
    expect(host.querySelector('.ol-live-region')?.textContent).toBe('HTML source view')
  })
})

describe('visualaids="false"', () => {
  it('leaves no toggle claiming to control a plugin that was never installed', () => {
    const host = build(
      '<openleaf-editor visualaids="false" toolbar="visualAids"><p>hi</p></openleaf-editor>',
    )
    const button = control(host, 'visualAids')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('aria-disabled')).toBe('true')

    // And pressing it does not start reporting a state that is not real.
    host.dispatchEvent(new CustomEvent(VISUAL_AIDS_TOGGLE_EVENT, { bubbles: true }))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(host.classList.contains('ol-visual-aids')).toBe(false)
  })

  it('still works normally when the aids are installed', () => {
    const host = build('<openleaf-editor toolbar="visualAids"><p>hi</p></openleaf-editor>')
    const button = control(host, 'visualAids')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    host.dispatchEvent(new CustomEvent(VISUAL_AIDS_TOGGLE_EVENT, { bubbles: true }))
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })
})
