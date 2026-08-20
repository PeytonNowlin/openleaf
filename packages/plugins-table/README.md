# @openleaf-editor/plugins-table

Opt-in table editing: cell selection, column resizing, property dialogs,
captions, an insert grid, a context menu, and the row and column commands.

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
npm install @openleaf-editor/plugins-table@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

With a bundler:

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
installTableEditing()
```

With a script tag, load it after the core bundle -- it borrows the first one's
ProseMirror runtime rather than shipping a second copy:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-tables.min.js"></script>
```

Then name the controls you want in the `toolbar` attribute. Installing the
plugin registers capability; it does not rearrange your toolbar.

## The schema is not in here

Table node types live in [`@openleaf-editor/core`](../core), and that was not the
original plan. The fidelity harness changed it: without them a `<table>` in stored
content is claimed by the preservation layer and becomes an opaque, uneditable
card. Faithful, and useless.

So the split falls at the editing machinery instead. Every deployment reads and
writes tables; only the ones that want table *editing* download this.

## Captions and colgroup

Both round-trip byte-for-byte, as furniture attributes on the table node rather
than child nodes. They render but are not editable in place: a caption has to be a
child node for that, and `prosemirror-tables` derives its cell map from
`table.childCount`, so it needs an upstream fix first. The caption dialog is how
you change one meanwhile.

## License

Apache-2.0.

## Toolbar item ids

Installing registers the controls; it does not rearrange a custom toolbar. Name
the ones you want in the element's `toolbar` attribute:

| Id | Control |
| --- | --- |
| `insertTable` | Insert-table grid |
| `tableProperties` | Table properties dialog |
| `rowProperties` | Row properties dialog |
| `cellProperties` | Cell properties dialog |
| `tableCaption` | Caption dialog |
| `addRowBefore`, `addRowAfter`, `deleteRow` | Row commands |
| `addColumnBefore`, `addColumnAfter`, `deleteColumn` | Column commands |
| `mergeCells`, `splitCell` | Cell merge and split |
| `toggleHeaderRow` | Promote or demote the header row |
| `deleteTable` | Delete the whole table |

```html
<openleaf-editor for="body"
  toolbar="bold italic | insertTable tableProperties | source">
</openleaf-editor>
```

An id nothing has registered logs a warning rather than being skipped silently.
