/**
 * Computed chrome styles that jsdom can actually answer.
 *
 * Sticky positioning itself is a layout engine's job -- the e2e in
 * `packages/element/test/e2e/chrome.spec.ts` is what proves the bar stays in
 * the viewport after a scroll. These tests pin the declarations and the
 * public token default, so a regression that silently switches the bar back
 * to `relative` cannot hide behind a green Playwright run that never rebuilt
 * the sheet.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CSS } from '../src/css.js'

function applySheet(): void {
  const style = document.createElement('style')
  style.dataset['olTest'] = 'css'
  style.textContent = CSS
  document.head.appendChild(style)
}

beforeEach(() => {
  applySheet()
})

afterEach(() => {
  document.body.replaceChildren()
  for (const node of [...document.head.querySelectorAll('[data-ol-test="css"]')]) node.remove()
})

function mainToolbar(extraHostClass?: string): { host: HTMLElement; toolbar: HTMLElement } {
  const host = document.createElement('div')
  host.className = extraHostClass ? `ol-editor ${extraHostClass}` : 'ol-editor'
  const toolbar = document.createElement('div')
  toolbar.className = 'ol-toolbar'
  host.appendChild(toolbar)
  document.body.appendChild(host)
  return { host, toolbar }
}

describe('main toolbar sticky positioning', () => {
  it('sticks the main toolbar, with a zero default offset', () => {
    const { host, toolbar } = mainToolbar()
    expect(getComputedStyle(toolbar).position).toBe('sticky')
    // jsdom reports `top` as the unresolved `var(--ol-toolbar-sticky-offset)`
    // rather than `0px`; the token itself is what we can assert here. Layout
    // after a real scroll is the e2e below.
    expect(getComputedStyle(host).getPropertyValue('--ol-toolbar-sticky-offset').trim()).toBe(
      'var(--openleaf-toolbar-sticky-offset, 0px)',
    )
  })

  it('exposes --openleaf-toolbar-sticky-offset as a host-settable token', () => {
    const { host } = mainToolbar()
    host.style.setProperty('--openleaf-toolbar-sticky-offset', '48px')
    expect(getComputedStyle(host).getPropertyValue('--openleaf-toolbar-sticky-offset').trim()).toBe('48px')
  })

  it('leaves a floating bar absolutely positioned', () => {
    const { host } = mainToolbar()
    const floating = document.createElement('div')
    floating.className = 'ol-toolbar ol-floating'
    host.appendChild(floating)
    expect(getComputedStyle(floating).position).toBe('absolute')
  })

  it('leaves a second toolbar in flow, so two bars do not stack at the same top', () => {
    const { host, toolbar } = mainToolbar()
    const second = document.createElement('div')
    second.className = 'ol-toolbar ol-toolbar--secondary'
    host.appendChild(second)
    expect(getComputedStyle(toolbar).position).toBe('sticky')
    expect(getComputedStyle(second).position).toBe('relative')
  })

  it('does not stick a lone secondary bar (toolbar="none" toolbar2="...")', () => {
    // Sibling order cannot identify toolbar2: with the primary bar omitted it
    // is the first .ol-toolbar, so a `~` rule never matches it.
    const { host } = mainToolbar()
    host.firstElementChild?.remove()
    const second = document.createElement('div')
    second.className = 'ol-toolbar ol-toolbar--secondary'
    host.appendChild(second)
    expect(getComputedStyle(second).position).toBe('relative')
  })

  it('does not restyle the toolbar under fullscreen', () => {
    // Fullscreen is a column flex whose content pane scrolls; sticky is a
    // no-op there and must stay one, not a competing `fixed`/`absolute`.
    const { toolbar } = mainToolbar('ol-fullscreen')
    expect(getComputedStyle(toolbar).position).toBe('sticky')
  })
})
describe('decoration colour follows the glyphs', () => {
  /*
   * jsdom does not compute `text-decoration-color`. The assertion is that the
   * sheet contains the rules; Chromium in
   * `packages/element/test/e2e/decoration-colour.spec.ts` is what proves they
   * paint the line in the text colour for both mark nestings.
   */
  it('sets currentColor on u/s/del and re-establishes the line on a colour span', () => {
    expect(CSS).toContain(
      '.ol-editor .ol-content .ProseMirror :is(u, s, del) {\n  text-decoration-color: currentColor;\n}',
    )
    expect(CSS).toContain('.ol-editor .ol-content .ProseMirror u [style^="color:"]')
    expect(CSS).toContain('text-decoration: underline currentColor')
    expect(CSS).toContain('.ol-editor .ol-content .ProseMirror :is(s, del) [style^="color:"]')
    expect(CSS).toContain('text-decoration: line-through currentColor')
    expect(CSS).toContain(
      '.ol-editor .ol-content .ProseMirror u :is(s, del) [style^="color:"]',
    )
  })
})
