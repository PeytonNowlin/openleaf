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

Inserting or deleting a column reindexes a stored `<colgroup>` with the cells.
Without that, every remaining column inherited the previous `<col>`'s width and
class. Column resize still patches widths onto the same elements, so the two
paths do not fight.

Merge and split keep that contract too. A merged cell's `colwidth` is one
entry per column it covers — the concatenation of those columns' widths, filled
from other cells in the column and then from the stored colgroup, never folded
into a single number — and `scope` follows the new span: a header that covers
two columns is `scope="colgroup"`, and a body cell that still carried `scope`
from an earlier header conversion has it cleared. Split writes each entry back
onto the cell that covers that column.

Inserting a row or column copies the neighbour cell's alignment and background
so the new cells look like the ones the author was in. It does not copy `class`
(often a band the author wanted on one row), `scope` (owned by the header pass
above), or — on a new column — `colwidth`, because a new column is an unmeasured
`<col>` and stamping the neighbour's width would make the next resize fight it.
A body row inserted below a header copies from a body neighbour of the same
type, not from the header's chrome.

## Nested tables

A cell may contain a table — `table_cell` is `block+`, and Insert table inside a
cell is how you make one. Two editing rules follow from that:

- **Column resize.** Dragging a column border targets the table whose border the
  pointer is on. When the pointer sits on an outer column edge that crosses a
  nested table, the outer grid wins, so parent column widths can be restored
  without first leaving the inner table.
- **Paste.** A whole table pasted at a text caret inside a cell is inserted as a
  nested table, and it keeps the table's own attributes — caption, colgroup,
  header and footer row counts, `border`, `class`. That is true of external HTML
  (a browser, Word, or Excel table, which arrives as a closed table) and of an
  internal copy of every cell (which arrives as that same table node, open by
  one). Loose cells pasted at a text caret are wrapped in a new table and nested
  the same way; a copied rectangle is not a table, so it does not inherit a
  caption it did not carry. A cell selection still maps pasted cells onto the
  selected rectangle. In no case does a caret-paste rewrite `colspan` on cells
  the author did not select.

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
| `addRowBefore`, `addRowAfter`, `deleteRow` | Row commands. They keep `headerRows` / `footerRows` in step so `<thead>` and `<tfoot>` stay on the header and footer rows the author actually has. A new row copies the neighbour cell's alignment, background, and `colwidth`. |
| `addColumnBefore`, `addColumnAfter`, `deleteColumn` | Column commands. A new column copies alignment and background, not `colwidth`. |
| `mergeCells`, `splitCell` | Cell merge and split. They keep per-column `colwidth` and rewrite `scope` for the new span. |
| `toggleHeaderRow` | Promote or demote the header row |
| `deleteTable` | Delete the whole table |

```html
<openleaf-editor for="body"
  toolbar="bold italic | insertTable tableProperties | source">
</openleaf-editor>
```

An id nothing has registered logs a warning rather than being skipped silently.
