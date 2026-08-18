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
  for (const listener of listeners) listener()
  return () => {
    factories.delete(factory)
  }
}

/** Build one fresh set of plugin instances for a new editor. */
export function createRegisteredPlugins(schema: Schema): Plugin[] {
  return [...factories].flatMap((factory) => factory(schema))
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
  return () => listeners.delete(listener)
}
