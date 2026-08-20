/**
 * Inserting an imported document.
 *
 * Three decisions worth stating, because all three are about not surprising an
 * author:
 *
 *   - Imported content is **inserted at the cursor**, never used to replace the
 *     document. Replacing is a thing an author can do themselves by selecting
 *     all first; silently discarding what they had written is not recoverable by
 *     any amount of care afterwards.
 *   - It goes through the **paste** pipeline, not a separate one. A file saved
 *     from Word is the same markup a Word paste produces, and having two code
 *     paths that normalize the same thing differently is how one of them rots.
 *   - The cursor it inserts at is the one that was current when the import
 *     started, carried forward through everything typed while the file was
 *     converting -- see `bookmark.ts`, which is where that turns out to be
 *     harder than it looks.
 */

import { parseHtml } from '@openleaf-editor/core'
import type { EditorView } from 'prosemirror-view'
import { trackSelection } from './bookmark.js'
import { convertFile, type ConversionResult } from './converters.js'
import { importLimits } from './limits.js'

export interface ImportOutcome {
  ok: boolean
  /** Plain-language notes for the author: what did not come across. */
  warnings: string[]
  /** Set when the file could not be handled at all. */
  error?: string
}

/**
 * What to say when the editor went away mid-conversion.
 *
 * Not an exception. A closed editor is a normal thing for a page to do, and the
 * import returning an outcome rather than rejecting is what lets a multi-file
 * import report the files it did not get to instead of abandoning them silently.
 */
function torndown(name: string): ImportOutcome {
  return {
    ok: false,
    warnings: [],
    error: `${name} was not imported: the editor closed while the file was converting.`,
  }
}

/** Convert a file and insert it at the current selection. */
export async function importFileIntoView(view: EditorView, file: File): Promise<ImportOutcome> {
  // A destroyed view has no `state` at all, so even reading the selection to
  // start tracking it would throw.
  if (view.isDestroyed) return torndown(file.name)

  const doc = view.dom.ownerDocument
  const tracked = trackSelection(view)
  let converted: ConversionResult | null

  try {
    converted = await convertFile(file, doc)
  } catch (error) {
    tracked.release()
    return {
      ok: false,
      warnings: [],
      error: `${file.name} could not be read: ${(error as Error).message}`,
    }
  }

  // Every path below this point touches the view, and the await above is long
  // enough for the editor to have been destroyed under it -- a route change, a
  // dialog closing. `view.state` is null by then, and reading it threw an
  // unhandled rejection that the call sites discarded.
  if (view.isDestroyed) {
    tracked.release()
    return torndown(file.name)
  }

  if (!converted) {
    tracked.release()
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
    tracked.release()
    return { ok: false, warnings, error: `${file.name} contained no importable content.` }
  }

  const selection = tracked.release()
  if (!selection) return torndown(file.name)

  const tr = view.state.tr
    .setSelection(selection)
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

  /*
   * A cap on how many files one gesture may import.
   *
   * Dropping a folder is one gesture and can be thousands of files, each of
   * which is read, converted and inserted with no way to stop it. Refusing the
   * whole batch is better than importing an arbitrary prefix of it: the author
   * can see what they dropped and drop less.
   */
  const { maxFiles } = importLimits()
  if (files.length > maxFiles) {
    return {
      ok: false,
      warnings,
      error:
        `${files.length} files at once is more than this editor will import ` +
        `(the limit is ${maxFiles}). Import them in smaller batches.`,
    }
  }

  for (const [index, file] of files.entries()) {
    if (view.isDestroyed) {
      const remaining = files.slice(index).map((item) => item.name)
      errors.push(
        `The editor closed before ${remaining.join(', ')} ` +
          `${remaining.length === 1 ? 'was' : 'were'} imported.`,
      )
      break
    }

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
