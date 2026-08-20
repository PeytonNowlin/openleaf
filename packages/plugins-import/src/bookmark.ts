/**
 * Holding on to where the import was started from.
 *
 * Converting a `.docx` takes long enough for the author to carry on typing, so
 * the caret that was current when they clicked Import is not the caret that will
 * be current when the HTML comes back. Reading `view.state.selection` after the
 * `await` would insert into whatever they had moved on to.
 *
 * ## Why a bookmark rather than two numbers
 *
 * The obvious version keeps `from` and `to` and maps them through every
 * transaction. It is also wrong, in the single most likely case:
 *
 * ```ts
 * from = tr.mapping.map(from, -1)
 * to   = tr.mapping.map(to, 1)
 * ```
 *
 * For a **collapsed** caret `from === to`, and the opposite biases pull the two
 * ends apart around anything inserted at that position. Type five characters
 * while the conversion is in flight and the pair silently grows into a range
 * spanning them -- which the insertion then *replaces*. The author watches their
 * own typing disappear, and the import looks like it worked.
 *
 * `Selection.getBookmark()` is ProseMirror's answer to exactly this question. It
 * maps a selection through a mapping the way ProseMirror maps its own, keeps a
 * collapsed selection collapsed, and resolves back to a valid selection against
 * the new document -- so the clamping and the "if the ends crossed, swap them"
 * repair this file used to carry are not needed.
 *
 * ## Why the plugin is registered at install time
 *
 * The first version added a plugin when an import began and removed it when the
 * import finished, through `state.reconfigure`. Reconfiguring changes the plugin
 * array's identity, and ProseMirror's `updatePluginViews` compares that array by
 * identity: every plugin view in the editor was destroyed and rebuilt, twice per
 * file. Ten dropped files meant twenty rebuilds -- discarding the author's
 * active find query and re-tokenizing every code block, to move two integers.
 *
 * So the plugin is installed once, with the editor, and does nothing measurable
 * until an import is actually pending. Direct callers of `importFileIntoView` on
 * an editor built without it still work: they fall back to the old reconfigure,
 * which is correct, just not free.
 */

import { Plugin, PluginKey, type Selection, type SelectionBookmark } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

/** One pending import's memory of where it started. Mutated in place as the document moves. */
interface Tracked {
  bookmark: SelectionBookmark
}

/**
 * The live trackers belonging to one plugin instance.
 *
 * Keyed on the plugin rather than held in plugin state because it is deliberately
 * mutable: a pending import is not part of the document's history and must not
 * be rolled back by an undo.
 */
const registries = new WeakMap<Plugin, Set<Tracked>>()

export const importBookmarkKey = new PluginKey('openleafImportBookmark')

/**
 * The long-lived plugin that keeps pending imports pointing at the right place.
 *
 * Installed by `installImport()` for every editor. With no import in flight the
 * `appendTransaction` below returns on its first line.
 */
export function importBookmarkPlugin(): Plugin {
  const live = new Set<Tracked>()
  const plugin = new Plugin({
    key: importBookmarkKey,
    appendTransaction(transactions) {
      if (live.size === 0) return null
      for (const tr of transactions) {
        if (!tr.docChanged) continue
        for (const tracked of live) tracked.bookmark = tracked.bookmark.map(tr.mapping)
      }
      return null
    },
  })
  registries.set(plugin, live)
  return plugin
}

export interface TrackedSelection {
  /**
   * Stop tracking and say where the import should go.
   *
   * `null` means the editor was destroyed while the conversion was in flight and
   * there is nowhere to insert -- the caller must not touch the view.
   */
  release: () => Selection | null
}

/** Remember the current selection and follow it through everything that happens next. */
export function trackSelection(view: EditorView): TrackedSelection {
  const tracked: Tracked = { bookmark: view.state.selection.getBookmark() }

  const installed = importBookmarkKey.get(view.state)
  const live = installed ? registries.get(installed) : undefined

  // Fallback for a view built without the plugin -- a direct caller of the
  // exported `importFileIntoView`, or a test mounting a bare EditorView. Correct,
  // but it pays the plugin-view rebuild the registered plugin exists to avoid.
  let temporary: Plugin | null = null

  if (live) {
    live.add(tracked)
  } else {
    temporary = new Plugin({
      appendTransaction(transactions) {
        for (const tr of transactions) {
          if (tr.docChanged) tracked.bookmark = tracked.bookmark.map(tr.mapping)
        }
        return null
      },
    })
    view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, temporary] }))
  }

  let released = false

  return {
    release(): Selection | null {
      if (!released) {
        released = true
        if (live) {
          live.delete(tracked)
        } else if (temporary && !view.isDestroyed) {
          view.updateState(
            view.state.reconfigure({
              plugins: view.state.plugins.filter((item) => item !== temporary),
            }),
          )
        }
      }

      // The editor can be torn down while a conversion is in flight -- a route
      // change, a dialog closing. Reading `view.state` after that is what threw
      // `Cannot read properties of null`.
      if (view.isDestroyed) return null

      try {
        return tracked.bookmark.resolve(view.state.doc)
      } catch {
        // A bookmark that cannot be resolved means the position it named no
        // longer exists in any form. Inserting at the current caret is a worse
        // answer than the original one, but it is a great deal better than
        // throwing away the conversion.
        return view.state.selection
      }
    },
  }
}
