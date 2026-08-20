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

/** The element and the class a format token names. Either half may be absent. */
export interface FormatParts {
  /** `p`, `h1`..`h6`, or null when the token names only a class. */
  element: string | null
  /** Space-separated class names, or null when the token names only an element. */
  className: string | null
}

/**
 * Split a format token into the element it names and the class it names.
 *
 * `p.lead` is both, `h2` is an element alone, `.note` is a class alone. The
 * element half was previously parsed and then thrown away, so `h2=Section` set
 * `class="h2"` on whichever block held the caret instead of making it a heading,
 * and `p.lead` applied its class to an h2 without turning it into a paragraph.
 *
 * A selector naming several classes -- `p.lead.wide` -- yields both, because
 * that is what the selector means.
 */
export function formatParts(token: string): FormatParts {
  const trimmed = token.trim()
  const dot = trimmed.indexOf('.')
  if (dot === -1) return { element: trimmed === '' ? null : trimmed, className: null }
  const element = trimmed.slice(0, dot).trim()
  const classes = trimmed
    .slice(dot + 1)
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return {
    element: element === '' ? null : element,
    className: classes.length > 0 ? classes.join(' ') : null,
  }
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

/**
 * Every text block in the selection, over every selected RANGE.
 *
 * `selection.from`/`to` are one range's bounds, so a table column selection --
 * which is one range per cell -- reported a single cell's paragraph and the
 * format was applied to just that one. See `selectedRanges` in commands.ts.
 */
function textBlocks(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const found: Array<{ pos: number; node: PMNode }> = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) return true
      if (!seen.has(pos)) {
        seen.add(pos)
        found.push({ pos, node })
      }
      return false
    })
  }
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
