/**
 * `openleaf_apply_command` -- formatting, through the editor's own commands.
 *
 * The deliberate choice here is what this tool does NOT do: it does not write
 * markup. An agent asking for bold gets the toolbar's own `bold`, run against
 * the range a handle names, and with it every guard that command already has.
 * A command declines on a figure, stops at an isolating boundary, and knows
 * which marks its schema allows -- none of which a tool that assembled
 * `<strong>` and reparsed it would inherit. Routing through the registry is
 * also what makes "only commands this deployment installed" true rather than
 * aspirational: there is no list of command names anywhere in this file.
 *
 * Two things a registered command may nonetheless not be. It may not be on this
 * editor's bar, which is how an integrator restricts one editor without
 * uninstalling anything; and it may have no plain command underneath it at all
 * -- `blockType`, `link`, `image` and `source` open a dialog or build their own
 * control, so there is nothing to run headlessly. Each is a refusal with its
 * own code, because answering either by pretending is how an agent comes to
 * report work it did not do.
 */

import type { Node as PMNode } from 'prosemirror-model'
import type { ToolbarItemSpec } from '@openleaf-editor/ui'
import type { Command, Selection, Transaction } from 'prosemirror-state'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { AgentTool } from './agent.js'
import { editorArgumentWith, withEditor } from './editor-arg.js'
import { offeredCommands } from './get-capabilities.js'
import type { RegisteredEditor } from './registry.js'
import { fail, ok } from './result.js'
import { markAgent, refuseWrite, targetFor } from './write.js'

export const applyCommandTool: AgentTool = {
  name: 'openleaf_apply_command',
  title: 'Apply an OpenLeaf editing command',
  description:
    "Apply one of an OpenLeaf editor's own editing commands -- bold, italic, a " +
    'list -- to the text a handle names. Returns JSON: {"ok":true,"id":string,' +
    '"command":string}. Pass "command" as an id openleaf_get_capabilities ' +
    'reported for THIS editor, and "handle" as one from openleaf_find_text. ' +
    'The command runs with the same guards it has for a person clicking the ' +
    'button, so one that does not apply where the handle points fails with ' +
    '"refused" and changes nothing rather than reporting success. A name that ' +
    'editor does not offer fails with "unknown-command"; a control that only ' +
    'works through the editor\'s own interface, such as a dialog, fails with ' +
    '"unsupported-command" and cannot be applied at all. Preserved markup fails ' +
    'with "preserved-region". The change is one undoable step, and the handle ' +
    'still names the same text afterwards.',
  inputSchema: editorArgumentWith(
    {
      command: {
        type: 'string',
        description: 'The command id, as reported by openleaf_get_capabilities for this editor.',
      },
      handle: {
        type: 'string',
        description: 'A handle from openleaf_find_text, naming the text to apply the command to.',
      },
    },
    ['command', 'handle'],
  ),
  annotations: {
    // The one tool here that changes the document, and this is where a client
    // driving the agent learns that before the call rather than after it.
    readOnlyHint: false,
    // It reports which command it ran, and nothing out of the document.
    untrustedContentHint: false,
  },
  execute(args) {
    const name = typeof args['command'] === 'string' ? args['command'] : ''
    if (name === '') {
      return fail(
        'invalid-argument',
        'pass "command": an id openleaf_get_capabilities reports for this editor',
      )
    }

    return withEditor(args, (editor) => {
      // The same resolution every write tool gets, from the write path: a
      // missing handle, a spent one, and one that belongs to another editor all
      // refuse here, in the same words `openleaf_replace_at` uses.
      const target = targetFor(args, editor)
      if (typeof target === 'string') return target

      // The same intersection `openleaf_get_capabilities` reports, from the
      // same function, so a command it listed is a command this will run.
      const spec = offeredCommands(editor.host).find((item) => item.id === name)
      if (!spec) {
        return fail(
          'unknown-command',
          `editor "${editor.id}" offers no command called "${name}": either ` +
            "nothing on this page registered it, or this editor's toolbar does " +
            'not carry it. Call openleaf_get_capabilities for the ones it has.',
        )
      }
      if (!spec.command) {
        return fail(
          'unsupported-command',
          `"${name}" only works through the editor's own interface -- it opens a ` +
            'dialog or builds its own control, so there is no command to run. ' +
            'Retrying will not help.',
        )
      }

      const refusal = refuseWrite(editor, target.from, target.to)
      if (refusal) return refusal

      return run(editor, spec, spec.command, target.from, target.to)
    })
  },
}

/**
 * The selection a command should see for a handle's range.
 *
 * Handles come in two shapes and a handle does not say which it is, because the
 * range is the whole contract: `openleaf_find_text` mints an INLINE range
 * inside one textblock, while `openleaf_get_structure` mints a top-level
 * block's entire node range -- `[offset, offset + nodeSize]`, boundary tokens
 * included.
 *
 * Handing the second shape straight to `TextSelection.between` is the bug this
 * exists to avoid. Both of its ends sit on a boundary token rather than in text,
 * so the search for a nearby text position walks OUT of the block: a handle
 * naming a horizontal rule comes back as a selection over the paragraph before
 * it, and the command applies to text nobody named.
 */
function stage(doc: PMNode, from: number, to: number): Selection {
  const node = doc.resolve(from).nodeAfter
  // `!node.isInline` is what keeps an inline range out of this branch: a search
  // that matched a whole text node satisfies the arithmetic just as well.
  if (node && !node.isInline && from + node.nodeSize === to) {
    // An atom has no inside to put a caret in -- a rule, an image, a preserved
    // block. Selecting the node itself is what a person clicking it gets, and a
    // command with nothing to do there declines from exactly that selection.
    if (node.isAtom) return NodeSelection.create(doc, from)
    // Inside the block's own boundary tokens, so the command sees the content
    // of the heading or the list the outline named and not its neighbours.
    return TextSelection.between(doc.resolve(from + 1), doc.resolve(to - 1))
  }
  // An inline range: both ends are already positions a text selection holds.
  return TextSelection.between(doc.resolve(from), doc.resolve(to))
}

/**
 * Stage the range as a selection, ask the command, dispatch at most once.
 *
 * The staged state is never dispatched. A command reads the selection to decide
 * what it acts on, so the range has to become one -- but making that its own
 * transaction would put two on the page for one call, and the second would then
 * be the only one an author's undo reached.
 *
 * The command's transaction is captured rather than forwarded, which makes
 * "exactly one transaction" a property of this function rather than a hope
 * about every command in every plugin an integrator happened to install.
 */
function run(
  editor: RegisteredEditor,
  spec: ToolbarItemSpec,
  // The same `spec.command`, passed separately because narrowing it away from
  // `undefined` at the call site does not survive the property access here.
  command: Command,
  from: number,
  to: number,
): string {
  const name = spec.id
  const { view } = editor
  const before = view.state
  const selection = stage(before.doc, from, to)
  // The one thing worse than refusing is applying somewhere else. Every branch
  // of `stage` is meant to land inside the handle's own range; this is what
  // turns a branch that did not into a refusal instead of a write to text the
  // agent never named.
  if (selection.from < from || selection.to > to) {
    return fail('refused', `there is nothing at that handle for "${name}" to apply to.`)
  }
  const staged = before.apply(before.tr.setSelection(selection))

  let produced: Transaction | undefined
  let applied = false
  try {
    // `isEnabled` is the item's own answer to "would clicking this do
    // anything", and it defaults to asking the command. Where an item defines
    // one, it is the guard a person gets, so it is the guard an agent gets.
    if (spec.isEnabled && !spec.isEnabled(staged)) return declined(name)
    applied = command(staged, (candidate) => (produced ??= candidate), view)
  } catch {
    // A command is third-party code: an integrator can register one, and
    // `registerToolbarItem` is last-wins, so even a built-in id may not be the
    // built-in command. A throw out of here would reach the agent as a rejected
    // call with no shape to it. Nothing was dispatched, so nothing changed.
    return fail('refused', `"${name}" failed while running; nothing was changed.`)
  }
  if (!applied || !produced) return declined(name)

  view.dispatch(
    // The author's caret is not the agent's to move. The staged selection is
    // there so the command knows what to act on; leaving it behind would jump a
    // caret that may be in another paragraph entirely, and the next thing the
    // author typed would land there. The element restores the caret across
    // `value = html` for the same reason.
    markAgent(produced, name).setSelection(before.selection.map(produced.doc, produced.mapping)),
  )

  // The editor gets the last word even after the command agreed. A
  // `filterTransaction` -- the one honouring stored `contenteditable="false"`,
  // or one an integrator added -- drops a transaction silently and leaves the
  // state object identical. Reporting success there is reporting a write that
  // did not happen, which is the failure this whole tool is shaped to avoid.
  if (view.state === before) {
    return fail('refused', 'the editor refused that change: that text is locked.')
  }

  return ok({ id: editor.id, command: name })
}

/** The greyed-out button, in words: it does not apply here, and nothing moved. */
const declined = (name: string): string =>
  fail(
    'refused',
    `"${name}" does not apply to the text that handle names, so the editor ` +
      'declined it and nothing changed. A different range may work.',
  )
