# @openleaf-editor/ui

Toolbar, menubar, dialogs, icons, skins and theme tokens. Plain CSS, no
framework, themeable by custom properties.

> **Editor output is untrusted input.** Whatever the editor produces — and
> whatever a user pasted into it — must be sanitized **on your server** before it
> is stored or rendered as HTML. Client-side sanitization is a user-experience
> feature, not a security control: anything the editor strips can be put back
> with developer tools, because the editor runs under the user's control.
>
> [`@openleaf-editor/sanitize`](https://github.com/PeytonNowlin/openleaf/tree/main/packages/sanitize) ships the
> canonical allowlist as data and generates configuration for DOMPurify, Python
> `bleach` and PHP HTMLPurifier from it, so client and server enforce the same
> rules. Read [SECURITY.md](https://github.com/PeytonNowlin/openleaf/blob/main/SECURITY.md) before you ship.

## Install

```sh
npm install @openleaf-editor/ui@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## What it is for

[`@openleaf-editor/element`](../element) already uses this. Import it directly to
register your own toolbar control, or to reuse the dialogs and icons.

`promptForLink` is the one path behind the Link toolbar button, the link
context menu, and the selection toolbar. On Save it keeps the mark's `id` and
merges window-safety tokens (`noopener noreferrer`) into `rel` instead of
replacing author tokens.

## Registering a control

```ts
import { registerToolbarItem } from '@openleaf-editor/ui'
import { toggleBold } from '@openleaf-editor/core'

registerToolbarItem({
  id: 'bold', type: 'button', kind: 'toggle',
  label: 'Bold', icon: 'bold', command: toggleBold,
})
```

Three item types. `button` is the common case. `select` builds a native
`<select>` from `options`, `getValue` and `applyValue` -- use it for a fixed
preset list. `custom` hands you `render` and expects a `ToolbarControl` back,
which is how the colour swatch grid and the block-type control exist without the
toolbar knowing their ids. The block-type dropdown disables Heading and Paragraph
when those commands would not apply -- a captioned figure is a textblock, but
retyping it is how those entries used to destroy the `<figure>`.

Registering an item declares capability; it does not rearrange anyone's toolbar.
Layout is the integrator's `toolbar` attribute.

The built-in `image` item inserts, or edits the selected image -- the same
pattern as the insert-media control. `labelFor` is how its accessible name
becomes "Edit image" while a picture is selected.

## The toolbar is one tab stop

It is a `role="toolbar"` with a roving tabindex, which is the whole reason the
custom-control contract is strict about focus: exactly one focusable element in
what you return, and if it is not a `button.ol-btn` then name it as `focusable`.
Two makes the bar two tab stops where the author expects one.

[Authoring OpenLeaf plugins](../../docs/authoring-plugins.md) documents the rest,
including the `mousedown` `preventDefault` that keeps the selection alive and why
`destroy` runs before every re-render rather than only on teardown.

## Styling

A constructable stylesheet, adopted into the document, so no bundler CSS import
is required and nothing is injected inline. Every colour is a custom property;
`skin` and `theme` attributes switch them without rebuilding the editor or
costing the author their undo history. On a browser without
`adoptedStyleSheets`, link `openleaf.css` and call `markStylesExternal()`.

The main toolbar (`.ol-toolbar`, not a floating bar) is `position: sticky`, so
it stays on screen while the editor is in view. Fullscreen does not need this:
the host is a column flex and only the content pane scrolls, so the bar never
left. Integrators with a fixed site header set `--openleaf-toolbar-sticky-offset`
to that header's height (default `0px`) on `.ol-editor` or an ancestor. The
menubar is not sticky: stacking it with the toolbar needs a height the
stylesheet cannot know, and two bars at the same `top` would overlap. A second
toolbar (`toolbar2`) stays in flow for the same reason.

The overflow "More" panel is `position: fixed` from the trigger's viewport box,
so an open panel still lands under the button when the bar is stuck.

## Floating toolbars

`selection-toolbar` and `insert-toolbar` on the element create the two floating
bars. They are shown only while the view is focused, the editor is editable,
and the selection is not inside a `contenteditable="false"` region or a
preserved atom. A pointer-down inside the canvas still counts as focused: some
engines have not moved focus into the view yet while a drag-select is
establishing the range, and a naive `hasFocus()` guard would hide the selection
bar for that gesture. Placement itself stays pointer-driven — a keyboard user
already has Alt+F10 for the main toolbar.

## License

Apache-2.0.
