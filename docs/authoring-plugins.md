# Authoring schemas and plugins

How to extend OpenLeaf: what the extension points are, what they cost, and the
interactions that will take a day out of your week if nobody tells you about
them first.

This document describes the code as it is in the tree today, not the code as it
is planned. Where something is missing, it says so and says what to do instead.

The reference implementations are the seven plugins in this repository:

| Package | What it adds |
|---|---|
| `plugins-table` | Table editing: cell selection, column resize, property dialogs, the insert grid |
| `plugins-insert` | Media embeds, collapsible sections, anchors, character map, emoji, page breaks, snippets, image resize |
| `plugins-session` | Find and replace, word count, autosave and restore, save, print, preview, new document |
| `plugins-colour` | Text and highlight colour, as a keyboard-navigable swatch picker |
| `plugins-highlight` | Syntax highlighting for code blocks, and a formatted source view |
| `plugins-import` | HTML and plain-text file import, plus the converter seam |
| `plugins-import-docx` | Word `.docx` import, on top of `plugins-import` |

`plugins-table` is the one most examples below are adapted from, because it is
the only one that exercises every extension point at once. Where another plugin
is the better illustration, it says so.

---

## 1. What a plugin can and cannot do today

| You want to | Mechanism | Status |
|---|---|---|
| Add ProseMirror plugins (behaviour, decorations, input rules, node views) | `registerEditorPlugin(factory)` | Works |
| Add a toolbar button with active/enabled state | `registerToolbarItem(spec)` | Works |
| Add icons | `registerIcons(paths)` | Works |
| Push state a predicate cannot derive | `element.toolbarInstance?.setItemState(id, …)` | Works, per editor |
| Replace a built-in toolbar item | `registerToolbarItem` with an existing id | Works, last write wins. A replacement for `link` must round-trip `rel` and `id` the same way `promptForLink` does — merge `noopener noreferrer` for `_blank`, do not wipe author tokens. |
| Reach the live view | `element.view` | Works |
| Add a keyboard binding | a `keymap()` plugin via `registerEditorPlugin` | Works, but cannot shadow a core binding — see [4.6](#46-keyboard-bindings-cannot-shadow-core-bindings) |
| **Add a node or mark type** | `registerSchemaExtension({ id, nodes, marks })` | Works — see [1.1](#11-schema-extensions), and note the timing rule: register **before** the editor is built |
| Replace a built-in node or mark | `registerSchemaExtension` with `replaces: ['name']` | Works. A clash without `replaces` throws, deliberately |
| Translate your labels | `t()` and `registerTranslations` | Works — see [4.10](#410-every-string-you-ship-is-a-translatable-string) |
| Add a colour grid or popover control | `registerToolbarItem` with `type: 'custom'` and a `render` function | Works — see [4.9](#49-custom-controls-own-their-own-dom-and-their-own-cleanup) |
| Add a dropdown | `registerToolbarItem` with `type: 'select'`, `options`, `getValue`, `applyValue` | Works — native `<select>`, same keyboard contract as block type |
| Add CSS for your node | `registerStyles(css)` | Works — adopted stylesheets, no `<style>` fallback; see [4.7](#47-css-goes-through-registerstyles-from-your-own-bundle) |

### 1.1 Schema extensions

A plugin contributes node and mark types out of tree:

```ts
import { registerSchemaExtension } from '@openleaf-editor/core'

registerSchemaExtension({
  id: 'acme/callout',        // stable and unique; namespace it
  nodes: { callout },        // NodeSpec, by schema name
  marks: {},                 // MarkSpec, same shape
})
```

It returns an unregister function. `packages/core/src/extensions.ts` is the
whole implementation and is worth reading; the four rules that will actually
affect you are these.

**Register before the editor is built.** A ProseMirror `Schema` is immutable,
and `EditorState.reconfigure` — the mechanism that lets a late-loading plugin
add *behaviour* to an open editor — takes the schema from the old state and
cannot change it. So schema extension is not "register and the editors update";
it is "register before an editor is built, or wait for the next one". The
element defers building its view until the document's scripts have run, which
covers every documented integration, and warns rather than failing silently if
you miss the window:

> a schema extension registered after this editor was built, so its node types
> are not available here. […] load the plugin script before the editor, or
> reload the page. Editors created from now on will have it.

This is the one respect in which schema extensions differ from
`registerEditorPlugin` and `registerToolbarItem`, both of which apply to live
editors. Code-split your *plugins* freely; load your *schema* eagerly.

**Collisions throw, deliberately.** `registerToolbarItem` is last-wins, because
a button is UI and replacing one is a feature. A node type is a *storage
format*: two definitions of `footnote` mean two serializations of the same
content chosen by script-tag order, and whichever loses has already written
documents in its shape. Declare `replaces: ['footnote']` to opt in.

**No priority, and no positioning hint.** The preservation layer's catch-all
rules sit at priority 0 and 1, so a rule at the default priority already beats
them for free — and `createSchema` throws on any extension rule at priority ≤ 1
rather than let you tie with the catch-all and have insertion order decide.
Nodes are appended, never prepended, because a leading `group: 'block'` node
becomes the document's `defaultType` and every new document would start with
your widget.

**Unmodelled attributes are carried for you.** Adding a node type strictly
*reduces* fidelity for the tag it claims: before your node existed, the
preservation layer kept the element and every attribute on it; afterwards the
spec keeps only what it declares, so a callout modelling `class` silently drops
the `id` and `data-analytics` that used to survive. So the residue is captured
on parse and merged back on serialize, applied at schema-build time — an author
cannot opt out by forgetting. `carryUnknownAttributes: false` opts out
explicitly, and [is security-relevant](#42-sanitization-a-new-element-that-nobody-allowed-is-a-new-element-that-dies)
because the capture is also where `on*` handlers and unsafe URLs are filtered.

The capture also refuses an attribute name that cannot be written back. The HTML
parser accepts names `setAttribute` rejects — `<p ="v">` parses to one attribute
literally named `="v"` — and carrying one meant the throw arrived later, in the
middle of rendering the document. The test is the XML `Name` production rather
than whatever the current host accepts, because browsers are laxer than the spec
for HTML documents and jsdom is not: a name accepted in a browser session would
otherwise throw on a jsdom server. A name a parser only produced through error
recovery is not content anybody authored, so nothing is lost.

Everything downstream of the schema is already schema-agnostic. Commands resolve
types per call from `state.schema` and decline rather than throw when a type is
absent; `parseHtml` and `serializeHtml` take an optional `schema` in
`HtmlIOOptions`, and `serializeHtml` defaults to `node.type.schema` — the
document's own — so a document built on an extended schema serializes with a
serializer that knows its node types.

### 1.2 In core or in your plugin?

Extensions being available out of tree does not mean every node belongs there.
The question is whether the markup **already exists in content your users have**.

`packages/core/src/tables.ts` states the case:

> without these node types, a `<table>` in stored content is claimed by the
> preservation layer and becomes a single opaque atom. It round-trips
> faithfully — but it is *uneditable*.

"We read your tables but you may not touch them" is not something you can tell a
CMS. If stored documents contain your markup, the node spec wants to be in core
so that **every** deployment reads it correctly whether or not your plugin is
installed, and only the *editing machinery* — commands, toolbar, node views,
resize handles — is opt-in. That is the tables split, and the insert package's
`<figure>`, `<details>` and media nodes are there for the same reason.

If your markup can only ever be created by your own plugin, a schema extension
in your own package is exactly right, and it costs core nothing. That is the
case `registerSchemaExtension` exists for.

The middle case — markup that exists in *your customers'* content but not
everyone's — is also a schema extension. Ship it in your package, and make sure
your package is loaded on every page that renders those documents, not only the
ones with your toolbar button.

---

## 2. The three delivery models

All three can contribute a node type. They differ in how the plugin reaches the
same copy of `@openleaf-editor/core` as the editor — which is not optional,
because two copies means two registries and two schemas.

| Model | Ships as | Use when |
|---|---|---|
| Second script tag, shared runtime | An IIFE bundle loaded after `openleaf.min.js` | The integrator has no build step — a PHP template, a Django form, a WordPress theme |
| ESM import | A normal npm package | The integrator already runs a bundler |
| In-repo package | A `packages/*` workspace package | The node type belongs in core's base schema — see [1.2](#12-in-core-or-in-your-plugin) — or the feature belongs in the project |

### 2.1 Second script tag

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-tables.min.js"></script>
```

Order matters, and the reason is not load timing. `packages/element/src/global.ts`
publishes the shared runtime on `window.OpenLeaf.__runtime`, and the second
bundle resolves `@openleaf-editor/core`, `@openleaf-editor/ui` and every `prosemirror-*`
module from it instead of bundling its own:

> Two schemas means a table node created by the plugin is a different node type
> than the one the editor understands, which fails in ways that are very hard to
> read.

Size is the visible benefit — 12.5 KB gzipped instead of roughly 200 KB — but
correctness is the real one.

**Limitation, stated plainly.** The rewriting is done by `shareRuntime()` in
`demo/build.mjs`, which is a private build helper in this repository, not a
published package. And `__runtime` is documented in `global.ts` as *not* a
public API:

> `__runtime` is named with underscores because it is not a public API. It is a
> linkage detail between bundles built from this repository at the same version.

So a third party who wants to ship a script-tag plugin today has to copy that
esbuild plugin and depend on an interface that carries no compatibility promise.
If you are outside this repository, prefer the ESM model until a supported
version of this exists. This is an open item for the maintainer, listed in
[section 6](#6-known-gaps).

### 2.2 ESM import

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'

installTableEditing()
```

The bundler deduplicates `@openleaf-editor/core` and the `prosemirror-*` packages, so
there is one schema and one registry. No runtime shim is involved.

Timing does not matter here either. `registerEditorPlugin` notifies listeners,
and `<openleaf-editor>` subscribes:

```ts
this.#unwatchPlugins = onEditorPluginsChange(() => {
  view.updateState(view.state.reconfigure({ … }))
})
```

An editor that already exists when a code-split chunk resolves picks the plugin
up. `registerToolbarItem` has the matching mechanism via `onRegistryChange`, and
the toolbar re-renders. Without both of those, a lazily loaded plugin's buttons
would appear and do nothing, or never appear at all.

**Schema extensions are the exception**, and it is the one thing to get right
about this model: `registerSchemaExtension` cannot reach an editor that already
exists, because a document's schema is fixed when its editor is created. If your
plugin contributes a node type, its module has to be imported eagerly — not
behind a `import()` that resolves after the element upgrades. Split the toolbar
and commands out lazily if you like; the schema registration goes in the eager
half. See [1.1](#11-schema-extensions).

### 2.3 In-repo package

Use this when the node type belongs in core's *base* schema — see
[1.2](#12-in-core-or-in-your-plugin) — rather than being contributed by an
extension. The shape, copied from tables:

```
packages/core/src/<feature>.ts        the NodeSpec — ships in every deployment
packages/core/src/schema.ts           register it in coreNodes
packages/core/src/index.ts            export it
packages/core/test/public-api.test.ts declare the new export and node name
packages/plugins-<feature>/           commands, icons, toolbar items — opt-in
demo/entry-<feature>.ts               `install<Feature>()` on load
demo/build.mjs                        a second `build()` call for the bundle
scripts/bundle-budgets.mjs            a budget for that bundle
```

Note `coreNodes`, not `schema`. `packages/core/src/schema.ts` ends with
`export const baseSchema`, built from the `coreNodes` and `coreMarks` maps; the
old `schema` singleton was **deleted** rather than deprecated, because a
retained const typechecks and then fails in the field — a node built from one
schema instance is rejected by a document built from another. Two guards keep it
deleted: `public-api.test.ts` pins the export list, and `scripts/verify.mjs` has
a "no schema singleton outside core" step that fails on any package importing a
`schema` binding from `@openleaf-editor/core`. The runtime schema is
`coreSchema()`, a memoized *function* over the registered extensions, invalidated
whenever the registry changes.

---

## 3. A worked example: a callout node

A callout is `<div class="callout">` with block content inside it. It is a good
worked example for three reasons: it is the shape most CMS integrations actually
ask for; it collides head-on with the preservation layer; and the repository
already contains a stored fixture for it —
`packages/core/test/fixtures/stored/callout-div.html` — which today passes
losslessly *because* preservation claims it.

That fixture is the acceptance test for this whole exercise. Before the change,
it round-trips byte-identically as an `unknown_block`. After the change, it must
still round-trip byte-identically, now as an editable `callout`.

### 3.1 The node spec — `packages/plugins-callout/src/schema.ts`

In the plugin package, not in core: `div.callout` is markup this plugin's users
have, not markup every OpenLeaf deployment has. See
[1.2](#12-in-core-or-in-your-plugin) for when that answer flips.

```ts
import type { NodeSpec } from 'prosemirror-model'

export const callout: NodeSpec = {
  content: 'block+',
  group: 'block',
  // Same reason blockquote and list_item are defining: content pasted into a
  // callout should stay in the callout rather than replacing it.
  defining: true,
  attrs: {
    // The full class string, not a parsed variant name. `callout--warning`,
    // `callout is-collapsed` and whatever a 2011 theme invented are all
    // load-bearing to somebody, and re-emitting a normalised subset is
    // attribute loss wearing a normalisation costume.
    class: { default: 'callout' },
    calloutId: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.callout',
      getAttrs(dom) {
        const el = dom as Element
        return {
          class: el.getAttribute('class'),
          calloutId: el.getAttribute('data-callout-id'),
        }
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: node.attrs['class'] as string }
    const id = node.attrs['calloutId'] as string | null
    if (id !== null) attrs['data-callout-id'] = id
    return ['div', attrs, 0]
  },
}
```

No `priority` is set, and you must not set one. The default is 50 and the
preservation catch-all is at 0, so this already wins;
`createSchema` throws on any extension rule at priority ≤ 1 rather than let you
tie with the catch-all.
[Section 4.1](#41-the-preservation-layer-is-a-catch-all-you-have-to-beat)
explains what happens when a rule loses that race.

Note also what the spec does **not** declare: `data-analytics`, `id`, or
whatever else a 2011 theme put on that div. It does not have to. Extension nodes
carry unmodelled attributes through the round trip by default — see
[1.1](#11-schema-extensions) — so claiming a tag no longer costs the author every
attribute you did not think of.

Register it:

```ts
import { registerSchemaExtension } from '@openleaf-editor/core'
import { callout } from './schema.js'

registerSchemaExtension({ id: 'acme/callout', nodes: { callout } })
```

That call goes in the eagerly-imported half of your package. A schema extension
registered after an editor exists cannot reach it — the editor logs a warning
saying so, rather than failing silently.

### 3.2 The command — `packages/plugins-callout/src/index.ts`

```ts
import { isNodeActive } from '@openleaf-editor/core'
import { registerIcons, registerToolbarItem } from '@openleaf-editor/ui'
import { lift, wrapIn } from 'prosemirror-commands'
import type { Command, EditorState } from 'prosemirror-state'
import { CALLOUT_ICON_PATHS } from './icons.js'

/** Is the selection inside a callout? */
export function inCallout(state: EditorState): boolean {
  return isNodeActive(state, 'callout')
}

/**
 * Wrap the selection in a callout, or lift it out if it is already in one.
 *
 * Toggle rather than insert, matching how blockquote behaves in core: a
 * callout is a state the cursor is either in or not, and an insert-only
 * command gives an author no way back out with the same control.
 */
export const toggleCallout: Command = (state, dispatch, view) => {
  // From the state's schema, never from the imported `schema` singleton.
  const type = state.schema.nodes['callout']
  if (!type) return false
  if (inCallout(state)) return lift(state, dispatch, view)
  return wrapIn(type)(state, dispatch, view)
}
```

**Two things in those four lines are not stylistic.**

`state.schema`, not the exported `schema`. `plugins-table` was changed to do
this and says why in a comment: "a plugin that captured one schema would build
nodes the editor's schema rejects." A node type is identity-compared, so a node
built from the wrong `Schema` instance is rejected by a document that looks
like it should accept it, and the symptom does not name the cause. This also
means your command keeps working the day the schema stops being a singleton.

The `undefined` check is required by `noUncheckedIndexedAccess` in
`tsconfig.base.json`, and returning `false` rather than throwing is the
convention core adopted: "a command asked to bold text in a schema with no
`strong` mark should decline — returning `false` is ProseMirror's way of saying
'not applicable here', and the toolbar already renders that as a disabled
button. Throwing would take the editor down because a plugin trimmed the
schema."

Every command follows the ProseMirror convention that `commands.ts` describes:
called with `(state)` alone it reports whether it *could* apply without doing
anything. That is what makes the toolbar's disabled state free — the same
function answers "can I?" and "do it".

### 3.3 The icon — `packages/plugins-callout/src/icons.ts`

```ts
/**
 * Callout icons, registered by the plugin rather than shipped in core.
 *
 * Same 24x24 stroked geometry as the built-in set so they sit level with the
 * rest of the toolbar.
 */

export const CALLOUT_ICON_PATHS: Record<string, string> = {
  callout: 'M4 5h16v11H9l-4 4v-4H4zM12 8v4M12 14h.01',
}
```

Constraints the built-in set follows and yours should too, from
`packages/ui/src/icons.ts`:

- A single `path` `d` string in a `0 0 24 24` viewBox, stroked, never filled.
  The sprite builder emits exactly one `<path>` per symbol.
- `stroke="currentColor"`, which is why there is no separate dark-mode set.
- **No letterforms.** "B" for bold bakes English into the interface — bold is
  *gras* in French and *fett* in German. The comment in `icons.ts` calls a
  letterform icon "a translation bug wearing a costume".
- If your icon's meaning depends on reading direction it needs to be in the
  `DIRECTIONAL` set in `icons.ts` to be mirrored in RTL documents. That set is
  private to core today, so a plugin icon cannot opt into mirroring — another
  item for [section 6](#6-known-gaps).

### 3.4 The toolbar item

```ts
registerToolbarItem({
  id: 'callout',
  type: 'button',
  // `toggle` gets aria-pressed and reflects isActive. `action` does not:
  // marking an insert as "pressed" is meaningless and screen readers say so.
  kind: 'toggle',
  label: 'Callout',
  icon: 'callout',
  command: toggleCallout,
  isActive: (state) => inCallout(state),
  // No isEnabled. It defaults to asking `command` whether it would apply, and
  // for a wrap-or-lift toggle that is the exact right answer.
})
```

For a preset dropdown, use `type: 'select'`. Option values should be the spelling
the schema stores so `getValue` can match them after a round-trip:

```ts
registerToolbarItem({
  id: 'fontFamily',
  type: 'select',
  label: 'Font family',
  options: [
    { value: '', label: 'Default' },
    { value: 'Georgia', label: 'Georgia' },
    { value: '"Times New Roman"', label: 'Times New Roman' },
  ],
  getValue: (state) => activeFontFamily(state) ?? '',
  applyValue: (value) => setFontFamily(value === '' ? null : value),
})
```

Name `isEnabled` explicitly only when the command's own answer is wrong or
incomplete. Every table command does, because all of them are meaningless
outside a table:

```ts
isEnabled: (state) => inTable(state) && command(state),
```

The comment in `plugins-table` gives the reason that is worth an extra
predicate: reporting them as disabled rather than letting them silently no-op
"is the difference between a control that looks broken and one that looks
unavailable".

The `label` is the accessible name, and the toolbar keeps it constant across
states. Do not write "Callout on" / "Turn callout off" — `aria-pressed` is what
the platform announces, and baking the state into the name doubles it up.

`shortcut` is a *label to look up in core's shortcut table*, not a key string.
`shortcutFor()` searches `shortcuts` in `packages/core/src/keymap.ts` by label,
so a plugin's own binding will not resolve and the tooltip falls back to the
plain label. Leave `shortcut` off unless your label is in that table.

### 3.5 Installing

```ts
let installed = false

/**
 * Idempotent, because a bundle loaded twice -- which happens in CMS templates
 * more often than anyone would like -- should not produce two sets of buttons.
 */
export function installCalloutEditing(): void {
  if (installed) return
  installed = true

  registerIcons(CALLOUT_ICON_PATHS)
  registerToolbarItem({ /* as above */ })
}
```

A plugin that *does* contribute ProseMirror plugins registers a **factory**,
never a plugin instance. `installTableEditing` does it in one line:

```ts
registerEditorPlugin(() => tableEditingPlugins())
```

That indirection is not ceremony. From `packages/core/src/plugins.ts`:

> a ProseMirror plugin instance carries per-editor state and cannot be shared
> between two editors on the same page. Calling the factory once per editor is
> the difference between two working editors and two editors fighting over one
> plugin's state.

The callout needs no ProseMirror plugins, so it does not call
`registerEditorPlugin` at all. Every registration triggers a `reconfigure` on
every live editor, so an empty factory is not free.

### 3.6 The bundle

`demo/entry-callout.ts`:

```ts
import { installCalloutEditing } from '@openleaf-editor/plugins-callout'

installCalloutEditing()
```

Then add the package to `WORKSPACE_ALIASES` in `demo/build.mjs` and a second
`build()` call modelled on the table one, with
`plugins: [shareRuntime('OpenLeaf')]`. Note the constraint `scripts/verify.mjs`
enforces: **`demo/build.mjs` must not read from any `dist/`.** There is a check
that greps the file for `/dist` and fails the gate, because that bug shipped
twice — it passes on a machine that just built and fails on a fresh checkout,
which is what CI is.

Finally, the integrator opts in by naming the item in the layout. Plugins
declare capability; integrators declare layout:

```html
<openleaf-editor for="body"
  toolbar="undo redo | bold italic | bulletList orderedList | callout | source">
</openleaf-editor>
```

An unregistered id in that string produces a `console.warn` rather than being
silently skipped, so an integrator's typo is visible.

---

## 4. The interactions that will bite you

### 4.1 The preservation layer is a catch-all you have to beat

`packages/core/src/preserve.ts` installs a rule matching **every element**:

```ts
{
  tag: '*',
  // Lowest priority: every real rule in the schema gets first refusal.
  priority: 0,
  getAttrs(dom) { … },
}
```

That is the mechanism behind the project's headline commitment. It also means
your node is in a race it can lose. The ladder:

| Priority | Rule | Effect |
|---|---|---|
| 100 | `NEVER_PRESERVE` drop rules — `script`, `iframe`, `form`, `input`, `button`, `select`, `textarea`, `link`, `meta`, `template`, and more | Element **and its contents** are discarded |
| 50 | The default for a rule with no `priority` — every real node in the schema | Your node parses |
| 1 | `unknown_inline` catch-all, restricted to paragraph-holding containers | Inline debris becomes an inline atom. Tags the HTML parser will not keep inside a `<p>` (`div`, `section`, `figure`, … — `CLOSES_OPEN_P` in `preserve.ts`) are declined so they do not serialize inside a paragraph and grow two empty paragraphs on every save. |
| 0 | `unknown_block` catch-all | Anything else becomes a block atom |

**The practical rule: do not set `priority` at all.** The default 50 already
beats both catch-alls. Set one only to disambiguate against another real rule,
and never set 0 or 1 — at a tie, the winner is decided by the order node types
appear in the schema's `nodes` map, which is not something to build on.

#### The failure mode that makes this worth a section

When your rule does not match, nothing errors. The catch-all claims the element,
`toDOM` rebuilds the original markup verbatim, and **the output HTML is
byte-identical to the input.** Verified against this repository's code:

| What you did | Node produced | Serialized output |
|---|---|---|
| Correct `tag: 'div.callout'` | `callout` | `<div class="callout">…` |
| Typo — `tag: 'div.call-out'` | `unknown_block` | `<div class="callout">…` — identical |
| `getAttrs` returns `false` | `unknown_block` | `<div class="callout">…` — identical |

There is no visual signal either. Preserved atoms have no distinct styling in
`packages/ui/src/styles.ts` — the only rule that touches them is
`.ProseMirror-selectednode`, a focus outline that appears once the atom is
already selected. So the content renders exactly as it should, and the round-trip
fidelity test passes. The only symptom is that the author cannot put a caret in
it. That will be reported to you as "the editor is broken", months later, by
somebody who cannot reproduce it on demand.

**So the assertion you need is about node types, not about HTML.** Copy the
pattern from `packages/core/test/tables.test.ts`:

```ts
function nodeTypes(html: string): string[] {
  const seen: string[] = []
  parseHtml(html).descendants((node) => {
    seen.push(node.type.name)
    return true
  })
  return seen
}

it('parses into a callout node, not a preserved atom', () => {
  const types = nodeTypes('<div class="callout"><p>hi</p></div>')
  expect(types).toContain('callout')
  // The whole point. Without this assertion the test passes either way.
  expect(types).not.toContain('unknown_block')
})
```

#### Two more things the ladder implies

**You cannot build a node on a `NEVER_PRESERVE` tag.** A node spec with
`parseDOM: [{ tag: 'form' }]` loses to the priority-100 `ignore` rule, and
because it is `ignore` rather than `skip`, the children go too — `<form><p>hi</p></form>`
parses to an empty paragraph. That is deliberate: `preserve.ts` is explicit that
preserving a `<script>` "is a vulnerability with extra steps". If you need one of
those tags, that is a conversation with the maintainer about the drop list, not a
priority you can outbid.

**A bare wrapper still unwraps.** `isLosslesslyUnwrappable` returns true for a
`div`, `span`, `section` and friends carrying **zero** attributes, and the
catch-all declines the rule so ProseMirror unwraps it. Your `div.callout` has a
class, so it never reaches that branch — but a node keyed on an attribute-free
element will never see its content as a wrapper at all.

#### If you add a normalization pass, guard it with `isInsidePreserved`

`serializeHtml` runs `unwrapSoleParagraph` over the whole output to collapse a
sole attribute-free `<p>` inside `td`/`th`, `li`, `blockquote`, and a `<details>`
body back to direct text, so that adopting OpenLeaf does not rewrite every list,
quote, disclosure and table in an archive on first save. That pass used a
plain `querySelectorAll` and therefore reached *inside* preserved
markup — rewriting a table nested in an unrecognised wrapper that the editor had
undertaken to return byte-identical.

Any pass you add over the editor's DOM or its serialized output owes the same
guard:

```ts
import { isInsidePreserved } from '@openleaf-editor/core'

for (const el of host.querySelectorAll('td, th, li, blockquote, details')) {
  if (isInsidePreserved(el)) continue
  // …your normalization…
}
```

The predicate is true for an element rebuilt from preserved markup and for
anything nested inside one, and false for everything the schema models itself.

**Do not look for a marker attribute.** The first implementation of this did use
one — `data-ol-preserved`, set on rebuild and stripped before returning the
string — and it had to be abandoned, because the stripping pass could not tell
the attribute it had just written from the same attribute occurring in a
customer's document. A customer who happened to use `data-ol-preserved` had it
silently deleted, which is precisely the failure the marker existed to prevent,
wearing a different costume. It is now a `WeakSet`, which cannot collide with
content, needs no cleanup pass, and holds its entries weakly so a
serialization's throwaway DOM is still collectable. `isInsidePreserved` is the
only supported way to ask.

Note the shape of the original bug, because it is the shape yours will have:
every preservation test used a wrapper containing a paragraph, and every table
test used a table at the top level. The defect lived exactly in the intersection
and no fixture crossed the two features. **Write the fixture that crosses your
feature with preservation**, not just the one that exercises it alone.

### 4.2 Sanitization: a new element that nobody allowed is a new element that dies

`@openleaf-editor/sanitize` ships `DEFAULT_POLICY` as an allowlist. It does not know
about your node, and default-safe means default-strip. From `SECURITY.md`:

> A default-safe sanitization policy will strip exactly that markup, destroying
> the content on the server that the editor worked to save — the same bug
> wearing a different hat.

There are two different obligations here and they have different answers.

#### Your node is in core's base schema, so extend `DEFAULT_POLICY`

If the node ships in `coreNodes` — see [1.2](#12-in-core-or-in-your-plugin) —
the editor emits it for *everyone*, and `DEFAULT_POLICY` is supposed to describe
what OpenLeaf's own schema can emit. So a new base-schema node type is a new
policy entry:

```ts
elements: {
  // …
  div: { attributes: ['class', 'data-callout-id'] },
}
```

Note what that entry costs, because it is an argument about your markup rather
than about your policy: `DEFAULT_POLICY` keys on **tag name**, so there is no way
to express "a `div`, but only when it carries `class="callout"`". Allowing the
callout means allowing `class` on every `div` the sanitizer sees. A node keyed
on a custom element — `<ol-callout>` — would be allowlistable exactly, at the
cost of not matching the `div.callout` already sitting in the customer's
database. That tradeoff is worth making deliberately rather than discovering.

**Extending the policy is not optional and it is not theoretical.** It has
already gone wrong once, in this repository, in exactly the way that hurts:

> Table nodes were added to the schema and the policy was not updated, so a user
> following SECURITY.md sanitized a table down to `RegionNorth` — the structure
> gone, the text run together. Precisely the "content dies on the server"
> failure this package was written to prevent, shipped by the package that
> prevents it.

That is from `packages/sanitize/test/agreement.test.ts`, the guard added in
response. It round-trips a document through `parseHtml`/`serializeHtml` and then
through `sanitizeHtml`, and asserts the sanitizer is a no-op:

```ts
const stored = serializeHtml(parseHtml(html))
expect(sanitizeHtml(stored, { policy: DEFAULT_POLICY })).toBe(stored)
```

End-to-end on purpose — "comparing two lists of tag names would pass while an
attribute the schema emits is quietly stripped". **Add a `SCHEMA_NATIVE` entry
exercising every attribute your `toDOM` can emit.** Include the awkward ones;
that is what the check is for.

That table gap is fixed: `DEFAULT_POLICY` now allows the full table set —
`table`, `caption`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`, `tr`, `td`,
`th`, with the attributes and style properties each needs. It is cited here as
the failure mode to design against, not as a live warning.

#### Your node is a schema extension, so ship a policy fragment

If the node comes from `registerSchemaExtension` rather than core, it is **not**
in `DEFAULT_POLICY` and must not be — the default policy describes what a
default deployment emits, and yours is not one. Integrators who install your
plugin have to widen their own policy, which means your README has to hand them
the exact call:

```ts
import { DEFAULT_POLICY, policyForPreserved } from '@openleaf-editor/sanitize'
import { CALLOUT_POLICY } from '@openleaf-editor/plugins-callout'

const policy = policyForPreserved(DEFAULT_POLICY, CALLOUT_POLICY)
```

Exporting the fragment as data beats documenting a snippet to copy: a snippet
drifts from your `toDOM` the first time you add an attribute, and nothing fails
when it does. Run the same `agreement.test.ts` round-trip against
`policyForPreserved(DEFAULT_POLICY, YOUR_FRAGMENT)` and the drift becomes a test
failure in your package instead of stripped content in somebody's database.

The same applies to `sanitizeHtml`'s unconditional rejections: `on*`,
`srcdoc`, `formaction`, `ping` and `xlink:href` are dropped whatever a policy
says, so do not model an attribute matching those and expect it to survive.

#### Markup only the preservation layer carries, so document `policyForPreserved`

If your plugin also relies on markup that stays *preserved* — an integrator's
`<drupal-media>`, a shortcode wrapper you read but do not model — that is the
integrator's decision to make in their own policy, and your README has to tell
them exactly what to write:

```ts
import { DEFAULT_POLICY, policyForPreserved } from '@openleaf-editor/sanitize'

const policy = policyForPreserved(DEFAULT_POLICY, {
  'drupal-media': ['data-entity-type', 'data-entity-uuid', 'data-view-mode'],
})
```

Put it above the fold, next to the install instructions. Three things to know
before you write that paragraph:

1. **There is no "allow whatever the editor emitted" mode, and there will not
   be.** `policy.ts` calls that "not a policy, it is a wish" — the editor
   faithfully preserves whatever an author pasted, so trusting its output
   defeats the point of having a policy.
2. **`policyForPreserved` throws for anything on `dropWithContent`.** That list
   includes `svg` and `math` as well as the obvious executables. If your node
   emits one of those, your users have to remove it from the list explicitly,
   and the error message says so — "so the decision is visible in review".
3. **`globalAttributes` is empty on purpose.** `class` is not globally safe;
   pasted content can borrow the host site's styling to impersonate UI. Name
   your attributes per element.

If your plugin ships a server-side integration, generate the config from the
extended policy rather than hand-writing it, so the Node, PHP and Python sides
cannot drift.

> **The general shape, worth internalising.** The policy is a hand-maintained
> mirror of the schema, in a different package, in a different language of
> description. Nothing about adding a node forces you to update it — which is
> why the agreement test exists, and why "did I extend the policy?" belongs on a
> checklist rather than in your memory.

### 4.3 Round-trip fidelity: two corpora, two standards

`packages/core/test/fidelity.test.ts` discovers fixtures with `readdirSync`, so
adding one is dropping a file in a directory. Which directory is the decision
that matters, because the two have opposite correct defaults.

| Corpus | Represents | Asserted |
|---|---|---|
| `packages/core/test/fixtures/stored/` | The customer's database. Their markup is authoritative and we are a guest in it. | Stable, text-preserving, **and zero attributes lost** |
| `packages/core/test/fixtures/paste/` | Foreign content from Word, Google Docs, Excel. Its styling is noise the user is trying to get rid of. | Stable, text-preserving, and **at least one attribute stripped** |

**A plugin node's fixture goes in `stored/`.** The paste corpus asserts
`expect(stripped.length).toBeGreaterThan(0)` — a fixture that legitimately
strips nothing *fails there*. Only add to `paste/` if you are shipping a paste
normalizer with real vendor junk to remove.

The stored standard is what makes `parseDOM` and `toDOM` a mutually inverse pair
rather than two functions that happen to be near each other. The harness compares
a multiset of `tag@name=value` across the whole tree, so anything your `toDOM`
declines to re-emit is reported by name.

Here is the callout example failing, which is the single most useful thing to
internalise about this section. A plausible first draft:

```ts
parseDOM: [{ tag: 'div.callout' }],
toDOM: () => ['div', { class: 'callout' }, 0],
```

Run against the fixture already in the tree, `droppedAttributes` returns two
entries and the `retains every attribute` assertion fails on them:

```
div@class=callout callout--warning (1 of 1 lost)
div@data-callout-id=7 (1 of 1 lost)
```

Before the change, that fixture was lossless — preservation kept the whole
element verbatim. **The moment you claim a tag with a real node, you own every
attribute anyone ever put on it**, and normalising the class list back to
`callout` is exactly the silent information loss the preservation layer exists to
prevent. This is why the spec in section 3.1 stores the full class string rather
than a parsed variant name.

`ALLOWED` at the top of the fidelity test is the escape hatch, and it is
deliberately unpleasant to use:

> Adding an entry here is a deliberate decision to discard part of somebody's
> document, and has to be argued for in a pull request. Empty is the goal state.

It is empty today. Keep it that way. The stored corpus stands at **8/8 fully
lossless**, and the eighth fixture — `preserved-table.html` — exists precisely
because it crosses two features that each had coverage on their own.

Browser coverage is separate and also expected. `packages/element/test/e2e/tables.spec.ts`
is the model: it tests **both** the core-only harness and the
plugin-loaded harness, because "a regression that only appears when the opt-in
bundle is absent — or only when it is present — is exactly the kind a
single-configuration suite misses."

### 4.4 Accessibility obligations

For toolbar items, the toolbar handles most of this if you fill the spec in
correctly. What you must get right:

- **The accessible name is `label`, and it stays constant.** The toolbar sets
  `aria-label` from it once and never rewrites it. The platform announces
  pressed state; a name that also encodes state is announced twice.
- **`kind: 'toggle'` gets `aria-pressed`; `kind: 'action'` does not.** Marking
  Undo as "pressed" is meaningless and screen readers say so. Block structure
  counts as a toggle — core registers blockquote and the lists that way, because
  "a screen reader user cannot tell whether they are inside a list without moving
  the caret and inferring it".
- **Disabled is `aria-disabled`, never the `disabled` attribute.** This is not a
  style preference. The toolbar is one tab stop with a roving tabindex, and a
  `disabled` button drops out of that roving set entirely — it becomes
  unreachable and therefore undiscoverable, so a screen reader user cannot learn
  the control exists. `Toolbar.update()` sets `aria-disabled` and
  `Toolbar.#invoke()` refuses to run a control it has marked disabled. If you
  ever build a custom control, carry both halves of that.
- **Do not add tab stops.** The whole bar is deliberately one stop. The block-type
  `<select>` is a second, and getting there took the review written up in
  `docs/toolbar-design-review.md` §1 — a native `<select>` and a roving tabindex
  have an unresolvable fight over Left/Right.
- **Icons are decorative.** `iconElement` sets `aria-hidden="true"` and
  `focusable="false"`; the button carries the name. Do not label the icon.

For nodes, there is less machinery and more judgement:

- **Whatever `toDOM` returns is the accessibility tree.** Use real semantic
  elements. A `div` with a role bolted on is worse than the element that already
  means that thing.
- **An atom node has no interior caret position.** If your node is `atom: true`,
  the only ways in are selection and deletion. That is correct for genuinely
  opaque content and wrong for anything an author needs to write in.
- **Nothing announces a node type today.** There is no per-node live-region
  mechanism; the toolbar's live region announces mark and block *transitions*
  only, gated on `docChanged || storedMarksSet`. If your node needs to announce
  itself, that is new work, and per `CONTRIBUTING.md` it owes real screen reader
  testing — "we do not accept axe-core passing as evidence of accessibility".
- **Learn from the caption bug.** `<caption>` used to be dropped from tables.
  It is now preserved as furniture on the table node and editable through the
  table plugin's caption dialog. It is still not a child node, because
  `prosemirror-tables` derives its cell map from `table.childCount`. If your
  node has an accessible-name-bearing child, model it or say plainly that you
  did not.

### 4.5 The bundle budget

Every bundle carries a budget in `BUDGETS_KB` in `scripts/bundle-budgets.mjs`,
and the gate fails on the first one over. Gzipped, measured against budget:

```
openleaf.min.js            117.3 / 121
openleaf-import-docx.min.js 123.8 / 140
openleaf-tables.min.js       18.1 /  25
openleaf-session.min.js       9.2 /  10
openleaf-highlight.min.js     6.7 /  15
openleaf-insert.min.js        6.6 /  20
openleaf-colour.min.js        5.4 /  15
openleaf-import.min.js        3.3 /  12
```

Run `node scripts/bundle-budgets.mjs` for the current numbers rather than
trusting the ones above; that command is the gate, so its output cannot be
stale.

Assume the core headroom is zero. Read its history as the cautionary tale it is:
the budget started at 90, went to 92 when alignment, colour and image upload
cost 3.1 KB between them — the colour *picker* having already moved out to its
own bundle — then again for table captions and cell style, then again for editor
chrome, then to 110 for typography. Every one of those raises had the same
justification, which is the same one in [1.2](#12-in-core-or-in-your-plugin):
the markup is in content people already have, so core has to read it or it
degrades to an uneditable atom. That argument is real and it is also the argument
every proposal makes, so it is the one to check hardest against your own feature.

`openleaf-import-docx` is larger than the entire editor. That is exactly why it
is a separate file, and it is the model for anything with a heavy dependency:
the cost lands only on the deployments that asked for it.

- **Icons go through `registerIcons`, from your own bundle.** Eleven table icons
  are about a kilobyte, and `icons.ts` keeps `PATHS` mutable specifically so a
  deployment with tables switched off does not download them. Do not add an icon
  to core's `PATHS`.
- **Commands, node views, input rules and toolbar items belong in the plugin
  bundle.** The split that matters is the tables one: schema in core because
  content already contains it, machinery in the plugin because that is where the
  weight is.
- **`node demo/build.mjs --sizes` attributes bytes per package.** Use it before
  and after. An aggregate gate tells you the bundle no longer fits but not which
  feature spent the budget, so the blame lands on whatever shipped last.
- **Add your own budget when you add your build step.** A bundle with no entry
  in `BUDGETS_KB` is not measured, and an opt-in bundle that grows without limit
  defeats the point of making it opt-in. Set the number close to what you
  actually measure — a generous budget is not a budget.

### 4.6 Keyboard bindings cannot shadow core bindings

`buildKeymap(custom)` accepts overrides, but `<openleaf-editor>` calls it with no
arguments, so that parameter is not reachable from a plugin. Your route is a
`keymap()` plugin via `registerEditorPlugin` — and registered plugins are
appended **last**:

```ts
plugins: [
  history(),
  keymap({ 'Alt-F10': … }),
  keymap(buildKeymap()),
  keymap(baseKeymap),
  ...createRegisteredPlugins(schema),
]
```

ProseMirror consults handlers in plugin order and the first one to return `true`
wins, so a plugin binding for a key that `buildKeymap()` or `baseKeymap` already
claims will never fire. Pick a free chord.

**Do not bind Tab.** `keymap.ts` is explicit and the reasoning is not
negotiable: capturing Tab inside a `contenteditable` removes the only way a
keyboard user has to leave the editor, which is a WCAG 2.1.2 keyboard-trap
failure — "for the institutional users who most need a free editor, that is a
procurement blocker rather than a rough edge". Core uses `Mod-[` and `Mod-]` for
indentation instead.

### 4.7 CSS goes through `registerStyles`, from your own bundle

`packages/ui/src/styles.ts` exports `CSS` as a single template literal and
`ensureStyles(doc)` adopts it once per document via `adoptedStyleSheets`.
`registerStyles(css, doc?)` is the same path for a plugin's own rules, and it is
what `@openleaf-editor/plugins-colour` uses for the picker's popover and swatch
grid. There is deliberately no `<style>` injection fallback, because it is blocked
by exactly the strict-CSP configurations that would need it and it fails silently;
`registerStyles` returns `'adopted' | 'unavailable' | 'already'` so you can tell
which happened.

Put your rules in your own bundle, not in core's `CSS`. Table styles are in core
for a reason that is specific to them and stated in the comment there — "these
styles live in core, not in the opt-in table plugin, because table NODES live in
core" — and it does not generalise: anything else spends the core bundle budget on
behalf of deployments that never load your plugin.

Two things to get right in the CSS itself, both of which the colour picker has to:

- **Namespace under `.ol-`, and theme through the tokens with fallbacks.** A host
  that themes the editor themes your control with it; one that does not still gets
  something legible.
- **Handle `forced-colors: active`.** It paints over `background-color`, so a
  control whose only signal is a colour conveys nothing there. The swatches survive
  it because every one of them also has a name.

If your node can render acceptably with the host site's own typography, prefer
adding nothing. The content area has no Shadow DOM precisely so that host styles
apply — that is the whole reason the editor is WYSIWYG against a real theme.

### 4.8 `setItemState` is per editor, not global

`setItemState` lives on the `Toolbar` instance, and there is one per
`<openleaf-editor>`. There is no broadcast. To push state a predicate cannot
derive — an upload in flight, a lock held by another user — you have to reach
each element:

```ts
for (const el of document.querySelectorAll('openleaf-editor')) {
  el.toolbarInstance?.setItemState('callout', { enabled: false })
}
```

No cast. `@openleaf-editor/element` augments `HTMLElementTagNameMap`, so
`querySelectorAll('openleaf-editor')` yields `OpenLeafEditor` and every member is
typed. This used to read
`(el as HTMLElement & { toolbar?: { setItemState(id: string, s: object): void } })`
— a *weaker* structural type, hand-written here, for a member the class already
typed properly, because there was no augmentation anywhere in the repository.

The accessor is `toolbarInstance` rather than `toolbar`. `toolbar` is the
attribute-reflecting property, as it is on any custom element: `el.toolbar =
'bold italic'` sets the layout. It could not be both, and it being the `Toolbar`
object was a silent no-op in every framework binding — see the note in
`packages/element/src/index.ts`.

Prefer `isActive` / `isEnabled` wherever the answer is derivable from the
document and the selection. Reach for `setItemState` only when it genuinely is
not, which is the case the escape hatch was added for.

### 4.9 Custom controls own their own DOM, and their own cleanup

`type: 'custom'` with a `render(ctx)` function is how a control that is not a
button gets built. `@openleaf-editor/plugins-colour` is the worked example.

```ts
registerToolbarItem({
  id: 'textColour',
  type: 'custom',
  label: 'Text colour',
  render: ({ view, host }) => ({
    el,                        // goes in the toolbar
    focusable: mySelect,       // optional: focus target, if it is not a button
    update: (state) => { … },  // every transaction, guarded like a predicate
    destroy: () => { … },      // remove anything you put in the document
  }),
})
```

Four constraints, each of which cost something to learn:

- **Exactly one focusable element in what you return, and say which it is.** A
  button-like control puts a single `button.ol-btn` in the element it returns, and
  the toolbar's roving tabindex walks it. A control whose focus target is not a
  toolbar button -- a native `<select>`, say, which is how the built-in block-type
  control is built -- returns that element as `focusable` on the `ToolbarControl`
  instead. Two focusable elements makes the bar two tab stops where the author
  expects one; none, or one the toolbar cannot find, makes your control
  unreachable by keyboard.
- **Anything else lives outside the toolbar element.** The picker appends its grid
  to the host and uses `popover="manual"` for the top layer. Left inside the
  toolbar, its thirty-two swatch buttons would be found by that same query, and one
  tab stop becomes thirty-three.
- **`preventDefault` on `mousedown` for every control that runs a command.** Without
  it the editor blurs, the selection collapses, and the command applies to nothing.
  This is engine-dependent, which is what makes it dangerous: the colour picker
  worked in Chromium with this missing and silently did nothing in WebKit.
- **`destroy` is called before every re-render, not only on teardown.** A registry
  change re-renders the toolbar, and a popover you attached to the document
  survives `replaceChildren` — so without cleanup a late-loading plugin leaves an
  orphaned popover on the page with no trigger attached to it.

`render` and `update` are both guarded: a throw costs your control and is logged
once, and the rest of the toolbar keeps working. Do not rely on that — it is there
so a bug in a colour picker cannot take Undo and Save down with it.

### 4.10 Every string you ship is a translatable string

`@openleaf-editor/ui` has an i18n layer, and a plugin that ignores it ships
labels that cannot be translated by anyone. The design is deliberately low
ceremony, so there is very little to do — but it is not nothing.

**English source text is the lookup key.** There is no message-id indirection
and no catalog to bump before a button can ship: a missing translation falls
back to the string itself, so a new control always shows something an author can
read.

**Toolbar labels are translated for you.** `Toolbar` calls `t(spec.label)` when
it renders, so pass the plain English string and do *not* call `t()` yourself at
registration time:

```ts
registerToolbarItem({
  id: 'callout',
  label: 'Callout',        // right: translated at render, per editor
  // label: t('Callout'),  // wrong: resolved once, at module load
})
```

The distinction matters because each editor carries its own `lang`. The toolbar
renders inside `withLocale(editorLang, …)`, so two editors with different
languages on one page each get their own labels. A string resolved at
registration is resolved once, in whatever locale happened to be current, and
both editors get that one.

**Everything you build yourself, you translate yourself.** Dialog text, menu
entries, live-region announcements, error messages — anything that does not go
through a toolbar `label` — needs an explicit `t()`:

```ts
import { t } from '@openleaf-editor/ui'

throw new Error(t('That file is too large.'))
```

`promptFields` and the other `ui` dialog helpers translate the specs you hand
them, so field labels and button text are already covered.

**Ship your catalogs, and let hosts override them.**
`registerTranslations(locale, messages)` overlays a locale and last registration
wins, which is how an integrator replaces one phrase without forking your
catalog. Register from your `install…()` function so a host that loads your
plugin gets the translations with it:

```ts
registerTranslations('fr', { Callout: 'Encadré' })
```

Registration notifies listeners, so a catalog registered after the editors were
built — the ordinary case for a script tag — still reaches them.

**What not to do.** Do not concatenate. `t('Deleted ') + n + t(' rows')` is
untranslatable into any language whose word order differs from English, which is
most of them. Build the whole sentence as one key and interpolate with `fill`:

```ts
import { fill, t } from '@openleaf-editor/ui'

fill(t('{count} rows deleted'), { count: String(n) })
```

`fill` only reads own properties of the values object, so a `{constructor}`
placeholder in a catalog is left alone rather than stringifying the Object
constructor.

### 4.11 Isolating nodes clamp the selection at their boundary

`isolating: true` on a node spec is a join/lift contract. It is not, by itself,
a selection contract. `TextSelection.between` will still build a range whose
endpoints sit on opposite sides of that node, and Firefox and WebKit will
report one from Shift+Arrow. Core installs `isolatingSelectionPlugin` in the
element so that range is narrowed to the anchor's side before the next replace
— the same clamp Chromium already does natively.

If you add an isolating node, you do **not** need to reimplement that clamp.
You do need the plugin if you embed ProseMirror yourself rather than using
`<openleaf-editor>`: without it, a selection that starts in a `blockquote`
(which can contain `group: 'block'`) and ends inside your node will throw
`TransformError` on the next keystroke, and the recovery is a DOM-derived
document with no undo entry. See GitHub issue #130.

Mark a node isolating when joining across it is illegal (`details`, `figure`,
table cells). Do not use it as a substitute for `group` restrictions.

---

## 5. Checklist before you submit

**Schema**

- [ ] `parseDOM` and `toDOM` are mutually inverse. Every attribute `parseDOM`
      reads, `toDOM` writes back, including the ones you did not design for.
- [ ] No explicit `priority`, or one strictly between 2 and 99 with a comment
      saying which rule it is disambiguating against.
- [ ] Your tag is not on the `NEVER_PRESERVE` list in `preserve.ts`.
- [ ] Any URL-bearing attribute is checked with `isSafeUrl`, and `getAttrs`
      returns `false` when the check fails, the way `image` and `link` do.
- [ ] Commands resolve node and mark types from `state.schema`, never from a
      captured schema instance, and decline with `false` when a type is absent
      rather than throwing.
- [ ] Any normalization pass you add over the editor's DOM or its serialized
      output skips subtrees where `isInsidePreserved()` is true.
- [ ] `registerSchemaExtension` is called from the eagerly-imported half of your
      package, not from behind a lazy `import()`.
- [ ] Your extension `id` is namespaced, and you have decided whether any name
      clash should `replace` or throw.
- [ ] If the node ships in core's base schema instead, the new export and the
      new node name are both declared in `packages/core/test/public-api.test.ts`.

**Fidelity**

- [ ] A fixture in `packages/core/test/fixtures/stored/`, taken from real
      content where possible, carrying the messy attributes real content has.
- [ ] A second fixture crossing your feature with the preservation layer —
      your markup nested inside an unrecognised wrapper, and an unrecognised
      wrapper nested inside your markup.
- [ ] `pnpm test` reports it stable, text-preserving, and `0` attrs lost.
- [ ] Nothing was added to `ALLOWED`.
- [ ] A `nodeTypes()` assertion proving the markup parses to your node and
      **not** to `unknown_block` or `unknown_inline`. The HTML round-trip test
      passes either way; only this one catches the silent fallback.
- [ ] A Playwright spec covering both the core-only harness and the
      plugin-loaded harness.

**Sanitization**

- [ ] A base-schema node: `DEFAULT_POLICY` allows every element and attribute
      your `toDOM` can emit, and `SCHEMA_NATIVE` in
      `packages/sanitize/test/agreement.test.ts` has an entry exercising it,
      awkward attributes included, over which the sanitizer is a no-op.
- [ ] A schema extension: you export a policy fragment as data, and your own
      tests round-trip through
      `policyForPreserved(DEFAULT_POLICY, YOUR_FRAGMENT)` so drift from your
      `toDOM` is a test failure rather than stripped content.
- [ ] Nothing you model is named `on*`, `srcdoc`, `formaction`, `ping` or
      `xlink:href` — `sanitizeHtml` drops those whatever the policy says.
- [ ] If you also depend on preserved markup, your README documents the exact
      `policyForPreserved()` call your users need.
- [ ] You have confirmed none of your elements are on `dropWithContent`.
- [ ] If you ship a server-side integration, its config is generated from that
      extended policy, not hand-written.

**Toolbar and accessibility**

- [ ] `label` is a constant accessible name with no state in it.
- [ ] `kind` is `toggle` only where `aria-pressed` is meaningful, and `isActive`
      is supplied when it is.
- [ ] `isEnabled` is omitted where the command's own no-dispatch answer is
      correct, and supplied where it is not.
- [ ] Nothing you added uses the `disabled` attribute.
- [ ] You added no new tab stops.
- [ ] Icons are a single stroked path in a 24x24 viewBox, registered via
      `registerIcons`, and contain no letterforms.
- [ ] You did not bind Tab.
- [ ] A screen reader has been run over the new control, and the pull request
      names which one and which version. `CONTRIBUTING.md` requires this and
      does not accept axe-core as a substitute.

**Packaging**

- [ ] `install…()` is idempotent behind a module-level flag.
- [ ] `registerEditorPlugin` is given a factory, and is not called at all if the
      plugin contributes no ProseMirror plugins.
- [ ] Icons and machinery are in the plugin bundle. Only a node spec that
      belongs in the *base* schema is in core -- see section 1.2.
- [ ] `node scripts/bundle-budgets.mjs` passes, your bundle has its own entry in
      `BUDGETS_KB`, and you know how much of any core delta is yours.
- [ ] Every user-visible string goes through `t()` or a toolbar `label`, and
      your catalogs are registered from `install...()`.
- [ ] `demo/build.mjs` reads no `dist/`.
- [ ] Commits are Conventional and signed off with `git commit -s`.
- [ ] `pnpm verify` passes — typecheck, unit and fidelity, three browser
      engines, and the size gate.

---

## 6. Known gaps

Not open questions -- things this document would rather be able to tell you and
cannot. Each is a real limitation you may hit.

1. **A supported script-tag plugin path.** The rewriting that lets a second
   script tag share the first one's runtime is done by `shareRuntime()` in
   `demo/build.mjs`, a private build helper in this repository. `__runtime` is
   documented in `global.ts` as explicitly not public API. A third party
   shipping a script-tag plugin today has to copy that esbuild plugin and depend
   on an interface carrying no compatibility promise. Prefer the ESM model until
   a published build helper or a versioned `__runtime` contract exists.
2. **No `<style>` fallback for CSS.** `registerStyles` uses `adoptedStyleSheets`
   only. That is deliberate — a `<style>` fallback is blocked by exactly the
   strict-CSP configurations that would need it, and fails silently — but it
   means a browser without `adoptedStyleSheets` gets `'unavailable'` and no
   styles. See [4.7](#47-css-goes-through-registerstyles-from-your-own-bundle).
3. **Directional icons.** The `DIRECTIONAL` set is private to `icons.ts`, so a
   plugin icon cannot opt into RTL mirroring.
4. **Keyboard bindings cannot shadow core bindings.** See
   [4.6](#46-keyboard-bindings-cannot-shadow-core-bindings).
5. **Nothing announces a node type to a screen reader.** There is no per-node
   live-region mechanism; the toolbar's live region announces mark and block
   transitions only. If your node needs to announce itself, that is new work.

---

## 7. If this document is wrong

It has been wrong before, and the way it went wrong is worth knowing about,
because it is the failure mode of every document like this.

`registerSchemaExtension` landed four commits after this file was first written.
The file was edited five times afterwards and none of those edits noticed, so
for fifty-odd commits it told plugin authors that the single thing they most
wanted to do was impossible -- while the feature sat exported in the barrel. It
also prescribed importing a `PRESERVED_MARKER` constant that has never existed
in any commit, and warned that `DEFAULT_POLICY` did not allow tables and would
lose every table on save, at a time when it allowed the full table set. A false
data-loss warning is worse than no warning, in a project whose governance ranks
silent content loss above security defects.

So: **the code is the authority, this file is a convenience.** If they disagree,
the code is right and this file is a bug. Please report it as one. Every
mechanism named here is exported from `@openleaf-editor/core` or
`@openleaf-editor/ui` and is checkable in `dist/index.d.ts` in about ten seconds,
which is a good habit to have before building on any sentence below.
