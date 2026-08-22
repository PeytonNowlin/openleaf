# @openleaf-editor/core

The schema, commands, HTML input and output, and the content-preservation
layer. No UI, no framework dependencies.

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
npm install @openleaf-editor/core@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## What it is for

Most integrations never import this directly -- they use
[`@openleaf-editor/element`](../element), which builds an editor out of it. You
want `core` when you are embedding ProseMirror yourself, running HTML through the
schema on a server, or writing a plugin.

```ts
import { coreSchema, parseHtml, serializeHtml, roundTrip } from '@openleaf-editor/core'

roundTrip('<p style="text-align:center">hi</p>')
// '<p style="text-align:center">hi</p>'
```

## The preservation layer is the point

A schema-based editor has to decide what it understands, and the usual answer for
everything else is to delete it. `core` keeps unrecognised markup as a
selectable, movable atom that round-trips byte-for-byte instead.

That is why the schema is larger than it might look: `<table>`, `<figure>`,
`<details>`, `<video>`, allowlisted `<iframe>` embeds and the typography marks are
all modelled here rather than in an opt-in plugin. Not because every deployment
edits them, but because a node type that is absent is content that becomes an
atom -- and "we kept your tables and you may not touch them" is not something you
can tell a CMS with a fifteen-year archive.

The editing chrome for those things is opt-in. The storage format is not.

## Commands and predicates

Commands take ProseMirror's `(state, dispatch, view)` shape. Every one has a
matching predicate, so a control can show its state without duplicating the
logic:

```ts
import { setFontFamily, activeFontFamily } from '@openleaf-editor/core'

activeFontFamily(view.state)                          // 'Georgia' | null
setFontFamily('Georgia')(view.state, view.dispatch)   // boolean
```

`selectedImage` / `updateImage` (and the matching media pair) are how the
insert-image control also edits: a `NodeSelection` on the picture or its
`<figure>` prefills the dialog, and Save uses `setNodeMarkup` so caption,
class and dimensions survive.

A predicate returns `null` for a mixed selection rather than the first value it
finds -- a dropdown showing "Georgia" for a range that is half Georgia would be
worse than showing nothing.

## Isolating selections

If you construct a ProseMirror editor yourself, install
`isolatingSelectionPlugin()` next to `history()` and the keymap. A
`TextSelection` that starts in a `<blockquote>` and ends inside a following
`<details>` otherwise throws on the next keystroke (`Cannot join details onto
blockquote`), and the recovery rewrites the document with no undo entry.
`<openleaf-editor>` already installs the plugin. Details are in
[authoring-plugins.md §4.11](../../docs/authoring-plugins.md#411-isolating-nodes-clamp-the-selection-at-their-boundary).

## Safety

URL, CSS and embed rules come from
[`@openleaf-editor/content-policy`](../content-policy), shared with
[`@openleaf-editor/sanitize`](../sanitize) so the editor and your server cannot
disagree. `javascript:` URLs, `on*` handlers and unallowlisted iframes are dropped
on the way in, with tests. Sanitize on the server anyway -- anything a client
strips can be put back with developer tools.

## License

Apache-2.0.
