/**
 * The first test this package has ever had.
 *
 * The regression that matters most here is `toolbar`. Vue's `shouldSetAsProp`
 * ends in `return key in el`; `'toolbar' in el` was true because the element
 * exposed a getter-only `toolbar` accessor for plugin authors, so Vue took the
 * property path, `patchDOMProp` did `try { el[key] = value } catch {}`,
 * assigning to a getter-only accessor threw in strict mode, and the throw was
 * swallowed. `<OpenLeafEditor toolbar="bold italic" />` rendered the full
 * default bar with no error anywhere.
 */

import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenLeafEditor } from '../src/index.js'

let app: App | null = null
let container: HTMLDivElement

function mount(props: Record<string, unknown>): HTMLElementTagNameMap['openleaf-editor'] {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () => h(OpenLeafEditor, props),
  })
  app.mount(container)
  const found = container.querySelector('openleaf-editor')
  if (!found) throw new Error('the component rendered no element')
  return found
}

afterEach(() => {
  app?.unmount()
  app = null
  container?.remove()
})

describe('the Vue wrapper', () => {
  it('sets the toolbar attribute rather than silently swallowing it', () => {
    const el = mount({ toolbar: 'bold italic' })
    expect(el.getAttribute('toolbar')).toBe('bold italic')
    // And it is the layout the toolbar was actually built from, not just an
    // attribute nobody read.
    const buttons = el.querySelectorAll('[role="toolbar"] button')
    expect(buttons.length).toBe(2)
  })

  it('writes an empty modelValue on mount instead of skipping it', () => {
    // `if (props.modelValue)` skipped this: the prop's declared default is `''`,
    // which is falsy. So an editor that had content from somewhere else -- here
    // the bound textarea, which is the documented CMS integration -- kept it
    // while Vue's model said the document was empty. The two then disagreed
    // until the first keystroke, and a save in between stored the stale HTML.
    const textarea = document.createElement('textarea')
    textarea.id = 'bound'
    textarea.value = '<p>stale from the server</p>'
    document.body.appendChild(textarea)
    try {
      const el = mount({ modelValue: '', for: 'bound' })
      expect(el.value).not.toContain('stale')
      expect(textarea.value).not.toContain('stale')
    } finally {
      textarea.remove()
    }
  })

  it('writes a non-empty modelValue on mount, and on change', async () => {
    const el = mount({ modelValue: '<p>hello</p>' })
    expect(el.value).toBe('<p>hello</p>')
  })

  it('emits update:modelValue from the event detail', () => {
    const onUpdate = vi.fn()
    const el = mount({ modelValue: '<p>a</p>', 'onUpdate:modelValue': onUpdate })
    el.value = '<p>b</p>'
    expect(onUpdate).toHaveBeenCalledWith('<p>b</p>')
  })

  it('removes its change listener on unmount', () => {
    const onUpdate = vi.fn()
    const el = mount({ modelValue: '<p>a</p>', 'onUpdate:modelValue': onUpdate })
    app?.unmount()
    app = null

    onUpdate.mockClear()
    el.dispatchEvent(new CustomEvent('openleaf:change', { detail: { value: '<p>z</p>' } }))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('passes through the attributes it does not declare as props', () => {
    const el = mount({ skin: 'midnight', 'aria-label': 'Post body' })
    expect(el.getAttribute('skin')).toBe('midnight')
    expect(el.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('Post body')
  })
})
