# @openleaf-editor/paste

Paste normalizers: Word, Excel and Google Docs debris into clean semantic
HTML.

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
npm install @openleaf-editor/paste@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

```ts
import { detectSource, normalizePastedHtml } from '@openleaf-editor/paste'

detectSource(html)          // 'word' | 'excel' | 'gdocs' | 'openleaf' | 'unknown'
normalizePastedHtml(html)   // cleaned
```

[`@openleaf-editor/element`](../element) runs this on paste already. Import it
directly to normalize clipboard HTML somewhere else, or to run it over an archive.

## Stored content and pasted content are not the same problem

The editor's other pipeline preserves what it does not recognise, because a
document already in your database is something you promised to keep. A paste is
the opposite: the author has explicitly asked for the source's *appearance* not to
come along. So this strips.

Order matters, and getting it wrong is quiet. Google Docs spells bold as
`font-weight:700` on a `<span>`, so semantics are promoted to real tags **before**
styles are dropped -- strip first and the whole paste flattens to plain text.
Once that is done the strip is total rather than an allowlist, because a partial
allowlist is how `line-height:1.38` ends up in a database.

Word's list structure is rebuilt from `mso-list` metadata and its `<o:p>` and
conditional-comment scaffolding is removed. Excel's clipboard is the same
Office markup -- `mso-`, `urn:schemas-microsoft-com`, `MsoNormalTable` -- so
it used to take that path too. It is not Word's fake-list protocol: it is a
real `<table>`, and `detectSource` now returns `'excel'` for an Excel envelope
(`ProgId=Excel.Sheet`, the Excel xmlns, `x:num`/`x:str` cell attributes) so
list reconstruction does not run. A Word document that embeds a spreadsheet
still takes the Word path; Google Sheets still takes the gdocs path. Adding
`'excel'` to the `PasteSource` union is a breaking change for consumers who
exhaustively `switch` on it.

Google Docs' wrapping `<b style="font-weight:normal">` is unwrapped rather than
trusted -- reading it as bold turns the entire paste bold.

What is *not* stripped is structure: table column widths and cell alignment, the
dimensions of an embedded video, and a `lang` marking the source used to say
"this quotation is in another language". Those are what the document says, not
what it looks like, and the schema models each of them.

## Copying out of one OpenLeaf document and into another

That paste is detected (ProseMirror stamps `data-pm-slice` on its own clipboard
HTML) and handled separately, by `normalizeOpenLeaf`. It keeps inline styles,
because "shed the source's appearance" is an argument about a *foreign* source
and the source here is the same editor and the same schema as the destination.
Detecting it first also matters for what the editor preserves: `looksLikeWord`
matches the substring `mso-`, so a document that has preserved a
`<div class="MsoNormal">` would otherwise be treated as a fresh Word paste and
stripped of exactly the markup preservation exists to keep.

## License

Apache-2.0.
