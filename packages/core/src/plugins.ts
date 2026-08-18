/**
 * The editor plugin registry.
 *
 * A ProseMirror plugin cannot be added to a running editor, so anything that
 * contributes one has to do it before the view is constructed. This registry is
 * how an opt-in bundle -- loaded by a second `<script>` tag, after the core
 * bundle -- gets its plugins into editors that have not been created yet.
 *
 * Factories rather than plugin instances: a ProseMirror plugin instance carries
 * per-editor state and cannot be shared between two editors on the same page.
 * Calling the factory once per editor is the difference between two working
 * editors and two editors fighting over one plugin's state.
 */

import type { Plugin } from 'prosemirror-state'
import type { Schema } from 'prosemirror-model'

export type EditorPluginFactory = (schema: Schema) => Plugin[]

const factories = new Set<EditorPluginFactory>()
const listeners = new Set<() => void>()

/** Register plugins to be installed in every editor created from now on. */
export function registerEditorPlugin(factory: EditorPluginFactory): () => void {
  factories.add(factory)
  notify()
  return () => {
    // Notify on removal too. Without it the disposer deleted the factory and
    // told nobody, so every editor already on the page kept the plugin running
    // -- a disposer that is observably a no-op in the common case is worse than
    // none, because callers believe it worked.
    if (factories.delete(factory)) notify()
  }
}

/**
 * Notify listeners, isolating each one.
 *
 * These listeners are editors. On a page with three of them, an exception from
 * the second must not stop the third from ever seeing the plugin -- and it must
 * not propagate back out of `registerEditorPlugin` into the calling plugin,
 * where a broken editor would look like a broken install.
 */
function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('@openleaf/core: an editor failed to apply a plugin change', error)
    }
  }
}

/** Build one fresh set of plugin instances for a new editor. */
export function createRegisteredPlugins(schema: Schema): Plugin[] {
  return [...factories].flatMap((factory) => {
    try {
      return factory(schema)
    } catch (error) {
      // A throwing factory used to take EditorState.create with it, so one bad
      // script tag produced a blank editor. Contributing nothing is the right
      // failure: the editor comes up without that plugin.
      console.error('@openleaf/core: a plugin factory threw; skipping it', error)
      return []
    }
  })
}

/**
 * Notified when a plugin registers.
 *
 * An editor already on the page when a deferred bundle finishes loading would
 * otherwise never receive its plugins, and the author would find table controls
 * that do nothing.
 */
export function onEditorPluginsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
