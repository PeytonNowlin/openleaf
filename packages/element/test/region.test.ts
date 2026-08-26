/**
 * The accessible semantics of the editable region itself.
 *
 * These run in jsdom against a real `EditorView`, because what is being checked
 * is the props the element hands ProseMirror and the attributes ProseMirror
 * puts on `contenteditable` -- not layout, selection or input, which need a real
 * engine and live in test/e2e.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

if (!customElements.get('openleaf-editor')) {
  customElements.define('openleaf-editor', OpenLeafEditor)
}

function build(markup: string): { host: OpenLeafEditor; region: HTMLElement } {
  document.body.innerHTML = markup
  const host = document.body.querySelector('openleaf-editor') as OpenLeafEditor
  host.connectedCallback()
  const region = host.querySelector('.ProseMirror') as HTMLElement
  if (!region) throw new Error('the editable region was never built')
  return { host, region }
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('a read-only editor', () => {
  it('tells a screen reader it cannot be edited', () => {
    // Without this the region announces "Rich text editor, edit multiline", the
    // author types, and nothing happens. `contenteditable` alone is not a
    // signal any screen reader reports.
    const { region } = build('<openleaf-editor readonly toolbar="none"><p>hi</p></openleaf-editor>')
    expect(region.getAttribute('contenteditable')).toBe('false')
    expect(region.getAttribute('aria-readonly')).toBe('true')
  })

  it('says so as soon as the attribute is added, not at the next transaction', () => {
    const { host, region } = build('<openleaf-editor toolbar="none"><p>hi</p></openleaf-editor>')
    expect(region.getAttribute('aria-readonly')).toBe('false')
    host.setAttribute('readonly', '')
    expect(region.getAttribute('aria-readonly')).toBe('true')
    host.removeAttribute('readonly')
    expect(region.getAttribute('aria-readonly')).toBe('false')
  })
})

describe('the name of the editable region', () => {
  it('inherits the form label pointing at the bound textarea', () => {
    // The documented integration is <label for="body"> + <textarea id="body">.
    // That label names the TEXTAREA, so without this the region falls back to a
    // generic name and two editors on a page are both "Rich text editor".
    const { region } = build(`
      <label for="body">Article body</label>
      <textarea id="body"></textarea>
      <openleaf-editor for="body" toolbar="none"></openleaf-editor>
    `)
    expect(region.getAttribute('aria-label')).toBe('Article body')
  })

  it('prefers an explicit aria-label over the inherited one', () => {
    const { region } = build(`
      <label for="body">Article body</label>
      <textarea id="body"></textarea>
      <openleaf-editor for="body" aria-label="Summary" toolbar="none"></openleaf-editor>
    `)
    expect(region.getAttribute('aria-label')).toBe('Summary')
  })

  it('follows aria-label when it changes, which is the normal case in React', () => {
    const { host, region } = build('<openleaf-editor aria-label="First" toolbar="none"></openleaf-editor>')
    expect(region.getAttribute('aria-label')).toBe('First')
    host.setAttribute('aria-label', 'Second')
    expect(region.getAttribute('aria-label')).toBe('Second')
  })

  it('falls back to a generic name when nothing else names it', () => {
    const { region } = build('<openleaf-editor toolbar="none"></openleaf-editor>')
    expect(region.getAttribute('aria-label')).toBe('Rich text editor')
  })

  it('gives the host a role when it carries aria-label, which ARIA forbids on generic', () => {
    const { host } = build('<openleaf-editor aria-label="Summary" toolbar="none"></openleaf-editor>')
    expect(host.getAttribute('role')).toBe('group')
  })

  it('leaves an unlabelled host without a role, so nothing is announced twice', () => {
    const { host } = build('<openleaf-editor toolbar="none"></openleaf-editor>')
    expect(host.hasAttribute('role')).toBe(false)
  })
})

describe('the bound textarea', () => {
  it('is hidden even when it lives outside the element', () => {
    // The nested case was already hidden. With the documented `for=` pattern the
    // textarea stayed visible AND focusable, so a keyboard user could tab into
    // it, type, and have FormBridge overwrite every word at submit -- silently,
    // at the exact moment the work was meant to be saved.
    build(`
      <label for="body">Article body</label>
      <textarea id="body"></textarea>
      <openleaf-editor for="body" toolbar="none"></openleaf-editor>
    `)
    const textarea = document.getElementById('body') as HTMLTextAreaElement
    expect(textarea.hidden).toBe(true)
  })

  it('still names the region it is hidden for', () => {
    const { region } = build(`
      <label for="body">Article body</label>
      <textarea id="body"></textarea>
      <openleaf-editor for="body" toolbar="none"></openleaf-editor>
    `)
    expect(region.getAttribute('aria-label')).toBe('Article body')
  })
})

describe('the description of the editable region', () => {
  it('does not repeat the name it is read after', () => {
    // The name is "Rich text editor" and the description used to begin "Rich
    // text editor. Press Alt plus F10..." -- so NVDA read the phrase twice.
    const { host, region } = build('<openleaf-editor><p>hi</p></openleaf-editor>')
    const id = region.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const hint = host.querySelector(`#${id}`)
    expect(hint?.textContent).toBe('Press Alt plus F10 for the formatting toolbar.')
  })

  it('has no description at all when there is no toolbar to describe', () => {
    const { region } = build('<openleaf-editor toolbar="none"><p>hi</p></openleaf-editor>')
    expect(region.hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('placeholder', () => {
  it('paints on an empty document without writing into value', () => {
    // ProseMirror's empty document is a paragraph containing a trailing
    // break, not an empty element, so a CSS `:empty` prompt would never
    // show. The class is the real signal; the prompt is a `::before`.
    const { host, region } = build(
      '<openleaf-editor placeholder="Write the article…" toolbar="none"></openleaf-editor>',
    )
    expect(region.matches(':empty')).toBe(false)
    expect(region.querySelector('p')).not.toBeNull()
    expect(region.classList.contains('ol-placeholder')).toBe(true)
    expect(region.getAttribute('data-placeholder')).toBe('Write the article…')
    expect(region.getAttribute('aria-placeholder')).toBe('Write the article…')
    expect(host.value).toBe('<p></p>')
    expect(host.value).not.toContain('Write the article')
  })

  it('is gone after one character, and still not in value', () => {
    const { host, region } = build(
      '<openleaf-editor placeholder="Write the article…" toolbar="none"></openleaf-editor>',
    )
    host.value = '<p>x</p>'
    expect(region.classList.contains('ol-placeholder')).toBe(false)
    expect(region.hasAttribute('data-placeholder')).toBe(false)
    expect(host.value).toBe('<p>x</p>')
    expect(host.value).not.toContain('Write the article')
  })
})

describe('canvas lang and spellcheck', () => {
  it('copies host lang onto the editable region', () => {
    const { region } = build(
      '<openleaf-editor lang="fr" toolbar="none"><p>bonjour</p></openleaf-editor>',
    )
    expect(region.getAttribute('lang')).toBe('fr')
  })

  it('copies a bound textarea lang when the host has none', () => {
    const { region } = build(`
      <textarea id="body" lang="de"></textarea>
      <openleaf-editor for="body" toolbar="none"></openleaf-editor>
    `)
    expect(region.getAttribute('lang')).toBe('de')
  })

  it('prefers the host lang over the textarea', () => {
    const { region } = build(`
      <textarea id="body" lang="de"></textarea>
      <openleaf-editor for="body" lang="fr" toolbar="none"></openleaf-editor>
    `)
    expect(region.getAttribute('lang')).toBe('fr')
  })

  it('does not copy page lang onto the region, so it can still inherit', () => {
    const previous = document.documentElement.getAttribute('lang')
    document.documentElement.setAttribute('lang', 'it')
    try {
      const { region } = build('<openleaf-editor toolbar="none"></openleaf-editor>')
      expect(region.hasAttribute('lang')).toBe(false)
    } finally {
      if (previous === null) document.documentElement.removeAttribute('lang')
      else document.documentElement.setAttribute('lang', previous)
    }
  })

  it('copies spellcheck="false" onto the canvas, which source view already has', () => {
    const { region } = build(
      '<openleaf-editor spellcheck="false" toolbar="none"><p>code</p></openleaf-editor>',
    )
    expect(region.getAttribute('spellcheck')).toBe('false')
  })
})

