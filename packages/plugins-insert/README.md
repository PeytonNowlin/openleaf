# `@openleaf-editor/plugins-insert`

Insert and structure tools for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): media embeds, collapsible sections, named anchors, a character map, emoji, date and time, page breaks, snippets, and image resize handles.

The matching **schema nodes live in `@openleaf-editor/core`**, so stored `<video>`, `<iframe>`, `<details>` and `<figure>` round-trip whether or not this package is loaded. This bundle is the editing chrome.

Iframes are stored only when their `src` is an `https:` URL on a known player host (`youtube.com/embed`, `player.vimeo.com/video`, and the rest of the allowlist). Arbitrary iframes are still dropped.

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
