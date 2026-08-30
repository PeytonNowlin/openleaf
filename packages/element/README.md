# `@openleaf-editor/element`

The `<openleaf-editor>` custom element: OpenLeaf's drop-in for CMS forms. HTML in, HTML out, syncs to a textarea.

This is a **beta** (`0.1.0-beta.2`). APIs may still change. It has not been
used in production, and it has not been driven by a real screen reader.

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
npm install @openleaf-editor/element@beta
```

```ts
import '@openleaf-editor/element'
```

```html
<form method="post">
  <label for="body">Post body</label>
  <openleaf-editor
    for="body"
    aria-label="Post body"
    placeholder="Write the article…"
  ></openleaf-editor>
  <textarea id="body" name="body" hidden></textarea>
  <button type="submit">Save</button>
</form>
```

`placeholder` is a prompt on an empty document. It is never stored in `value`
and never submitted. `lang` on the host (or, if the host has none, on the bound
textarea) is the canvas language used for spellcheck; `spellcheck="false"`
turns checking off. Code blocks and inline `<code>` are never checked either
way, as a view-only decoration that stored HTML does not carry; WebKit reads
`spellcheck` on the editing host rather than per element, so Safari is the
exception. A read-only editor does not follow links: it fires
`openleaf:link` with `{ href }` instead. Pasting a bare `https://…/hero.png`
inserts an image; a URL that does not look like an image keeps today's paste.

Optional plugins, each a separate package. Keep the `@beta` tag:

```bash
npm install @openleaf-editor/plugins-table@beta \
            @openleaf-editor/plugins-colour@beta \
            @openleaf-editor/plugins-highlight@beta \
            @openleaf-editor/plugins-import@beta \
            @openleaf-editor/plugins-import-docx@beta \
            @openleaf-editor/plugins-session@beta \
            @openleaf-editor/plugins-insert@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installColourPicker } from '@openleaf-editor/plugins-colour'
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'
import { installSessionTools } from '@openleaf-editor/plugins-session'
import { installInsertTools } from '@openleaf-editor/plugins-insert'

installTableEditing()
installColourPicker()
installSyntaxHighlighting()
installImport()
installDocxImport()
installSessionTools()
installInsertTools()
```

**Keep every `@openleaf-editor/*` package on the same version.** They pin each
other exactly, so mixing versions installs two copies of the schema and the
toolbar registry — and a table node built by one is not a node type the other
accepts.

## Alignment and image upload

Both are in this package; neither needs a plugin. Alignment is four toolbar items
(`alignLeft alignCenter alignRight alignJustify`) and `Mod+Shift+L/E/R/J`.

Image upload is a hook you point at your own endpoint. Register one and the image
dialog grows a file picker, and dropping or pasting an image file routes through
it. Register nothing and the dialog stays insert-by-URL — there is deliberately no
`data:` URL fallback, because the schema refuses `data:` URLs and content that
vanishes on save is worse than a missing picker. Pasting a bare `http(s)` URL
whose path ends in a well-known image suffix (`png`, `jpg`/`jpeg`/`jfif`, `gif`,
`webp`, `avif`) inserts an `<img>` through the same `isSafeUrl` / `insertImage`
checks, with or without an uploader. Other URLs keep today's paste.

```ts
import { registerImageUploader } from '@openleaf-editor/element'

registerImageUploader(async (file) => {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/admin/media', { method: 'POST', body })
  if (!res.ok) throw new Error('The server rejected the upload.')
  const { url, width, height } = await res.json()
  return { src: url, width, height }
})
```

Whatever that function throws is shown to the author verbatim, so write the
message for them. For one editor with its own endpoint, set
`element.imageUploader` instead. JPEG (including `.jfif`), PNG, GIF, WebP and
AVIF are accepted; HEIC/HEIF is refused with a message rather than converted.

## Sanitizing submitted HTML

Sanitize on the server — see the note at the top of this file for why.
`@openleaf-editor/sanitize` ships the same allowlist as data, including the
narrow `style` allowance that alignment and colour need.

With DOMPurify, this is the whole setup:

```js
import DOMPurify from 'dompurify'
import { configureDOMPurify, DEFAULT_POLICY } from '@openleaf-editor/sanitize'

const purify = DOMPurify(window)
const config = configureDOMPurify(purify, DEFAULT_POLICY)
const clean = purify.sanitize(dirty, config)
```

One call, because the safe setup has to be atomic. `configureDOMPurify` installs
**both** hooks the policy needs and then returns a config that enables the
features they guard:

- `styleAttributeHook`, because `ALLOWED_ATTR` is global and DOMPurify filters no
  CSS properties of its own — without it, permitting `style` permits
  `position:fixed;inset:0`, a page-covering overlay that looks like your own UI.
- `embedHook`, because the policy allows an `<iframe>` only when its `src` is on a
  closed list of player hosts, which no DOMPurify config can express. Enabling
  iframes without it would let `<iframe src="https://evil.example">` through the
  sanitizer this file recommends.

Reach for the individual hooks or `toDOMPurifyConfig` only if you manage
DOMPurify hooks yourself. Both fail closed — they drop styles and iframes rather
than trusting them — so the failure mode of getting it wrong is content loss
rather than XSS. That is the right direction, and it is still worth not doing.

## More

- [API reference](https://github.com/PeytonNowlin/openleaf/blob/main/docs/api-reference.md) —
  every attribute, property and `openleaf:*` event.
- [SECURITY.md](https://github.com/PeytonNowlin/openleaf/blob/main/SECURITY.md) —
  the threat model and a baseline CSP.
- [Project README](https://github.com/PeytonNowlin/openleaf) for the rest.
