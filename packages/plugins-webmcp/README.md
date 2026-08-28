# `@openleaf-editor/plugins-webmcp`

An opt-in WebMCP tool surface for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): an agent driving the browser can ask which OpenLeaf editors are on the page, what each one is able to do, what is currently in it, where a given string occurs in it, and can format a passage using the editor's own commands.

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
| `openleaf_apply_command` | **no** | no | Applies one of the editor's own registered commands — bold, italic, a list — to the text a handle names. |

Every result is a **JSON string**, because a string is all the browser's execute
path returns. The envelope is the same for every tool:

```json
{ "ok": true,  "editors": [{ "id": "post-body", "label": "Post body" }] }
{ "ok": false, "error": "unknown-editor", "message": "…what to do instead" }
```

`error` is a short token to branch on, and `message` is written for a model to
read: it says what to do next, because "not found" and "search again" are
different instructions. The tokens are `unknown-editor`, `invalid-argument`,
`stale-handle`, `unknown-command`, `unsupported-command`, `preserved-region`
and `refused`.

Read tools carry the `readOnlyHint` annotation, so the client driving the agent
can decide when a call needs a person's confirmation. Any tool that returns
document content carries `untrustedContentHint`, because a document is exactly
where text aimed at the agent reading it can hide. `openleaf_get_document` and
`openleaf_find_text` are annotated with it — one returns the document, the other
the text around each match; `openleaf_list_editors`,
`openleaf_get_capabilities` and `openleaf_apply_command` return identifiers,
type names and command labels only, and are annotated accordingly.
`openleaf_apply_command` is the one tool annotated as **not** read-only, which
is what lets a client decide that it, and only it, is worth confirming with a
person.

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

## Applying a command

`openleaf_apply_command` runs one of the editor's own registered commands
against the text a handle names. It deliberately does not write markup:

```json
{ "id": "post-body", "command": "bold", "handle": "…" }
```

Routing through the command is the whole point. A command already knows what it
is allowed to do — it declines on a figure, it stops at an isolating boundary,
it knows which marks its own schema permits — so an agent inherits every guard a
keyboard shortcut has, including ones added by a plugin this package has never
heard of. There is no list of command names anywhere in the package.

- **Only what that editor offers.** `command` must be an id
  `openleaf_get_capabilities` reported *for that editor*. Both tools read the
  same intersection of the registry and the editor's `toolbar` layout, so a
  command it listed is a command this will run. Anything else is
  `unknown-command`.
- **Some offered commands still cannot be applied.** `blockType`, `link`,
  `image` and `source` open a dialog or build their own control; there is no
  plain command underneath, so they answer `unsupported-command`. Retrying will
  not help, and reporting them as applied would be worse — the agent would move
  on believing the heading exists.
- **A command that declines reports it.** `refused`, and the document is
  untouched. That is the greyed-out button, in words.
- **Preserved markup is refused**, with `preserved-region`. So is a readonly
  editor, and one whose author has the HTML source view open — the editor
  disables its own toolbar in both cases, and a change made behind the source
  view would be discarded when it closes.
- **One call is one transaction**, marked as agent-originated, so one undo
  reverses one agent action.
- **The handle survives.** Formatting does not delete the text, so a second
  command can be applied to the same handle.

The `handle` and the editor `id` must agree. A handle carries its own editor, so
a pair that disagrees is `invalid-argument` rather than a guess — preferring the
handle would edit a document the agent did not name, and preferring the id would
check the wrong editor's toolbar for what is allowed.

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
//  'openleaf_find_text', 'openleaf_apply_command']
```

From a script tag it is `OpenLeaf.agentTools` once the bundle has loaded, the
same way `OpenLeaf.registerSaveHandler` is exposed by the session bundle. This
is what makes the surface testable without a flagged browser, and it is what a
host integration reaches for when it wants to drive a tool itself.

## Accessibility and CSP

Nothing here renders. There is no UI, no stylesheet, and no icon set, so there
is nothing to make accessible and nothing for a style-src policy to allow.
