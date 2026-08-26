# `<openleaf-editor>` API reference

The custom element's public surface: attributes, properties, events, and the
functions the package exports. Written because it did not exist —
`openleaf:change` is load-bearing for all three framework wrappers and was named
in no document outside one sentence in a wrapper README.

Everything here is checkable against `packages/element/src/index.ts`. If the two
disagree, the code is right and this file is a bug.

---

## Defining the element

Importing the package defines `<openleaf-editor>` for you:

```ts
import '@openleaf-editor/element'
```

`defineOpenLeafEditor(tag = 'openleaf-editor')` registers the same class under a
different tag name. It is idempotent — a no-op if the tag is already registered,
and a no-op when `customElements` is undefined, so importing the module during
SSR does not throw.

---

## Attributes

### Observed — changing these after the editor is built takes effect

| Attribute | Values | Effect |
| --- | --- | --- |
| `for` | a textarea's `id` | Binds to that textarea. Rebinding only happens once the view exists. |
| `readonly` | present / absent | Renders but does not allow editing. Mirrors onto the source textarea, and covers the context menus, the media resize handle, and clicking a `<summary>` as well as typing, paste and drop. |
| `skin` | `midnight`, `paper`, `contrast`, `compact` | Named appearance. |
| `theme` | `light`, `dark`, `auto` | Anything that is not `light` or `dark` is treated as `auto`, which follows the visitor's system setting. |
| `lang` | a BCP-47 tag | UI locale, matched against `registerTranslations()`. Relabels the **toolbars only** — not the menubar, floating toolbars or context menu. |

### Read once, when the editor is built

Changing any of these later has no effect without recreating the element.

| Attribute | Values | Effect |
| --- | --- | --- |
| `toolbar` | space-separated item ids, `\|` for a separator, `none` to omit | The main toolbar's layout. An unregistered id logs a warning rather than being skipped silently. |
| `toolbar2` | same grammar | A second toolbar. |
| `menubar` | space-separated menu ids, or `none` | Omit the attribute to hide it. |
| `contextmenu` | `none` to disable | Default is the link, image and table menus. |
| `selection-toolbar` | `none` to disable | Floating bar for a non-empty selection. Shown only while the view is focused, the editor is editable, and the selection covers some unlocked content. A range entirely inside a locked node hides it; Select All over a document that merely contains one does not. A drag-select still shows it: some engines have not focused the view yet while the range is being established. |
| `insert-toolbar` | `none` to disable | Floating bar for an empty block. Same visibility rule as `selection-toolbar`, including on mount of a new empty editor. |
| `formats` | `p.lead=Lead\|h2=Section` | Entries for the formats dropdown. |
| `content-css` | comma-separated URLs | Stylesheets scoped onto the canvas. **Trusted configuration** — the URL is fetched and adopted document-wide with no origin check, so it must never be attacker-controlled. |
| `inline` | present / absent | Hide chrome until the editor is focused. |
| `autoresize` | present / absent | Grow the canvas with the document. |
| `toolbar-overflow` | present / absent | Collapse overflowing groups into a More menu. |
| `autolink` | `false` to disable | URLs become links on space, Enter, or the end of an IME composition; nothing is marked while a composition is still open. The mark covers the URL after trailing prose punctuation is stripped, so a full stop or a wrapping `]` is not part of the href. Any value other than exactly `"false"` enables it. |
| `visualaids` | `false` to disable | Guides for invisible structure. Same `"false"`-exactly rule. At runtime the `openleaf:toggle-visual-aids` event toggles the *styling* only; whether the plugin is loaded is decided at build. |
| `aria-label` | string | Accessible name for the editable region. |

---

## Properties

| Property | Type | Notes |
| --- | --- | --- |
| `value` | `string` | Get/set. See below. |
| `view` | `EditorView \| null` | The live ProseMirror view. `null` before the editor is built and after it disconnects. |
| `schema` | `Schema` | The schema this editor was built with. Fixed for the instance's lifetime — see the timing rule in [authoring-plugins.md §1.1](authoring-plugins.md#11-schema-extensions). |
| `toolbar` | `Toolbar \| null` | The primary toolbar. `null` when `toolbar="none"`, or before the build. There is no getter for `toolbar2`. |
| `sourceMode` | `boolean` | True while the HTML source textarea is showing. |

### `value`

**Getting** returns the raw textarea contents while in source mode; the bound
textarea's value if the editor has not been built yet; otherwise the serialized
document.

**Setting** replaces the document's content through an ordinary transaction. Two
consequences follow, and both are deliberate:

- It **does not reset undo history.** The replacement is itself undoable. If you
  are loading a genuinely new document rather than editing this one, recreate
  the element.
- It **fires `openleaf:change`**, because the document changed. Guard against
  loops if you are also listening to that event to drive the assignment — every
  framework wrapper in this repository does exactly that, and the pattern to
  copy is in `packages/react/src/index.ts`.

In source mode, setting writes into the source textarea and syncs the bound
textarea; no transaction and no event.

---

## Events

All bubble. `openleaf:change` is composed, so delegated listeners on `document`
or `window` also receive it from an editor inside a shadow root. The source-view
events are not composed and remain inside one.

### Dispatched by the element

| Event | `detail` | Cancelable | When |
| --- | --- | --- | --- |
| `openleaf:change` | `{ value: string }` | No | After any transaction where `docChanged` is true. `value` is a lazy getter for the current HTML, so listeners that do not read it avoid serialization work. The bound textarea may still be waiting for its short deferred sync. |
| `openleaf:source-open` | `{ textarea }` | No | When source view opens, before the textarea is focused. |
| `openleaf:source-close` | `{ textarea }` | No | When source view closes, before the textarea is removed and before any write-back. Also fires on disconnect. |

`openleaf:change` is the one every integration needs: it is what the React, Vue
and Angular wrappers listen to, and what you would listen to yourself.

```js
editor.addEventListener('openleaf:change', (event) => {
  console.log(event.detail.value)
})
```

### Dispatched by `@openleaf-editor/plugins-session`

| Event | `detail` | Cancelable | When |
| --- | --- | --- | --- |
| `openleaf:save` | `{ html }` | **Yes** | The `save` toolbar control was used. |

`openleaf:save` is cancelable, and cancelling it is the contract. Call
`preventDefault()` to say you have taken ownership of persistence — the plugin
then treats the document as saved, drops the recovery draft and clears the
unsaved-changes warning:

```js
editor.addEventListener('openleaf:save', async (event) => {
  event.preventDefault()
  await fetch('/api/post', { method: 'POST', body: event.detail.html })
})
```

Nothing awaits your listener, so if the request fails, telling the user is your
job. If you do not cancel it, the plugin falls back to a registered save handler
and then to submitting the bound form.

### Listened for by the element

You can dispatch these yourself to drive the editor programmatically. All are
`CustomEvent`s with `bubbles: true` and no detail.

| Event | Effect |
| --- | --- |
| `openleaf:toggle-source` | Opens or closes the HTML source view. |
| `openleaf:toggle-fullscreen` | Requests or exits fullscreen, falling back to a CSS class if the browser refuses. |
| `openleaf:toggle-visual-aids` | Toggles the visual-aid styling. |

---

## Textarea binding

`for="some-textarea-id"` binds the editor to a textarea so an existing form post
keeps working untouched — the server reading `$_POST['body']` needs no change. A
`<textarea>` nested inside the element is used automatically, lifted out during
the build and re-appended hidden so it still posts.

After a document change, the textarea is marked dirty and written within a short
delay rather than re-serializing a large document on every keystroke. It is
flushed synchronously when the form is submitted, on `formdata`, at the end of
the build, and on disconnect — that last one so HTML left in an open source box
is not lost. A form `reset` goes the other way, writing the textarea's restored
value back into the editor. Code that needs current HTML immediately should read
`openleaf:change`'s `event.detail.value`, not poll the textarea.

Note that only the textarea's `.value` is assigned. No `input` or `change` event
is fired on it, so a listener on the textarea will not see the editor's edits.
Listen to `openleaf:change` on the element instead.

---

## Re-exported functions

These come from `@openleaf-editor/ui` and `@openleaf-editor/paste` but are
re-exported here, so a `<script>` integration reaches them on `window.OpenLeaf`
with no build step and no second install.

| Function | Purpose |
| --- | --- |
| `registerToolbarItem(spec)` | Add or replace a toolbar control. |
| `registerIcons(paths)` | Register icon paths for your controls. |
| `registerStyles(css)` | Adopt a stylesheet for your controls. |
| `t(source)` | Translate a string. Missing keys, and names that only exist on `Object.prototype` (`constructor`, `toString`, …), fall back to `source`. See [authoring-plugins.md §4.10](authoring-plugins.md#410-every-string-you-ship-is-a-translatable-string). |
| `fill(template, values)` | Replace `{name}` placeholders from own properties of `values`. |
| `registerTranslations(locale, messages)` | Overlay a locale catalog. |
| `setUiLocale(locale)` | Set the document-wide UI locale. |
| `registerImageUploader(fn)` | Handle image uploads. `element.imageUploader` overrides it for one editor. JPEG (including `.jfif`), PNG, GIF, WebP and AVIF; HEIC/HEIF is refused, not converted. |
| `registerFilePicker(fn)` | Supply a file browser for link and image dialogs. The link dialog (`promptForLink`) keeps `rel` and `id` on Save: window-safety tokens are merged, author tokens are not replaced. |
| `registerLinkList(items)` / `registerImageList(items)` | Preset lists for those dialogs. |
| `registerImageClasses(items)` | Preset classes offered in the image dialog. The dialog prefills from a selected image (`promptForImage({ existing })`) and the `image` item updates in place via `updateImage`. |
| `normalizePastedHtml(html)` | Word/Google Docs paste cleanup, usable outside the editor. |

---

## What this element does not have

Stated so you do not go looking:

- **No public methods.** There is no `focus()`, `destroy()`, `save()`, or
  `setContent()`. Use `value`, the events above, and `view` for anything
  ProseMirror-level.
- **No Shadow DOM on the content area.** That is deliberate: host typography
  applies, which is the whole reason the editor is WYSIWYG against a real theme.
- **No `openleaf:save` from the element itself.** It comes only from
  `@openleaf-editor/plugins-session`.

---

## Related

- [`SECURITY.md`](../SECURITY.md) — sanitize on the server; the plugin trust
  model; a baseline CSP.
- [`authoring-plugins.md`](authoring-plugins.md) — writing a plugin or a schema
  extension.
