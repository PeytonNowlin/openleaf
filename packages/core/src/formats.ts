/**
 * Block formats: a class on the current text block, stored as carried residue.
 *
 * OpenLeaf does not invent a format vocabulary. The host page's content CSS
 * already names the classes that survive publish (`lead`, `callout`, a CMS
 * style pack). Applying one of those classes here is the same attribute the
 * preservation layer already round-trips; the command exists so a dropdown can
 * set it without the author editing HTML.
 */

import type { Node as PMNode } from 'prosemirror-model'
import type { Command, EditorState } from 'prosemirror-state'
import { CARRIED_ATTR } from './extensions.js'

export interface FormatSpec {
  /** Selector-ish token: `p.lead`, `h2`, or `.note`. */
  token: string
  /** Label shown in the formats control. */
  label: string
}

/** Parse `p.lead=Lead paragraph|h2=Section|.note=Note`. */
export function parseFormatList(value: string | null | undefined): FormatSpec[] {
  if (!value) return []
  const out: FormatSpec[] = []
  for (const part of value.split('|')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) {
      out.push({ token: trimmed, label: trimmed })
      continue
    }
    const token = trimmed.slice(0, eq).trim()
    const label = trimmed.slice(eq + 1).trim()
    if (token) out.push({ token, label: label || token })
  }
  return out
}

export function carriedClass(node: PMNode): string | null {
  const carried = node.attrs[CARRIED_ATTR] as Record<string, string> | null | undefined
  const value = carried?.['class']
  return value && value.trim() !== '' ? value : null
}

function textBlocks(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const found: Array<{ pos: number; node: PMNode }> = []
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    found.push({ pos, node })
    return false
  })
  return found
}

/** The class shared by every selected text block, or null if mixed or absent. */
export function activeBlockClass(state: EditorState): string | null {
  const blocks = textBlocks(state)
  const first = blocks[0]
  if (!first) return null
  const value = carriedClass(first.node)
  return blocks.every((b) => carriedClass(b.node) === value) ? value : null
}

function withClass(node: PMNode, className: string | null): Record<string, unknown> {
  const carried = { ...((node.attrs[CARRIED_ATTR] as Record<string, string> | null) ?? {}) }
  if (className) carried['class'] = className
  else delete carried['class']
  return {
    ...node.attrs,
    [CARRIED_ATTR]: Object.keys(carried).length > 0 ? carried : null,
  }
}

/** Set or clear `class` on every text block in the selection. */
export function setBlockClass(className: string | null): Command {
  return (state, dispatch) => {
    const blocks = textBlocks(state)
    if (blocks.length === 0) return false
    if (dispatch) {
      const tr = state.tr
      for (const { pos, node } of blocks) {
        tr.setNodeMarkup(pos, undefined, withClass(node, className))
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
