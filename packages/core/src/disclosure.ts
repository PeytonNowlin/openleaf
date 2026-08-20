/**
 * Make `<details>` open and close while editing.
 *
 * Outside a contenteditable the browser toggles a `<details>` when its
 * `<summary>` is clicked, and nothing has to be written for it. Inside one that
 * default action does not happen: the click is spent placing a caret, so the
 * element stays in whatever state it was parsed in.
 *
 * The consequence is worse than a control that does nothing. A `<details>` parsed
 * without `open` renders collapsed, and its contents are then unreachable --
 * there is no gesture that expands it, so an author cannot edit or even read the
 * body of a collapsible section they already have in a document.
 *
 * So the toggle is written by hand, against the node's own `open` attribute
 * rather than the DOM's. That is what makes the state part of the document and
 * therefore part of what round-trips; toggling the element directly would be
 * undone by the next redraw.
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'

const key = new PluginKey('openleaf-disclosure')

export function disclosurePlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        /*
         * A DOM listener rather than `handleClickOn`.
         *
         * ProseMirror calls `handleClickOn` for each node around the click from
         * the inside out, and whether the summary arrives as the direct node
         * depends on whether the pointer landed on its text, its marker or its
         * padding. That made the toggle fire on some clicks and not others --
         * the section appeared stuck open, which is worse than not working at
         * all, because it looks like the state is wrong rather than the control.
         *
         * The target's nearest `<summary>` is not ambiguous.
         */
        click(view, event) {
          const target = event.target as Node | null
          if (!target) return false
          const from = target.nodeType === 1 ? (target as Element) : target.parentElement
          const summary = from?.closest?.('summary')
          if (!summary || !view.dom.contains(summary)) return false

          const $pos = view.state.doc.resolve(view.posAtDOM(summary, 0))
          for (let depth = $pos.depth; depth >= 0; depth -= 1) {
            const node = $pos.node(depth)
            if (node.type.name !== 'details') continue
            // Once the element carries `open`, the browser's own activation
            // behaviour for a summary works again and fires alongside this --
            // two toggles that cancel. Only one may act, and it has to be this
            // one: the DOM's idea of open is discarded on the next redraw, the
            // node's is what round-trips.
            event.preventDefault()

            /*
             * Put the caret in the label explicitly.
             *
             * `setNodeMarkup` replaces the details node, and a selection mapped
             * through a replacement does not reliably survive it: Chromium kept
             * the caret and Firefox dropped it, which left the label uneditable
             * in one browser and not the other. Where the click already landed
             * inside the label is preferred, so clicking a word still puts the
             * caret at that word; otherwise it goes to the end of the label.
             */
            const detailsPos = $pos.before(depth)
            const summaryNode = node.firstChild
            const labelFrom = detailsPos + 2
            const labelTo = labelFrom + (summaryNode?.content.size ?? 0)
            const clicked = view.state.selection.from
            const caret = clicked >= labelFrom && clicked <= labelTo ? clicked : labelTo

            const tr = view.state.tr.setNodeMarkup(detailsPos, undefined, {
              ...node.attrs,
              open: !node.attrs['open'],
            })
            tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(caret))))
            view.dispatch(tr)

            /*
             * And take the focus, because clicking a summary does not give it.
             *
             * `<summary>` is a natively focusable widget, and Firefox declines to
             * put a caret in one inside a contenteditable -- focus stayed on
             * `<body>`, so the selection above was correct and every keystroke
             * still went nowhere. Handling the click means owning the focus that
             * the default action would otherwise have arranged.
             */
            if (!view.hasFocus()) view.focus()

            // False, not true: ProseMirror still gets to finish its own handling
            // of the click. Swallowing it here changed nothing for the better and
            // made the interaction harder to reason about.
            return false
          }
          return false
        },
      },
    },
  })
}
