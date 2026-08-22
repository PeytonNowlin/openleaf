# `@openleaf-editor/plugins-insert`

Insert and structure tools for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): media embeds, collapsible sections, named anchors, a character map, emoji, date and time, page breaks, snippets, and drag-resize handles for images and video.

The matching **schema nodes live in `@openleaf-editor/core`**, so stored `<video>`, `<iframe>`, `<details>` and `<figure>` round-trip whether or not this package is loaded. This bundle is the editing chrome.

Iframes are stored only when their `src` is an `https:` URL on a known player host (`youtube.com/embed`, `player.vimeo.com/video`, and the rest of the allowlist). Arbitrary iframes are still dropped.

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
