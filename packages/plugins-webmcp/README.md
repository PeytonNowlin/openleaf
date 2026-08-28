# `@openleaf-editor/plugins-webmcp`

An opt-in WebMCP tool surface for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): an agent driving the browser can ask which OpenLeaf editors are on the page, what each one is able to do, what is currently in it, where a given string occurs in it, and can rewrite a passage it located.

This is a **beta** (`0.1.0-beta.4`). Keep every `@openleaf-editor/*` package on the
same version.

It is not in the core bundle, and not only for weight. An editor should have no
agent surface unless the integrator decided it should, and the browser API this
is built against is young enough to have been renamed twice — so it lives behind
a package boundary, where the next rename is one file rather than a change to
the editor core.

It contributes nothing to the document format: no node types, no marks, no
toolbar items, no icons, and no CSS. A deployment that does not install it is
byte-for-byte the deployment it is today.

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

```bash
npm install @openleaf-editor/element@beta @openleaf-editor/plugins-webmcp@beta
```

```ts
import '@openleaf-editor/element'
import { installAgentTools } from '@openleaf-editor/plugins-webmcp'

installAgentTools()
```

Or as a second script tag, in this order:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-webmcp.min.js"></script>
```

The script tag installs on load. Calling `installAgentTools()` twice is
harmless — the second call is ignored, options and all — because a CMS template
that includes the bundle on two paths must not try to register the same tool
names twice.

## Tools

Tool names are page-global, so every one of them is in the `openleaf_`
namespace.

| Tool | Read-only | Returns document content | What it does |
| --- | --- | --- | --- |
| `openleaf_list_editors` | yes | no | Lists the OpenLeaf editors on the page, with an identifier for each. |
| `openleaf_get_capabilities` | yes | no | Reports what one editor's document can store, and which editing commands that editor actually offers. |
| `openleaf_get_document` | yes | **yes** | Returns one editor's current content as HTML — including edits the author has not saved. |
| `openleaf_find_text` | yes | **yes** | Searches one editor for a literal string, and returns a handle for each match. |
| `openleaf_replace_at` | **no** | no | Replaces the text one handle names with HTML, as a single undoable step. |

Every result is a **JSON string**, because a string is all the browser's execute
path returns. The envelope is the same for every tool:

```json
{ "ok": true,  "editors": [{ "id": "post-body", "label": "Post body" }] }
{ "ok": false, "error": "unknown-editor", "message": "…what to do instead" }
```

`error` is a short token to branch on, and `message` is written for a model to
read: it says what to do next, because "not found" and "search again" are
different instructions. The tokens are `unknown-editor`, `invalid-argument`,
`stale-handle`, `preserved-region` and `rejected-content`.

Read tools carry the `readOnlyHint` annotation, so the client driving the agent
can decide when a call needs a person's confirmation. Any tool that returns
document content carries `untrustedContentHint`, because a document is exactly
where text aimed at the agent reading it can hide. `openleaf_get_document` and
`openleaf_find_text` are annotated with it — one returns the document, the other
the text around each match; `openleaf_list_editors` and
`openleaf_get_capabilities` return identifiers, type names and command labels
only, and are annotated accordingly.

## What "capabilities" means here

`openleaf_get_capabilities` answers two questions that are easy to confuse, and
answers them separately because in this editor they have different answers:

```json
{
  "ok": true,
  "id": "comment-box",
  "nodes": ["blockquote", "doc", "heading", "paragraph", "table", "…"],
  "marks": ["em", "link", "strong", "…"],
  "commands": [{ "id": "bold", "label": "Bold" }, { "id": "italic", "label": "Italic" }]
}
```

- **`nodes` and `marks`** are what this editor's document can *store*. The base
  schema is deliberately wide — table and structural nodes are in it whether or
  not you installed the chrome for them — so that a stored document round-trips
  faithfully in every deployment.
- **`commands`** are what this editor can *do*: the toolbar items this
  deployment registered, narrowed to the ones this editor's `toolbar` and
  `toolbar2` layouts name. The `id` is what identifies a command; the `label` is
  what it is called.

So an editor can hold a table in a deployment that never installed
`@openleaf-editor/plugins-table`, and can hold a heading on a bar you restricted
to `toolbar="bold italic"`. Reporting only the schema would promise an agent
edits that cannot happen; reporting only the commands would tell it a stored
table is unreadable.

Restricting one editor is a layout decision, not an uninstall: `registerToolbarItem`
is page-global, so two editors on one page can report different commands from
the same registry. An editor with no `toolbar` attribute reports the default
bar; `toolbar="none"` reports no commands at all.

## Editor identity

Every tool other than the listing takes an editor identifier, so the identifier
has to be stable across a whole agent task.

- The host element's `id`, when it has one. Integrators already give these
  elements ids to bind them to a textarea, so in practice the identifier is one
  you recognise and can act on.
- Otherwise an ordinal: `editor-2` is the second editor registered on the page.
  The number is never reused, so an editor that is removed does not hand its
  name to a later one.

An editor removed from the page stops being listed. An editor mounted after the
bundle loaded starts being listed. Both follow from where the register is kept:
the editor plugin's own per-view lifecycle.

## Handles

Every tool other than the listing acts on a place in a document, and a place
cannot be named by a selection: a selection does not survive the round trip out
to an agent and back. So `openleaf_find_text` returns a **handle** per match — an
opaque token the agent passes to a later call.

```json
{ "ok": true, "matches": [{ "handle": "…", "context": "the first beta here" }], "truncated": false }
```

- **Handles are opaque.** They encode nothing: not the position, not the editor,
  not the text. Anything an agent could read out of one is something it would
  eventually compute with, and a computed handle is a write to a position nobody
  chose.
- **They follow the document.** Each editor keeps its handles in its own plugin
  state and carries them through every transaction's position mapping, so an
  edit in one part of the document — by the author, by another agent call, by
  anything — leaves a handle in another part still on its text.
- **A handle whose text was deleted fails, loudly.** It resolves to
  `stale-handle` and never to the neighbouring position. That distinction is the
  reason handles exist as a mechanism: a mapping that always answers with *some*
  position turns a deleted paragraph into a write into whatever moved up to take
  its place.
- **Handles die with their editor.** An editor removed from the page stops
  resolving them, like it stops being listed.
- **They are bounded.** An editor keeps its most recent 256 handles and drops the
  oldest, because nothing releases a handle and the table is walked on every
  transaction. A dropped handle stops resolving, which is a refusal rather than a
  wrong answer.

`openleaf_find_text` matches a literal string, case sensitively, one block at a
time — so a query spanning a mark boundary (`be<strong>ta</strong>`) is one
match, and one spanning a paragraph break is none. Text that does not occur is
`{"ok":true,"matches":[]}`, not an error. At most 50 matches come back, with
`"truncated": true` when there were more, because an agent that believes it has
seen every occurrence will replace them all.

## Writing

`openleaf_replace_at` takes a handle, the editor it belongs to, and the HTML to
put there. It is the one tool in the set that is not annotated read-only, which
is what tells the client driving the agent that this is the call to ask a person
about.

```json
{ "id": "post-body", "handle": "…", "html": "<strong>rewritten</strong>" }
```

Four things hold for every agent write, and they are the reason the write path
is one module rather than one per tool:

- **The content is sanitized before it is parsed, by the same policy a paste
  goes through.** This ordering is the whole of it. The preservation layer is a
  catch-all: markup the schema does not recognise is wrapped and kept rather
  than rejected, so parsing agent HTML first would turn hostile or malformed
  input into an opaque atom the document then carries faithfully forever —
  preserved *because* nothing could parse it. Running the policy first means an
  agent can put nothing into a document that a person could not have pasted
  into it. HTML the policy leaves nothing of is refused with
  `rejected-content` rather than written as an empty passage.
- **A range covering preserved markup is refused**, with `preserved-region`.
  The editor promises to hand that markup back byte-identical, and that promise
  is only kept if nothing edits inside it.
- **A refused write changes nothing.** Every check runs before anything touches
  the editor, so a failure is not a partial write; it is not a write.
- **One call is one transaction**, so one thing the agent did is one thing the
  author undoes.

A write spends its handle: the text it named is gone, so the handle resolves to
`stale-handle` afterwards. Search again before editing the same passage twice.

Passing the editor identifier alongside the handle is redundant — handles are
page-unique — and required anyway: it is what turns an agent that has muddled
two editors' handles into a refusal rather than a correct-looking write to the
document it did not mean.

## Browser support

The tools are registered with the browser's agent API — `document.modelContext`,
falling back to the deprecated `navigator.modelContext`. In a browser that has
neither, installing does nothing at all: no error, no console output, and no
half-wired editor. Shipping the bundle is safe for every visitor.

In Chrome the API is currently behind `--enable-blink-features=WebMCP`.

## The tool set as a value

The tools are a plain array — names, titles, descriptions, input schemas,
annotations, and executable handlers — and installing is a thin wrapper that
hands that array to the browser:

```ts
import { agentTools } from '@openleaf-editor/plugins-webmcp'

agentTools.map((tool) => tool.name)
// ['openleaf_list_editors', 'openleaf_get_capabilities', 'openleaf_get_document',
//  'openleaf_find_text', 'openleaf_replace_at']
```

From a script tag it is `OpenLeaf.agentTools` once the bundle has loaded, the
same way `OpenLeaf.registerSaveHandler` is exposed by the session bundle. This
is what makes the surface testable without a flagged browser, and it is what a
host integration reaches for when it wants to drive a tool itself.

## Accessibility and CSP

Nothing here renders. There is no UI, no stylesheet, and no icon set, so there
is nothing to make accessible and nothing for a style-src policy to allow.
