# `@openleaf-editor/plugins-insert`

Insert and structure tools for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): media embeds, collapsible sections, named anchors, a character map, emoji, date and time, page breaks, snippets, and drag-resize handles for images and video.

The matching **schema nodes live in `@openleaf-editor/core`**, so stored `<video>`, `<iframe>`, `<details>` and `<figure>` round-trip whether or not this package is loaded. This bundle is the editing chrome.

The **Anchor** control inserts an empty named destination (`<a id="…"></a>`), the TinyMCE-style jump target. That is a modelled atom, including pretty-printed whitespace-only interiors. An `<a id>` that *wraps* text — `<h2><a id="sec">Title</a></h2>` — is not that atom: core parses it as a `link` mark with `id` and no `href`, so the heading stays editable and the id round-trips. `<a id href>` is an ordinary link. `<a name>` is unmatched and preserved.

Iframes are stored only when their `src` is an `https:` URL on a known player host (`youtube.com/embed`, `player.vimeo.com/video`, and the rest of the allowlist). Arbitrary iframes are still dropped.

A `<video>` renders as an inert preview in the editor — no control bar, and no pointer events — because native media chrome takes those events for itself, and in Firefox it takes them for the whole element: nothing in the editor would ever see the click, so ProseMirror would never select the node and the player could be inserted once and never edited again. Selecting a video puts a play button of this package's own over the frame; pressing it hands that one element its controls and its pointer events back for as long as it stays selected, and moving the selection away or pressing Escape returns it to a preview. Stored HTML is serialized from the node rather than from the editing DOM, so `controls` round-trips untouched in every state and the player is fully interactive on the published page. A caption track the author turned on stays on across a resize: the `<source>` and `<track>` children are rebuilt only when the stored markup changes, since a fresh `<track>` element means a fresh `TextTrack` with its `mode` back at `disabled`.

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
npm install @openleaf-editor/element@beta @openleaf-editor/plugins-insert@beta
```

```ts
import '@openleaf-editor/element'
import { installInsertTools } from '@openleaf-editor/plugins-insert'

installInsertTools({
  snippets: [{ id: 'byline', title: 'Byline', html: '<p><em>Staff writer</em></p>' }],
})
```

Installing does **not** rearrange the toolbar. Name the items you want:

```html
<openleaf-editor
  toolbar="bold italic | link image media details | charmap emoji datetime pagebreak nbsp | source"
></openleaf-editor>
```

## Shared file picker and lists

```ts
import {
  registerFilePicker,
  registerLinkList,
  registerImageList,
  registerImageClasses,
} from '@openleaf-editor/element'

registerFilePicker(async ({ kind }) => {
  const url = await openCmsLibrary(kind)
  return url ? { url } : null
})

registerLinkList([
  { title: 'Home', value: '/' },
  { title: 'About', value: '/about' },
])

registerImageList([{ title: 'Hero', value: '/media/hero.jpg' }])
registerImageClasses(['align-left', 'full-width'])
```

## Toolbar item ids

| Id | Control |
| --- | --- |
| `media` | Insert media (video, audio, allowlisted embed) — or edit the selected player |
| `details` | Collapsible section |
| `anchor` | Named anchor |
| `charmap` | Character map |
| `emoji` | Emoji picker |
| `datetime` | Insert date and time |
| `pagebreak` | Page break |
| `nbsp` | Non-breaking space |
| `snippet` | Snippet |

Name the ones you want in the element's `toolbar` attribute. An id nothing has
registered logs a warning rather than being skipped silently.

## Character map and emoji

Both pickers are the same control: a toolbar trigger and a grid of named glyphs.
Arrow keys move by one and by a row, Home and End go to the ends of a row,
Escape closes and returns focus to the trigger, and Tab leaves the widget
(there is one tab stop inside the grid). The grid is `role="grid"` with row and
gridcell structure, matching the colour picker, so a screen reader can say
which cell the author is on.

