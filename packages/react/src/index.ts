/**
 * React binding for `<openleaf-editor>`.
 *
 * The custom element is the editor. This file is a thin host: it forwards
 * attributes, keeps a controlled `value` in sync, and re-emits `openleaf:change`.
 * Editing logic does not live here, so a React tree cannot fork the schema.
 */

import { createElement, useEffect, useRef, type HTMLAttributes } from 'react'
import '@openleaf-editor/element'

export type OpenLeafEditorProps = HTMLAttributes<HTMLElement> & {
  toolbar?: string
  toolbar2?: string
  menubar?: string | boolean
  formats?: string
  lang?: string
  value?: string
  onOpenLeafChange?: (html: string) => void
}

type Host = HTMLElement & { value: string }

export function OpenLeafEditor({
  value,
  onOpenLeafChange,
  menubar,
  ...rest
}: OpenLeafEditorProps) {
  const ref = useRef<Host>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || value === undefined) return
    if (el.value !== value) el.value = value
  }, [value])

  useEffect(() => {
    const el = ref.current
    if (!el || !onOpenLeafChange) return
    const onChange = (): void => {
      onOpenLeafChange(el.value)
    }
    el.addEventListener('openleaf:change', onChange)
    return () => {
      el.removeEventListener('openleaf:change', onChange)
    }
  }, [onOpenLeafChange])

  return createElement('openleaf-editor', {
    ...rest,
    ref,
    menubar: menubar === true ? '' : menubar === false ? undefined : menubar,
  })
}
