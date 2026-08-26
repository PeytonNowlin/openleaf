# `@openleaf-editor/plugins-session`

Finding, counting, and recovery for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): find and replace, word count, autosave and restore, an unsaved-change warning, save, print, preview, and new document.

This is a **beta** (`0.1.0-beta.2`). Keep every `@openleaf-editor/*` package on the
same version.

None of this is in the core bundle. It is authoring chrome, not document
structure, and it is opt-in so a comment box does not download a find bar.

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
npm install @openleaf-editor/element@beta @openleaf-editor/plugins-session@beta
```

```ts
import '@openleaf-editor/element'
import { installSessionTools } from '@openleaf-editor/plugins-session'

installSessionTools()
```

Or as a second script tag, in this order:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-session.min.js"></script>
```

## Toolbar items

Installing does **not** rearrange your toolbar. Name the items you want:

```html
<openleaf-editor
  for="body"
  toolbar="undo redo | bold italic | find wordCount save preview print newDocument | source"
></openleaf-editor>
```

| Id | What it does |
| --- | --- |
| `find` | Opens the find and replace bar (`Mod-F`). Next and previous are `Mod-G` / `Shift-Mod-G`. |
| `wordCount` | Opens a dialog with words, characters, and paragraphs. A status line under the editor shows the word count continuously, without announcing it on every keystroke. |
| `save` | Submits the bound form, or calls `registerSaveHandler`, or fires a cancelable `openleaf:save` event (`Mod-S`). |
| `preview` | A read-only, published-looking view of the current HTML in a sandboxed iframe. The frame loads the editor's `content-css` (unscoped, as the published page does), copies the canvas `dir` / `lang` and the active skin's tokens, and does not invent table borders. Per-block `dir` in the document is left intact. |
| `print` | Prints the current document with the same `content-css` and direction. A dark skin is not printed as a dark page — light skins still apply. Page breaks (`hr.ol-pagebreak`) are honoured. |
| `newDocument` | Clears the editor, after confirming if there are unsaved changes. |

## Autosave, restore, and leaving

Once the plugin is loaded, every editor on the page:

- Writes a draft to `localStorage` (debounced) keyed by the page path, the query string, and the bound textarea id. The query string is part of the key so `/admin/edit?id=1` and `?id=2` are separate drafts; set a `draft-key` attribute on the editor to choose the key yourself.
- Offers to restore that draft on load when it differs from the HTML the textarea carried.
- Deletes drafts older than seven days, sweeping the stored keys when an editor starts.
- Warns before the tab closes if the document differs from the last save (form submit or a successful Save action).

```ts
installSessionTools({
  autosave: true,
  warnBeforeLeave: true,
  restore: true,
  debounceMs: 800,
})
```

Set `restore: false` if the server is the only source of truth and a browser draft would be surprising.

A draft is the whole document, held in plaintext in `localStorage`. Any script on the origin can read it, as can anyone with the machine, and nothing here encrypts it. On a shared or kiosk machine, or for a document whose content is itself sensitive, turn `autosave` off rather than relying on the seven-day expiry.

## Save as a callback

The default Save action submits the nearest form (the one that owns the bound textarea). To persist some other way:

```ts
import { registerSaveHandler } from '@openleaf-editor/plugins-session'

registerSaveHandler(async (html, host) => {
  await fetch('/save', { method: 'POST', body: html })
})
```

Or listen and cancel the default:

```ts
editor.addEventListener('openleaf:save', (event) => {
  event.preventDefault()
  const html = event.detail.html
})
```

From a script tag, `OpenLeaf.registerSaveHandler(fn)` is available after the session bundle loads.

## Accessibility and CSP

The find bar is outside the toolbar, so the toolbar stays one tab stop. Escape closes the bar and returns focus to the document. Match highlights use a class, not a colour-only signal, and have a `forced-colors` outline.

Styles are a constructable stylesheet. On a browser without `adoptedStyleSheets`, link the file:

```html
<link rel="stylesheet" href=".../@openleaf-editor/plugins-session/openleaf-session.css">
```
