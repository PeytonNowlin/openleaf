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

import { parseHtml } from '@openleaf/core'
import type { EditorView } from 'prosemirror-view'
import { convertFile, type ConversionResult } from './converters.js'

export interface ImportOutcome {
  ok: boolean
  /** Plain-language notes for the author: what did not come across. */
  warnings: string[]
  /** Set when the file could not be handled at all. */
  error?: string
}

/** Convert a file and insert it at the current selection. */
export async function importFileIntoView(view: EditorView, file: File): Promise<ImportOutcome> {
  const doc = view.dom.ownerDocument
  let converted: ConversionResult | null

  try {
    converted = await convertFile(file, doc)
  } catch (error) {
    return {
      ok: false,
      warnings: [],
      error: `${file.name} could not be read: ${(error as Error).message}`,
    }
  }

  if (!converted) {
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
  // available and nothing is built from a schema the state would reject.
  const parsed = parseHtml(converted.html, { schema: view.state.schema, document: doc })

  if (parsed.content.size === 0) {
    return { ok: false, warnings, error: `${file.name} contained no importable content.` }
  }

  const tr = view.state.tr.replaceSelectionWith(parsed, false).scrollIntoView()
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
