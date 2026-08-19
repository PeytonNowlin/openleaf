# `@openleaf-editor/element`

The `<openleaf-editor>` custom element: OpenLeaf's drop-in for CMS forms. HTML in, HTML out, syncs to a textarea.

This is a **beta** (`0.1.0-beta.1`). APIs may still change. It has not been
used in production, and it has not been driven by a real screen reader.

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
  <openleaf-editor for="body" aria-label="Post body"></openleaf-editor>
  <textarea id="body" name="body" hidden></textarea>
  <button type="submit">Save</button>
</form>
```

Optional plugins, each a separate package. Keep the `@beta` tag:

```bash
npm install @openleaf-editor/plugins-table@beta \
            @openleaf-editor/plugins-colour@beta \
            @openleaf-editor/plugins-highlight@beta \
            @openleaf-editor/plugins-import@beta \
            @openleaf-editor/plugins-import-docx@beta \
            @openleaf-editor/plugins-insert@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installColourPicker } from '@openleaf-editor/plugins-colour'
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'
import { installInsertTools } from '@openleaf-editor/plugins-insert'

installTableEditing()
installColourPicker()
installSyntaxHighlighting()
installImport()
installDocxImport()
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
vanishes on save is worse than a missing picker.

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
`element.imageUploader` instead.

Sanitize submitted HTML on the server. `@openleaf-editor/sanitize` ships the same allowlist as data — including the narrow `style` allowance that alignment and colour need. If you sanitize with DOMPurify, install `styleAttributeHook` as well; the config alone cannot filter CSS per element.

See the [project README](https://github.com/PeytonNowlin/openleaf) for the rest.
