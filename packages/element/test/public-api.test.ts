/**
 * The element's public contract, from a consumer's side of it.
 *
 * Every case here is a claim that was reproduced as broken first: a documented
 * property missing from the type, an attribute that reactively did nothing, an
 * event that could not cross a shadow boundary, and an event with no detail.
 */

import { describe, expect, it } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

function mount(attributes: Record<string, string> = {}): OpenLeafEditor {
  const el = document.createElement('openleaf-editor')
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  document.body.appendChild(el)
  return el
}

function editable(el: OpenLeafEditor): Element {
  const found = el.querySelector('[role="textbox"]')
  if (!found) throw new Error('the editor built no editable region')
  return found
}

function buttonIds(el: OpenLeafEditor): number {
  return el.querySelectorAll('[role="toolbar"] button').length
}

describe('the element as the DOM sees it', () => {
  it('is an OpenLeafEditor from createElement and from querySelector', () => {
    const made = mount()
    try {
      // Both of these are the tag-map augmentation doing its job -- without it
      // these are `HTMLElement` and `Element`, neither of which has `.value`.
      expect(made).toBeInstanceOf(OpenLeafEditor)
      expect(document.querySelector('openleaf-editor')).toBe(made)
      expect(typeof made.value).toBe('string')
    } finally {
      made.remove()
    }
  })

  it('carries an imageUploader property', () => {
    const el = mount()
    try {
      expect(el.imageUploader).toBeNull()
      const uploader = async (): Promise<string> => 'https://example.com/a.png'
      el.imageUploader = uploader
      expect(el.imageUploader).toBe(uploader)
    } finally {
      el.remove()
    }
  })
})

describe('openleaf:change', () => {
  it('carries the html in its detail', () => {
    const el = mount()
    try {
      let detail: { value: string } | undefined
      el.addEventListener('openleaf:change', (event) => {
        detail = event.detail
      })
      el.value = '<p>typed</p>'
      expect(detail?.value).toBe('<p>typed</p>')
    } finally {
      el.remove()
    }
  })

  it('crosses a shadow boundary', () => {
    // Every Lit, Stencil and LWC design system puts the editor inside its own
    // shadow root. Without `composed: true` a bubbling event stops dead at the
    // boundary and such a host never receives this at all.
    const shadowHost = document.createElement('div')
    document.body.appendChild(shadowHost)
    const root = shadowHost.attachShadow({ mode: 'open' })
    const el = document.createElement('openleaf-editor')
    root.appendChild(el)
    try {
      let seen = 0
      let detail: { value: string } | undefined
      // Listening on `document`, which is what a delegated listener does and
      // what the DocumentEventMap augmentation exists to type.
      document.addEventListener('openleaf:change', (event) => {
        seen += 1
        detail = event.detail
      })
      el.value = '<p>inside a shadow root</p>'
      expect(seen).toBe(1)
      expect(detail?.value).toBe('<p>inside a shadow root</p>')
    } finally {
      shadowHost.remove()
    }
  })

  it('does not fire when a summary is clicked on a readonly editor', () => {
    const el = mount({ readonly: '' })
    try {
      const html = '<details><summary>Label</summary><p>body</p></details>'
      el.value = html
      const assigned = el.value
      const changes: string[] = []
      el.addEventListener('openleaf:change', (event) => {
        changes.push(event.detail.value)
      })
      const summary = el.querySelector('summary')
      expect(summary).not.toBeNull()
      summary!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      summary!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(el.value).toBe(assigned)
      expect(changes).toEqual([])
    } finally {
      el.remove()
    }
  })

  it('does not fire when the value is set to what it already holds', () => {
    const el = mount()
    try {
      el.value = '<p>same</p>'
      let seen = 0
      el.addEventListener('openleaf:change', () => {
        seen += 1
      })
      el.value = '<p>same</p>'
      expect(seen).toBe(0)
    } finally {
      el.remove()
    }
  })
})

describe('attributes are reactive, not build-time only', () => {
  it('rebuilds the toolbar when `toolbar` changes', () => {
    const el = mount({ toolbar: 'bold italic' })
    try {
      expect(buttonIds(el)).toBe(2)
      el.setAttribute('toolbar', 'bold')
      expect(buttonIds(el)).toBe(1)
      // And exactly one toolbar is left behind, not two.
      expect(el.querySelectorAll('[role="toolbar"]').length).toBe(1)
    } finally {
      el.remove()
    }
  })

  it('keeps the document and the view across a toolbar rebuild', () => {
    const el = mount({ toolbar: 'bold italic' })
    try {
      el.value = '<p>survives</p>'
      const before = el.view
      el.setAttribute('toolbar', 'bold')
      expect(el.value).toBe('<p>survives</p>')
      // Same view instance: the canvas is re-parented, never replaced, which is
      // what keeps the undo history too.
      expect(el.view).toBe(before)
    } finally {
      el.remove()
    }
  })

  it('relabels the editable region when `aria-label` changes', () => {
    const el = mount({ 'aria-label': 'Post body' })
    try {
      expect(editable(el).getAttribute('aria-label')).toBe('Post body')
      el.setAttribute('aria-label', 'Summary')
      expect(editable(el).getAttribute('aria-label')).toBe('Summary')
    } finally {
      el.remove()
    }
  })

  it('adds and removes the menubar', () => {
    const el = mount()
    try {
      expect(el.querySelector('[role="menubar"]')).toBeNull()
      el.setAttribute('menubar', 'edit')
      expect(el.querySelector('[role="menubar"]')).not.toBeNull()
      el.setAttribute('menubar', 'none')
      expect(el.querySelector('[role="menubar"]')).toBeNull()
    } finally {
      el.remove()
    }
  })

  it('toggles the inline and autoresize classes', () => {
    const el = mount()
    try {
      expect(el.classList.contains('ol-inline')).toBe(false)
      el.setAttribute('inline', '')
      expect(el.classList.contains('ol-inline')).toBe(true)
      el.removeAttribute('inline')
      expect(el.classList.contains('ol-inline')).toBe(false)

      el.setAttribute('autoresize', '')
      expect(el.classList.contains('ol-autoresize')).toBe(true)
      el.removeAttribute('autoresize')
      expect(el.classList.contains('ol-autoresize')).toBe(false)
    } finally {
      el.remove()
    }
  })
})

describe('properties reflect their attributes', () => {
  it('assigning toolbar sets the attribute rather than throwing', () => {
    const el = mount()
    try {
      // The getter-only accessor this replaced is what every framework binding
      // fell into: assigning threw, the framework swallowed it, and the prop
      // was silently ignored.
      el.toolbar = 'bold italic'
      expect(el.getAttribute('toolbar')).toBe('bold italic')
      expect(buttonIds(el)).toBe(2)
      el.toolbar = null
      expect(el.hasAttribute('toolbar')).toBe(false)
    } finally {
      el.remove()
    }
  })

  it('exposes the toolbar itself under toolbarInstance', () => {
    const el = mount({ toolbar: 'bold' })
    try {
      expect(typeof el.toolbarInstance?.setItemState).toBe('function')
      expect(typeof el.toolbarInstance?.focusToolbar).toBe('function')
    } finally {
      el.remove()
    }
  })

  it('reflects readOnly both ways', () => {
    const el = mount()
    try {
      expect(el.readOnly).toBe(false)
      el.readOnly = true
      expect(el.hasAttribute('readonly')).toBe(true)
      el.removeAttribute('readonly')
      expect(el.readOnly).toBe(false)
    } finally {
      el.remove()
    }
  })
})
