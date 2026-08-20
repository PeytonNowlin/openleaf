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
import { OpenLeafError } from './errors.js'

export type EditorPluginFactory = (schema: Schema) => Plugin[]

const factories = new Set<EditorPluginFactory>()
const listeners = new Set<() => void>()

/**
 * Register plugins to be installed in every editor created from now on.
 *
 * Throws `OpenLeafError` with code `invalid-argument` when handed something that
 * is not a function. `registerEditorPlugin(42)` used to be accepted silently and
 * fail on the far side of the registry -- once per editor, through
 * `console.error`, with a stack pointing at `createRegisteredPlugins` rather
 * than at the script tag that got it wrong.
 */
export function registerEditorPlugin(factory: EditorPluginFactory): () => void {
  if (typeof factory !== 'function') {
    throw new OpenLeafError(
      'invalid-argument',
      '@openleaf-editor/core: registerEditorPlugin expects a function taking a schema and ' +
        `returning an array of ProseMirror plugins, received ${typeof factory}. Passing a ` +
        'plugin instance is the usual mistake: instances carry per-editor state and cannot ' +
        'be shared, which is why this takes a factory.',
    )
  }
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
      console.error('@openleaf-editor/core: an editor failed to apply a plugin change', error)
    }
  }
}

/**
 * Build plugin instances for an editor, reusing cached instances when given.
 *
 * `cache` is a host's own per-editor map, and it is genuinely part of the
 * contract rather than an optimisation that leaked: without it, reconfiguring an
 * editor after a late registration builds *new* instances of the plugins already
 * running, and each one starts from its initial state -- so a table plugin loses
 * its selection and a session plugin its draft, on every later registration.
 * Omit it and every call returns fresh instances, which is correct for a host
 * building one editor once.
 */
export function createRegisteredPlugins(
  schema: Schema,
  cache?: Map<EditorPluginFactory, Plugin[]>,
): Plugin[] {
  const plugins: Plugin[] = []
  const seen = new Set<EditorPluginFactory>()
  for (const factory of factories) {
    seen.add(factory)
    const cached = cache?.get(factory)
    if (cached) {
      plugins.push(...cached)
      continue
    }
    try {
      const created = factory(schema)
      cache?.set(factory, created)
      plugins.push(...created)
    } catch (error) {
      // A throwing factory used to take EditorState.create with it, so one bad
      // script tag produced a blank editor. Contributing nothing is the right
      // failure: the editor comes up without that plugin.
      console.error('@openleaf-editor/core: a plugin factory threw; skipping it', error)
    }
  }
  if (cache) {
    for (const factory of [...cache.keys()]) {
      if (!seen.has(factory)) cache.delete(factory)
    }
  }
  return plugins
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
