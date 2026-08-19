/**
 * Inserting an imported document.
 *
 * Two decisions worth stating, because both are about not surprising an author:
 *
 *   - Imported content is **inserted at the cursor**, never used to replace the
 *     document. Replacing is a thing an author can do themselves by selecting
 *     all first; silently discarding what they had written is not recoverable by
 *     any amount of care afterwards.
 *   - It goes through the **paste** pipeline, not a separate one. A file saved
 *     from Word is the same markup a Word paste produces, and having two code
 *     paths that normalize the same thing differently is how one of them rots.
 */

import { parseHtml } from '@openleaf-editor/core'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { convertFile, type ConversionResult } from './converters.js'

export interface ImportOutcome {
  ok: boolean
  /** Plain-language notes for the author: what did not come across. */
  warnings: string[]
  /** Set when the file could not be handled at all. */
  error?: string
}

/**
 * Map a selection through transactions that happen while conversion is in flight.
 *
 * Conversion of a `.docx` can take long enough for the author to keep typing.
 * Reading `view.state.selection` after `await` would insert at the new caret.
 */
function trackSelection(view: EditorView): {
  release: () => { from: number; to: number }
} {
  let from = view.state.selection.from
  let to = view.state.selection.to
  let released = false

  const plugin = new Plugin({
    appendTransaction(transactions) {
      for (const tr of transactions) {
        from = tr.mapping.map(from, -1)
        to = tr.mapping.map(to, 1)
      }
      return null
    },
  })

  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, plugin] }))

  return {
    release() {
      if (!released) {
        released = true
        view.updateState(
          view.state.reconfigure({
            plugins: view.state.plugins.filter((item) => item !== plugin),
          }),
        )
      }
      const size = view.state.doc.content.size
      const mappedFrom = Math.max(0, Math.min(from, size))
      const mappedTo = Math.max(0, Math.min(to, size))
      return mappedFrom <= mappedTo
        ? { from: mappedFrom, to: mappedTo }
        : { from: mappedTo, to: mappedFrom }
    },
  }
}

/** Convert a file and insert it at the current selection. */
export async function importFileIntoView(view: EditorView, file: File): Promise<ImportOutcome> {
  const doc = view.dom.ownerDocument
  const bookmark = trackSelection(view)
  let converted: ConversionResult | null

  try {
    converted = await convertFile(file, doc)
  } catch (error) {
    bookmark.release()
    return {
      ok: false,
      warnings: [],
      error: `${file.name} could not be read: ${(error as Error).message}`,
    }
  }

  if (!converted) {
    bookmark.release()
    return {
      ok: false,
      warnings: [],
      error:
        `${file.name} is not a format this editor can import. ` +
        'HTML and plain text work out of the box; other formats need a converter ' +
        'registered by the site.',
    }
  }

  const warnings = [...(converted.warnings ?? [])]

  // Parsed against the view's own schema, so an extension's node types are
  // available and nothing is built from a schema the editor's state would reject.
  const parsed = parseHtml(converted.html, { schema: view.state.schema, document: doc })

  if (parsed.content.size === 0) {
    bookmark.release()
    return { ok: false, warnings, error: `${file.name} contained no importable content.` }
  }

  const { from, to } = bookmark.release()
  const $from = view.state.doc.resolve(from)
  const $to = view.state.doc.resolve(to)
  const tr = view.state.tr
    .setSelection(TextSelection.between($from, $to))
    .replaceSelectionWith(parsed, false)
    .scrollIntoView()
  view.dispatch(tr)
  view.focus()

  return { ok: true, warnings }
}

/** Import several files in order, collecting every warning. */
export async function importFilesIntoView(
  view: EditorView,
  files: readonly File[],
): Promise<ImportOutcome> {
  const warnings: string[] = []
  const errors: string[] = []

  for (const file of files) {
    const outcome = await importFileIntoView(view, file)
    warnings.push(...outcome.warnings.map((w) => `${file.name}: ${w}`))
    if (outcome.error) errors.push(outcome.error)
  }

  return {
    ok: errors.length === 0,
    warnings,
    ...(errors.length > 0 ? { error: errors.join('\n') } : {}),
  }
}
