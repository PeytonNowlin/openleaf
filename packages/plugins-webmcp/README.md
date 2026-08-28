# `@openleaf-editor/plugins-webmcp`

An opt-in WebMCP tool surface for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): an agent driving the browser can ask which OpenLeaf editors are on the page, what each one is able to do, what is currently in it, how it is structured, and where a given string occurs in it, and can rewrite a passage it located, add content beside one, or format one with the editor's own commands.

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

Installing offers an agent the whole tool set. To narrow it, pass a
[permission predicate](#permission).

## Tools

Tool names are page-global, so every one of them is in the `openleaf_`
namespace.

| Tool | Read-only | Returns document content | What it does |
| --- | --- | --- | --- |
| `openleaf_list_editors` | yes | no | Lists the OpenLeaf editors on the page, with an identifier for each. |
| `openleaf_get_capabilities` | yes | no | Reports what one editor's document can store, and which editing commands that editor actually offers. |
| `openleaf_get_document` | yes | **yes** | Returns one editor's current content as HTML — including edits the author has not saved. |
| `openleaf_get_structure` | yes | **yes** | Outlines one editor's blocks — type, heading level, and the start of the text — with a handle for each, and without its markup. |
| `openleaf_find_text` | yes | **yes** | Searches one editor for a literal string, and returns a handle for each match. |
| `openleaf_replace_at` | **no** | no | Replaces the text one handle names with HTML, as a single undoable step. |
| `openleaf_insert_html` | **no** | no | Inserts HTML before or after the text one handle names, leaving that text in place. |
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
`stale-handle`, `unknown-command`, `unsupported-command`,
`preserved-region`, `rejected-content`, `invalid-position` and `refused`.

Read tools carry the `readOnlyHint` annotation, so the client driving the agent
can decide when a call needs a person's confirmation. Any tool that returns
document content carries `untrustedContentHint`, because a document is exactly
where text aimed at the agent reading it can hide. `openleaf_get_document`,
`openleaf_get_structure` and `openleaf_find_text` are annotated with it — one
returns the document, one an outline built from its headings, one the text
around each match; `openleaf_list_editors`, `openleaf_get_capabilities`,
`openleaf_replace_at`, `openleaf_insert_html` and `openleaf_apply_command`
return identifiers, type names and command labels only, and are annotated
accordingly. Those last three are the tools annotated as **not** read-only,
which is what lets a client decide that they, and only they, are worth
confirming with a person.

## Permission

Installing is a coarse decision: it offers an agent the whole set or none of it.
`allowTool` is the fine one — a synchronous predicate asked before **every** tool
call, including `openleaf_list_editors`.

```ts
import { installAgentTools } from '@openleaf-editor/plugins-webmcp'

installAgentTools({
  // An agent may read anything on this page, and may only write to the draft.
  allowTool: ({ tool, editor, readOnly }) => readOnly || editor === 'draft',
})
```

It is handed one object:

| Field | |
| --- | --- |
| `tool` | The tool's name, e.g. `'openleaf_replace_at'`. |
| `editor` | The editor identifier the call names, or `null` for `openleaf_list_editors` — the one tool that takes no editor. |
| `readOnly` | The tool's own `readOnlyHint`, so `({ readOnly }) => readOnly` is the whole of "allow reads, refuse writes". |

Answering with `readOnly` and `editor` rather than with a list of tool names is
the point of those two fields: a policy written today still means what its
author meant after a tool is added to the set, and a list of names does not.

- **A refused call returns `{"ok":false,"error":"refused","message":"…"}`** and
  changes nothing. The predicate is asked before any argument is validated and
  before anything is looked up, so a refusal is not a partial call — it is not a
  call. The message tells the agent it is the site's policy rather than a mistake
  it can correct, so it does not retry.
- **A predicate that throws is a refusal.** A host predicate that could not
  reach whatever it needed has not said yes, and the safe reading of "did not say
  yes" on a write path is no. Nothing of the thrown error travels back to the
  agent.
- **With no predicate, every tool behaves exactly as it does without this
  option.** The default is not a permissive predicate; it is no predicate.
- **It is synchronous, and it answers with a boolean.** Deliberately: staging a
  change as a reviewable diff for a person to approve is a substantially larger
  feature, and the proposal's user-interaction mechanism is not something the
  shipping implementation can be relied on for. This asks a question the host can
  answer out of what it already knows.
- **Only `true` allows a call.** The answer is compared with `===`, so anything
  else refuses — including a truthy value that is not `true`. An `async`
  predicate answers with a Promise, and one whose body ends in the session it
  looked the decision up in answers with an object; both are truthy, and neither
  is a policy that said yes. If your decision needs an `await`, cache the answer
  and have the predicate read the cache.

It is not a security boundary against the page itself. Anything running on the
page can call `agentTools` directly, and everything the editor produces still has
to be [sanitized on your server](#openleaf-editorplugins-webmcp). What it is: the
place where the integrator hosting the editor gets to express a policy at all.

From a script tag the predicate is `OpenLeaf.registerAgentPermission(fn)`, which
is `allowTool` on its own — that bundle installs on load, so by the time your own
script runs, `installAgentTools` has already been called and a second call is
ignored.

**It is set-once, and it cannot be cleared.** The first predicate registered is
the one every call is asked, whether it arrived through `installAgentTools` or
through this function, and a later call — another predicate, or `null` — is
ignored the same way a second `installAgentTools` is. It has to be: this is a
function on the page's own global, so anything that runs after you could
otherwise hand the tools a policy of its own or take yours off. A policy that
changes with the host's state belongs *inside* the predicate, which is asked on
every call and can read that state each time.

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-webmcp.min.js"></script>
<script>
  OpenLeaf.registerAgentPermission(({ readOnly }) => readOnly)
</script>
```

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

## Outlines

`openleaf_get_structure` answers with a map of a document rather than the
document. Reading a fifty-section article to retitle one of its sections costs
an agent its context before it starts, so the outline names each block and
nothing else:

```json
{
  "ok": true,
  "id": "post-body",
  "outline": [
    { "handle": "…", "type": "heading", "level": 2, "text": "Introduction" },
    { "handle": "…", "type": "paragraph", "text": "OpenLeaf is a small editor…" },
    { "handle": "…", "type": "bullet_list", "text": "one two three" }
  ],
  "truncated": false
}
```

- **`type`** is the block's node type, and **`level`** is on headings only.
- **`text`** is the start of the block's text, whitespace collapsed. It is
  document content, so it carries the same warning the document does.
- **`handle`** names that whole block, and is the same kind of handle a search
  returns — so an outline entry is something an agent can act on, not just read.

Nested blocks are not listed separately: a list or a table is one entry, and
`openleaf_find_text` is how an agent addresses something inside it. An outline
that descended into every list item would be the document again with different
punctuation.

An empty paragraph is not listed, so a document with nothing in it outlines as
`{"ok":true,"outline":[]}` rather than as an error. A block that carries no text
but is still something the author put there — a rule, a preserved region — is
listed, because an agent inserting after it has to know it is there. At most 200
blocks come back, with `"truncated": true` when there were more; the cap is the
handle table's, since an outline longer than the 256 handles an editor keeps
would go stale at the top while it was still being read.

## Handles

Every tool other than the listing acts on a place in a document, and a place
cannot be named by a selection: a selection does not survive the round trip out
to an agent and back. So `openleaf_find_text` returns a **handle** per match, and
`openleaf_get_structure` one per outlined block — an opaque token the agent
passes to a later call.

```json
{ "ok": true, "id": "post-body",
  "matches": [{ "handle": "…", "context": "the first beta here" }], "truncated": false }
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
an empty `"matches"`, not an error. At most 50 matches come back, with
`"truncated": true` when there were more, because an agent that believes it has
seen every occurrence will replace them all.

## Writing

`openleaf_replace_at` takes a handle, the editor it belongs to, and the HTML to
put there. It, `openleaf_insert_html` and `openleaf_apply_command` are the three
tools in the set that are not annotated read-only, which is what tells the
client driving the agent that these are the calls to ask a person about.

```json
{ "id": "post-body", "handle": "…", "html": "<strong>rewritten</strong>" }
```

Five things hold for every agent write — for `openleaf_insert_html` and
`openleaf_apply_command` as much as for this one — and they are the reason the
write path is one module rather than one per tool:

- **The content is sanitized before it is parsed, by the same policy a paste
  goes through.** This ordering is the whole of it. The preservation layer is a
  catch-all: markup the schema does not recognise is wrapped and kept rather
  than rejected, so parsing agent HTML first would turn hostile or malformed
  input into an opaque atom the document then carries faithfully forever —
  preserved *because* nothing could parse it. Running the policy first means an
  agent can put nothing into a document that a person could not have pasted
  into it. HTML the policy leaves nothing of is refused with
  `rejected-content` rather than written as an empty passage. The policy is
  applied as it is to *foreign* input: `normalizePastedHtml` picks a normalizer
  from what the markup looks like, and the one it picks for a copy out of an
  OpenLeaf editor keeps inline styles — so a write is routed past that branch
  rather than letting an agent select its own sanitizer by stamping the marker
  on its own HTML.
- **A range covering preserved markup is refused**, with `preserved-region`.
  The editor promises to hand that markup back byte-identical, and that promise
  is only kept if nothing edits inside it.
- **A readonly editor, and one whose author has the HTML source view open, are
  refused** with `refused`. Neither is this package's policy: the editor
  disables its own toolbar in both cases, and a change made behind the source
  view would be discarded the moment the author closes it.
- **A refused write changes nothing.** Every check runs before anything touches
  the editor, so a failure is not a partial write; it is not a write. The
  integrator's own [permission predicate](#permission) is the first of those
  checks, and refuses with the same `refused` token.
- **One call is one transaction**, and a run of calls is one undo — see
  [Undo](#undo).

A replacement spends its handle: the text it named is gone, so the handle
resolves to `stale-handle` afterwards. Search again before editing the same
passage twice.

Passing the editor identifier alongside the handle is redundant — handles are
page-unique — and required anyway: it is what turns an agent that has muddled
two editors' handles into a refusal rather than a correct-looking write to the
document it did not mean.

## Inserting

`openleaf_insert_html` adds content beside the text a handle names rather than
over it, so the handle survives and can be inserted at again:

```json
{ "id": "post-body", "handle": "…", "html": "<p>A new paragraph.</p>", "position": "after" }
```

`position` is `"before"` or `"after"`, and it is required. "Insert at this
heading" means opposite things to an agent writing an introduction and one
writing the section, so there is no default to guess wrong.

The one thing insertion does that replacement does not is ask the schema first.
Replacement is fitted to the range it lands in — that is what `replaceRange`
is for, and it is right for a call that means "this text becomes that". An
insertion has no such licence: a heading aimed into the middle of a sentence
would be fitted by splitting the paragraph in two, and a marked-up run aimed
into a code block by dropping the marks. Both would be reported as successes,
and the agent would read back a document nobody asked for. So content the
position cannot hold is refused with `invalid-position`, and the message names
what that position does hold:

```json
{ "ok": false, "error": "invalid-position",
  "message": "that HTML cannot go there: a \"paragraph\" holds inline*. …" }
```

The two ways out of it are the two shapes a handle comes in. A handle from
`openleaf_find_text` names inline text inside one block, and takes inline HTML —
a lone `<p>` wrapper is unwrapped into the sentence, because a model wraps its
answer in one. A handle from `openleaf_get_structure` names a whole block, and
takes whole blocks.

The HTML is parsed on its own, so a space at either edge of it is leading or
trailing whitespace in a document and goes the way it goes in any browser. Use
`&nbsp;` where a space between words matters.

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
- **Nor can a command that ignores the selection.** `undo` and `redo` are on the
  default bar and do have a plain command, but they act on the document's last
  history event wherever it happened — so a handle does not scope them, and an
  agent that ran one would revert an author's unrelated work and be told the
  handle-scoped call succeeded. They answer `unsupported-command` too. A toolbar
  item declares this with `scope: 'document'` in
  [`@openleaf-editor/ui`](../ui/README.md); nothing here keeps a list of names.
- **A command that declines reports it.** `refused`, and the document is
  untouched. That is the greyed-out button, in words.
- **Preserved markup is refused**, with `preserved-region`. So is a readonly
  editor, and one whose author has the HTML source view open — the editor
  disables its own toolbar in both cases, and a change made behind the source
  view would be discarded when it closes.
- **One call is one transaction**, marked as agent-originated and grouped with
  the agent's other writes — see [Undo](#undo).
- **The handle survives.** Formatting does not delete the text, so a second
  command can be applied to the same handle.

The `handle` and the editor `id` must agree. A handle carries its own editor, so
a pair that disagrees is `invalid-argument` rather than a guess — preferring the
handle would edit a document the agent did not name, and preferring the id would
check the wrong editor's toolbar for what is allowed.

## Undo

**A run of agent writes is one press of undo.** However many tools an agent
called and however long it took over them, an author who watched it restructure
a document presses Ctrl+Z once and has the document back as it was before the
agent started. Redo brings the whole run back the same way.

This is not the editor's default, and it could not be. Undo events are grouped
by elapsed time and by adjacency, which are the wrong questions to ask about an
agent: tool calls arrive in a burst, so the same six-paragraph rewrite would
collapse into one step or fragment into six depending on how fast the model
answered and how far apart the paragraphs were — and the author would have no
way to know how many times to press. Grouping here keys off the mark every agent
write carries instead, so a slow agent and a fast one produce the same one step.

**An edit the author makes themselves ends the run.** The write that follows it
opens a new undo event, and the write before it is already closed, so undoing the
agent never takes back a sentence the person typed and undoing their sentence
never takes back the agent's work. Typing that is nobody's but the author's
groups exactly as it does in an editor this package was never installed in.

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
//  'openleaf_get_structure', 'openleaf_find_text', 'openleaf_replace_at',
//  'openleaf_insert_html', 'openleaf_apply_command']
```

From a script tag it is `OpenLeaf.agentTools` once the bundle has loaded, the
same way `OpenLeaf.registerSaveHandler` is exposed by the session bundle. This
is what makes the surface testable without a flagged browser, and it is what a
host integration reaches for when it wants to drive a tool itself.

These are the gated handlers: the [permission predicate](#permission) is applied
where the array is composed, not inside each tool, so a call made through
`agentTools` is subject to it exactly as a call arriving from the browser is —
and a tool added to the set later is gated by having been added.

## Accessibility and CSP

Nothing here renders. There is no UI, no stylesheet, and no icon set, so there
is nothing to make accessible and nothing for a style-src policy to allow.
