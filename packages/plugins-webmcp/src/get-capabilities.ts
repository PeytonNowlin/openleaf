/**
 * `openleaf_get_capabilities` -- what this editor can hold, and what it can do.
 *
 * Two answers, because in this project they are two different sets and an agent
 * that conflated them would be wrong in both directions.
 *
 * What a document can STORE is the schema, and the schema is deliberately wider
 * than the chrome: table and structural nodes are in the base schema so that
 * every deployment round-trips a stored document faithfully, whether or not it
 * ever installed anything that builds one. What a deployment can DO is the
 * toolbar item registry -- `installTableEditing()` and friends put commands in
 * it at import time -- narrowed again by the layout this particular editor was
 * given, because a `toolbar` attribute is how an integrator restricts one
 * editor without uninstalling anything.
 *
 * So an editor can hold a table in a deployment where nothing can build one,
 * and can hold a heading on a bar that offers no way to apply one. Reporting
 * only the schema promises capabilities that do not exist; reporting only the
 * commands says a stored table is unreadable.
 */

import { DEFAULT_LAYOUT, allToolbarItems, type ToolbarItemSpec } from '@openleaf-editor/ui'
import type { AgentTool } from './agent.js'
import { editorArgument, withEditor } from './editor-arg.js'
import type { EditorHost } from './registry.js'
import { ok } from './result.js'

/**
 * The toolbar item ids a layout names, in the order the integrator wrote them.
 *
 * The grammar is the toolbar's own: whitespace-separated ids with `|` for a
 * separator, an absent `toolbar` meaning the default bar, and the literal
 * `none` meaning no bar at all. Parsed from the two attributes rather than read
 * off a mounted toolbar, because an editor is asked what it can do long before
 * -- and sometimes without ever -- a bar being rendered: `toolbar="none"` with
 * an integrator's own buttons is a supported deployment.
 */
export function layoutIds(toolbar: string | null, toolbar2: string | null): string[] {
  const ids: string[] = []
  for (const layout of [toolbar ?? DEFAULT_LAYOUT, toolbar2 ?? '']) {
    if (layout === 'none') continue
    for (const token of layout.split(/\s+/)) {
      // A layout may name an id twice across the two bars, and an agent reading
      // a command listed twice would reasonably wonder which one it got.
      if (token !== '' && token !== '|' && !ids.includes(token)) ids.push(token)
    }
  }
  return ids
}

/**
 * The commands one editor offers: installed in this deployment AND on its bar.
 *
 * The one definition of that intersection, because two tools depend on it
 * agreeing with itself. `openleaf_get_capabilities` reports this list and
 * `openleaf_apply_command` will only run something from it, so a command
 * reported as available and then refused -- or applied without ever being
 * reported -- is a contradiction an agent has no way to resolve.
 *
 * Walked from the registry rather than from the layout, so the answer is
 * "installed, and offered here" in that order: an id in the layout that nothing
 * registered is a typo the toolbar already warns about, and is not a capability.
 */
export function offeredCommands(host: EditorHost): ToolbarItemSpec[] {
  // The attributes, not the reflecting properties: these are read through a
  // peer dependency range, so an older `<openleaf-editor>` that predates a
  // property is still asked the question the browser can always answer.
  const named = layoutIds(host.getAttribute('toolbar'), host.getAttribute('toolbar2'))
  return allToolbarItems().filter((item) => named.includes(item.id))
}

export const getCapabilitiesTool: AgentTool = {
  name: 'openleaf_get_capabilities',
  title: 'Get OpenLeaf editor capabilities',
  description:
    'Report what one OpenLeaf editor can store and what it can do. Returns ' +
    'JSON: {"ok":true,"id":string,"nodes":string[],"marks":string[],' +
    '"commands":[{"id":string,"label":string}]}. "nodes" and "marks" are the ' +
    'schema types this editor\'s document can hold. "commands" are the editing ' +
    'commands this deployment installed AND this editor offers, named by the ' +
    'id you would pass to apply one. The two sets differ on purpose and the ' +
    'smaller one is "commands": a document can hold a table, or a heading, in ' +
    'an editor that has no command to make one. Check here before assuming an ' +
    'edit is available.',
  inputSchema: editorArgument,
  annotations: {
    readOnlyHint: true,
    // Type names and command labels only. Nothing an author typed into the
    // document can reach an agent through this call.
    untrustedContentHint: false,
  },
  execute(args) {
    return withEditor(args, (editor) => {
      const commands = offeredCommands(editor.host).map((item) => ({
        id: item.id,
        label: item.label,
      }))

      // From the live state, never from a captured `coreSchema()`: a registered
      // schema extension is exactly the case where the two disagree, and it is
      // this document's schema that decides what this document can hold.
      const { schema } = editor.view.state
      return ok({
        id: editor.id,
        nodes: Object.keys(schema.nodes).sort(),
        marks: Object.keys(schema.marks).sort(),
        commands,
      })
    })
  },
}
