/**
 * Preview and print have to look like the canvas, not like a generic light page.
 *
 * The iframe is a separate document, so the host's scoped content-css, skin
 * tokens, and direction do not inherit into it. These tests parse that generated
 * document -- not the srcdoc string -- and check each source on its own, because
 * a single combined assertion would hide two of the three still being missing.
 *
 * Two print behaviours are not asserted here, because jsdom cannot:
 * `window.print()` itself (it is "not implemented"), and the computed colour of
 * an `h2` after `<link>` content-css loads (jsdom does not fetch or apply that
 * sheet). The generated DOM is what we can prove.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { printHtml, showPreview } from '../src/dialogs.js'

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

beforeEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('dir')
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('dir')
  vi.restoreAllMocks()
})

function canvasHost(): HTMLElement {
  const host = document.createElement('openleaf-editor')
  host.className = 'ol-editor'
  host.setAttribute('content-css', '/published.css')
  host.setAttribute('dir', 'rtl')
  host.setAttribute('lang', 'ar')
  host.setAttribute('skin', 'midnight')
  host.setAttribute('data-ol-skin', 'midnight')
  host.setAttribute('data-ol-scheme', 'dark')
  document.body.append(host)
  return host
}

/**
 * The generated document, parsed. Preview lives in `srcdoc` (the frame is
 * sandboxed unique-origin, so `contentDocument` is the wrong place to look).
 * Print uses the same srcdoc shape so both surfaces assert the same way.
 */
function parsedDocument(iframe: HTMLIFrameElement): Document {
  const srcdoc = iframe.getAttribute('srcdoc')
  if (srcdoc == null || srcdoc === '') {
    throw new Error('generated iframe has no srcdoc')
  }
  return new DOMParser().parseFromString(srcdoc, 'text/html')
}

const MIXED = '<h2 dir="ltr">Styled heading</h2><p>نص</p>'

describe('preview', () => {
  it('loads the canvas content stylesheet, skin tokens, and direction together', () => {
    showPreview(document, MIXED, canvasHost())
    const iframe = document.querySelector<HTMLIFrameElement>('iframe.ol-preview-frame')
    expect(iframe).not.toBeNull()
    const parsed = parsedDocument(iframe!)
    const root = parsed.documentElement

    // Three independent assertions: any one of these can pass while the
    // other two are still the original hardcoded light sheet.
    expect(parsed.querySelector('link[rel="stylesheet"][href="/published.css"]')).not.toBeNull()
    expect(root.getAttribute('data-ol-skin')).toBe('midnight')
    expect(root.style.getPropertyValue('--openleaf-color-surface').trim()).toBe('#0d1117')
    expect(root.getAttribute('dir')).toBe('rtl')
  })

  it('keeps a per-block dir when the root is the other direction', () => {
    showPreview(document, MIXED, canvasHost())
    const parsed = parsedDocument(document.querySelector('iframe.ol-preview-frame')!)
    expect(parsed.documentElement.getAttribute('dir')).toBe('rtl')
    expect(parsed.querySelector('h2')?.getAttribute('dir')).toBe('ltr')
  })

  it('declares the canvas language, not a hardcoded English fallback', () => {
    showPreview(document, MIXED, canvasHost())
    const parsed = parsedDocument(document.querySelector('iframe.ol-preview-frame')!)
    expect(parsed.documentElement.getAttribute('lang')).toBe('ar')
  })

  it('does not invent table borders the published sheet did not ask for', () => {
    showPreview(document, '<table><tr><td>a</td></tr></table>', canvasHost())
    const parsed = parsedDocument(document.querySelector('iframe.ol-preview-frame')!)
    const css = [...parsed.querySelectorAll('style')].map((el) => el.textContent ?? '').join('\n')
    expect(css).not.toMatch(/td\s*,\s*th[^{]*\{[^}]*border/)
  })
})

describe('print', () => {
  it('carries content-css and dir, and does not print a dark skin as a black page', () => {
    printHtml(document, MIXED, 'Document', canvasHost())
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"]')
    expect(iframe).not.toBeNull()
    const parsed = parsedDocument(iframe!)
    const root = parsed.documentElement

    expect(parsed.querySelector('link[rel="stylesheet"][href="/published.css"]')).not.toBeNull()
    expect(root.getAttribute('dir')).toBe('rtl')
    expect(parsed.querySelector('h2')?.getAttribute('dir')).toBe('ltr')
    // Midnight on paper is a rectangle of toner. Light skins still apply;
    // a dark scheme is dropped.
    expect(root.getAttribute('data-ol-scheme')).not.toBe('dark')
    expect(root.style.getPropertyValue('--openleaf-color-surface').trim()).not.toBe('#0d1117')
  })

  it('keeps a light skin when printing', () => {
    const host = document.createElement('openleaf-editor')
    host.setAttribute('skin', 'paper')
    host.setAttribute('data-ol-skin', 'paper')
    host.setAttribute('data-ol-scheme', 'light')
    document.body.append(host)
    printHtml(document, '<p>hello</p>', 'Document', host)
    const parsed = parsedDocument(document.querySelector('iframe[aria-hidden="true"]')!)
    expect(parsed.documentElement.getAttribute('data-ol-skin')).toBe('paper')
    expect(parsed.documentElement.style.getPropertyValue('--openleaf-color-surface').trim()).toBe('#fbf7f0')
  })
})
