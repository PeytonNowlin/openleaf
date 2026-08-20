# `@openleaf-editor/plugins-colour`

Text and highlight colour controls for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): a keyboard-navigable swatch picker, in a 3.7 KB gzipped opt-in bundle.

This is a **beta** (`0.1.0-beta.2`). Keep every `@openleaf-editor/*` package on the
same version — they pin each other exactly, and mixing versions installs two copies
of the schema and the toolbar registry.

## What is in this package, and what is not

The `text_color` and `background_color` **marks are not here.** They are in
`@openleaf-editor/core`, present in every deployment, because reading a
`<span style="color:#c00">` out of an existing archive is not optional: without
them that span is claimed by the preservation layer and becomes an opaque atom —
round-tripped byte-perfectly and impossible to type in. It is the same split as
tables, where the schema is in core and the editing machinery is opt-in.

So what this package adds is the **picker**: the swatch grid, its keyboard model
and its popover. Colour in stored content is read and written correctly whether or
not you install it.

## Install

```bash
npm install @openleaf-editor/element@beta @openleaf-editor/plugins-colour@beta
```

```ts
import '@openleaf-editor/element'
import { installColourPicker } from '@openleaf-editor/plugins-colour'

installColourPicker()
```

Or as a second script tag, in this order — it borrows the runtime the first bundle
publishes:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-colour.min.js"></script>
```

## Putting the controls in the toolbar

Installing does **not** rearrange your toolbar. A plugin declares capability; the
integrator declares layout. Name the two items yourself:

```html
<openleaf-editor for="body" toolbar="bold italic | textColour highlightColour | undo redo"></openleaf-editor>
```

or use the ready-made layout that includes them:

```ts
import { LAYOUT_WITH_COLOUR } from '@openleaf-editor/ui'

editor.setAttribute('toolbar', LAYOUT_WITH_COLOUR)
```

## Your own palette

```ts
installColourPicker({
  palette: [
    { value: '#c2185b', name: 'Brand pink' },
    { value: '#1f2328', name: 'Body text' },
  ],
})
```

Every swatch needs a `name`, and it is not decoration: it is the button's
accessible name and its tooltip, so the grid works with a screen reader and in a
forced-colours mode where the swatch itself conveys nothing. Rows are eight wide —
a palette that fills whole rows leaves no gaps to arrow into.

## Accessibility and CSP

Arrow keys move within the grid, Home and End go to the ends of a row, Escape
closes and returns focus to the trigger, and moving focus out by any route closes
it. The grid is rendered in the top layer via `popover`, which also keeps it clear
of a host's `overflow: hidden`.

Styles are delivered as a constructable stylesheet, so they apply under
`style-src 'self'` with no `'unsafe-inline'`. On a browser without
`adoptedStyleSheets`, link the file instead:

```html
<link rel="stylesheet" href=".../@openleaf-editor/plugins-colour/openleaf-colour.css">
```

Note that colour itself is stored as an inline `style` attribute, which a strict
`style-src` will not render on your published page. See the
[Content Security Policy section](https://github.com/PeytonNowlin/openleaf#content-security-policy)
of the project README for what degrades and how.

## Server side

Sanitize submitted HTML on the server. `@openleaf-editor/sanitize` allows `color`
and `background-color` on `<span>` and nothing else, with the values checked. If
you sanitize with DOMPurify, install `styleAttributeHook` too — its config cannot
filter CSS per element on its own.
