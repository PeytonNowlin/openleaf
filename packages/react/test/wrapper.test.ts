/**
 * The first test this package has ever had.
 *
 * `react-dom` was not in the lockfile, so nothing in this repository had ever
 * rendered the React component -- which is how it shipped three betas with no
 * `forwardRef` (the whole imperative API unreachable), no `'use client'` (broken
 * under the Next.js App Router) and a prop type that rejected `skin`, `theme`
 * and `autoresize`, all three of which the element documents.
 */

import { createElement, createRef, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenLeafEditor, type OpenLeafEditorHandle } from '../src/index.js'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function editor(): HTMLElementTagNameMap['openleaf-editor'] {
  const found = container.querySelector('openleaf-editor')
  if (!found) throw new Error('the component rendered no element')
  return found
}

describe('the React wrapper', () => {
  it('mounts, and a set value reaches the element', () => {
    act(() => {
      root.render(createElement(OpenLeafEditor, { value: '<p>hello</p>' }))
    })
    expect(editor().value).toBe('<p>hello</p>')

    act(() => {
      root.render(createElement(OpenLeafEditor, { value: '<p>changed</p>' }))
    })
    expect(editor().value).toBe('<p>changed</p>')
  })

  it('calls onOpenLeafChange with the html from the event detail', () => {
    const onOpenLeafChange = vi.fn()
    act(() => {
      root.render(createElement(OpenLeafEditor, { value: '<p>a</p>', onOpenLeafChange }))
    })

    const el = editor()
    el.value = '<p>b</p>'
    expect(onOpenLeafChange).toHaveBeenCalledWith('<p>b</p>')
  })

  it('removes its listener on unmount', () => {
    const onOpenLeafChange = vi.fn()
    act(() => {
      root.render(createElement(OpenLeafEditor, { value: '<p>a</p>', onOpenLeafChange }))
    })
    const el = editor()
    act(() => root.unmount())

    onOpenLeafChange.mockClear()
    el.dispatchEvent(new CustomEvent('openleaf:change', { detail: { value: '<p>z</p>' } }))
    expect(onOpenLeafChange).not.toHaveBeenCalled()

    // Re-created so the shared afterEach has something to unmount.
    root = createRoot(container)
  })

  it('exposes the element through a ref, so the imperative API is reachable', () => {
    const ref = createRef<OpenLeafEditorHandle>()
    act(() => {
      root.render(createElement(OpenLeafEditor, { ref, value: '<p>x</p>' }))
    })
    expect(ref.current).toBe(editor())
    // Every member the wrapper previously made unreachable.
    expect(ref.current?.view).not.toBeNull()
    expect(ref.current?.schema).toBeTruthy()
    expect(ref.current?.sourceMode).toBe(false)
    expect(ref.current?.toolbarInstance).not.toBeNull()
    expect('imageUploader' in (ref.current as object)).toBe(true)
  })

  it('forwards the attributes its prop type used to reject', () => {
    act(() => {
      root.render(
        createElement(OpenLeafEditor, {
          skin: 'midnight',
          theme: 'dark',
          autoresize: true,
          'aria-label': 'Post body',
          toolbar: 'bold italic',
        }),
      )
    })
    const el = editor()
    expect(el.getAttribute('skin')).toBe('midnight')
    expect(el.getAttribute('theme')).toBe('dark')
    expect(el.getAttribute('toolbar')).toBe('bold italic')
    // A boolean attribute is presence, not the string "true".
    expect(el.getAttribute('autoresize')).toBe('')
    expect(el.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('Post body')
  })

  it('renders a false boolean as an absent attribute, not autoresize="false"', () => {
    act(() => {
      root.render(createElement(OpenLeafEditor, { autoresize: false }))
    })
    // `hasAttribute` is what the element tests, so any value at all would be on.
    expect(editor().hasAttribute('autoresize')).toBe(false)
  })
})
