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

          /*
           * `handleDOMEvents` runs before ProseMirror's `view.editable` check
           * (`runCustomHandler` is first in `initInput`). Typing, paste, drop
           * and the keymaps get that gate for free; this click does not, so a
           * read-only editor still flipped `open` and fired `openleaf:change`.
           *
           * `view.editable` rather than the host's `readonly` attribute, same
           * as the table context menu and the media resize handle: it is the
           * flag ProseMirror itself consults, the element derives it from the
           * attribute, and a view mounted without the custom element can set
           * it directly.
           *
           * Returning false, not swallowing the event: outside contenteditable
           * the browser toggles a `<details>` natively, so collapsed sections
           * stay readable without writing the node. `preventDefault` below is
           * only needed when we own the toggle.
           */
          if (!view.editable) return false

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

            /*
             * Keep the toggle off the undo stack.
             *
             * `open` lives in the document, so flipping it is by every mechanical
             * measure a document change: it is a step, it maps positions, it
             * serializes on save. History would take it on those grounds alone.
             *
             * But the undo stack does not model changes to the document, it
             * models an author's intent to have made them, and expanding a
             * section in order to read it is not an edit -- it is how you look at
             * a document whose parts are folded away. An author who opened three
             * collapsed sections while hunting for a paragraph, fixed a typo in
             * the third and pressed Ctrl+Z got the typo back and the section
             * closed under them; the correction they meant to take back was four
             * undos away, behind their own navigation. Losing the ability to undo
             * a fold costs nothing -- the gesture that made it is one click away
             * and visible on screen -- while losing the edit next to it costs the
             * work.
             *
             * `addToHistory: false` is the key `prosemirror-history` reads to
             * exclude a transaction; the attribute still changes, and still
             * round-trips.
             */
            tr.setMeta('addToHistory', false)
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
