'use client'

/**
 * React binding for `<openleaf-editor>`.
 *
 * The custom element is the editor. This file is a thin host: it forwards
 * attributes, keeps a controlled `value` in sync, and re-emits `openleaf:change`.
 * Editing logic does not live here, so a React tree cannot fork the schema.
 *
 * `'use client'` is the first line and not decoration. This module uses hooks
 * and imports `@openleaf-editor/element` at module scope, so without the
 * directive the Next.js App Router treats it as a Server Component and every
 * App Router integration fails at build with "You're importing a component that
 * needs `useRef`".
 */

import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { AriaAttributes, DOMAttributes, Ref } from 'react'
import '@openleaf-editor/element'
import type { OpenLeafEditor as OpenLeafEditorElement } from '@openleaf-editor/element'

/**
 * What a `ref` gives you: the element itself.
 *
 * There was no `forwardRef` at all, so `.view`, `.schema`, `.toolbarInstance`,
 * `.sourceMode` and `imageUploader` -- the entire imperative API -- were
 * unreachable from React. Not narrowed to a hand-written subset, because the
 * element's own class is the documented surface and a subset here would drift
 * from it.
 */
export type OpenLeafEditorHandle = OpenLeafEditorElement

/**
 * Every attribute the element documents, plus the events React understands.
 *
 * The old type was `HTMLAttributes<HTMLElement> & { six props }`, which does not
 * permit arbitrary props -- so `<OpenLeafEditor skin="midnight" theme="dark"
 * autoresize />`, all three documented in the element's README, was a **compile
 * error** while working perfectly at runtime.
 *
 * `children` and `dangerouslySetInnerHTML` are omitted deliberately. `#build()`
 * does `this.innerHTML = ''`, so React and the element both believe they own
 * the subtree; React then tries to remove children that are no longer there and
 * throws `NotFoundError: Failed to execute 'removeChild' on 'Node'` on unmount.
 */
export interface OpenLeafEditorProps
  extends AriaAttributes,
    Omit<DOMAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** id of the textarea to bind to. */
  for?: string
  /** Named appearance: midnight, paper, contrast, compact. */
  skin?: string
  /** light | dark | auto. */
  theme?: 'light' | 'dark' | 'auto'
  /** Space-separated item ids, `|` for a separator; `none` to omit. */
  toolbar?: string
  /** A second toolbar, same grammar. */
  toolbar2?: string
  /** Space-separated menu ids. `true` means the default set. */
  menubar?: string | boolean
  /** `none` to disable the link, image and table context menus. */
  contextmenu?: string
  /** Floating bar for a non-empty selection; `none` disables. */
  'selection-toolbar'?: string
  /** Floating bar for an empty block; `none` disables. */
  'insert-toolbar'?: string
  /** `p.lead=Lead|h2=Section` entries for the formats dropdown. */
  formats?: string
  /** Comma-separated URLs scoped onto the canvas. */
  'content-css'?: string
  /** UI locale, matched against registerTranslations(). */
  lang?: string
  /** Hide chrome until the editor is focused. */
  inline?: boolean
  /** Grow the canvas with the document. */
  autoresize?: boolean
  /** Collapse overflowing groups into a More menu. */
  'toolbar-overflow'?: boolean
  /** Show markers for empty blocks and non-breaking spaces. Default true. */
  visualaids?: boolean
  /** Linkify typed URLs. Default true. */
  autolink?: boolean
  /** Render but do not allow editing. */
  readonly?: boolean
  /** Accessible name for the editable region. */
  'aria-label'?: string
  className?: string
  id?: string
  style?: React.CSSProperties
  /** The document, as HTML. Controlled. */
  value?: string
  /** Called with the document as HTML on every change. */
  onOpenLeafChange?: (html: string) => void
}

/**
 * React 18 stringifies whatever it is given onto a custom element, so
 * `autoresize={false}` would set `autoresize="false"` -- and the element tests
 * these with `hasAttribute`, which is true for any value at all. Booleans are
 * therefore normalized here to the presence/absence the HTML spec means.
 */
const BOOLEAN_PROPS = [
  'inline',
  'autoresize',
  'toolbar-overflow',
  'readonly',
] as const

export const OpenLeafEditor = forwardRef(function OpenLeafEditor(
  { value, onOpenLeafChange, menubar, ...rest }: OpenLeafEditorProps,
  ref: Ref<OpenLeafEditorHandle>,
) {
  const host = useRef<OpenLeafEditorElement>(null)

  useImperativeHandle(ref, () => host.current as OpenLeafEditorElement, [])

  useEffect(() => {
    const el = host.current
    if (!el || value === undefined) return
    if (el.value !== value) el.value = value
  }, [value])

  useEffect(() => {
    const el = host.current
    if (!el || !onOpenLeafChange) return
    // The detail carries the already-serialized document, so reading `.value`
    // back off the element -- which serializes it a second time, on every
    // keystroke -- is no longer necessary.
    const onChange = (event: HTMLElementEventMap['openleaf:change']): void => {
      onOpenLeafChange(event.detail.value)
    }
    el.addEventListener('openleaf:change', onChange)
    return () => {
      el.removeEventListener('openleaf:change', onChange)
    }
  }, [onOpenLeafChange])

  const attributes: Record<string, unknown> = { ...rest }
  for (const name of BOOLEAN_PROPS) {
    const flag = attributes[name]
    if (typeof flag === 'boolean') attributes[name] = flag ? '' : undefined
  }
  // `visualaids` and `autolink` are opt-OUT: the element reads them as
  // `!== 'false'`, so the flag has to be spelled out rather than removed.
  for (const name of ['visualaids', 'autolink'] as const) {
    const flag = attributes[name]
    if (typeof flag === 'boolean') attributes[name] = flag ? 'true' : 'false'
  }

  return createElement('openleaf-editor', {
    ...attributes,
    ref: host,
    menubar: menubar === true ? '' : menubar === false ? undefined : menubar,
  })
})
