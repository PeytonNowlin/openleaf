/**
 * Read-only link activation (#181).
 *
 * `contenteditable="false"` restores native `<a href>` navigation. The
 * canvas must preventDefault that click without throwing on an href that
 * would be a CSS selector syntax error, and without making the anchor
 * inert -- keyboard users still Tab to it and copy the URL from the
 * browser menu, which `#onContextMenu` already leaves alone under
 * `readonly`.
 *
 * There is no `querySelector(href)` path in this repository. These tests
 * still use the issue's own metacharacter hrefs so a future one cannot
 * land unnoticed.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { LINK_EVENT, OpenLeafEditor, type OpenLeafLinkDetail } from '../src/index.js'

const live: OpenLeafEditor[] = []

afterEach(async () => {
  for (const el of live.splice(0)) el.remove()
  document.body.replaceChildren()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

function mount(html: string): OpenLeafEditor {
  const el = document.createElement('openleaf-editor') as OpenLeafEditor
  el.setAttribute('toolbar', 'none')
  el.setAttribute('readonly', '')
  el.innerHTML = html
  document.body.append(el)
  live.push(el)
  return el
}

function linkOf(el: OpenLeafEditor): HTMLAnchorElement {
  const link = el.querySelector<HTMLAnchorElement>('[role="textbox"] a')
  if (!link) throw new Error('no link in the editor')
  return link
}

describe('a read-only editor', () => {
  it('does not navigate when a link whose href contains a semicolon is clicked', () => {
    const el = mount('<p><a href="https://example.org/a;b=1">follow me</a></p>')
    const link = linkOf(el)
    const seen: string[] = []
    el.addEventListener(LINK_EVENT, (event) => {
      seen.push(event.detail.href)
    })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(() => link.dispatchEvent(click)).not.toThrow()
    expect(click.defaultPrevented).toBe(true)
    expect(seen).toEqual(['https://example.org/a;b=1'])
    // Still a real anchor: the browser menu can copy this, and Tab can reach it.
    expect(link.getAttribute('href')).toBe('https://example.org/a;b=1')
  })

  it('does not throw or navigate on a fragment whose id contains a dot', () => {
    const el = mount('<p><a href="#section.2">follow me</a></p>')
    const link = linkOf(el)
    let detail: OpenLeafLinkDetail | undefined
    el.addEventListener(LINK_EVENT, (event) => {
      detail = event.detail
    })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(() => link.dispatchEvent(click)).not.toThrow()
    expect(click.defaultPrevented).toBe(true)
    expect(detail?.href).toBe('#section.2')
    expect(link.getAttribute('href')).toBe('#section.2')
  })

  it('does not intercept a click when the editor is editable', () => {
    const el = mount('<p><a href="https://example.org/a;b=1">follow me</a></p>')
    el.removeAttribute('readonly')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    linkOf(el).dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})
