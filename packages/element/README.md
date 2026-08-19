# `@openleaf-editor/element`

The `<openleaf-editor>` custom element: OpenLeaf's drop-in for CMS forms. HTML in, HTML out, syncs to a textarea.

This is a **beta** (`0.1.0-beta.0`). APIs may still change. It has not been
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
            @openleaf-editor/plugins-highlight@beta \
            @openleaf-editor/plugins-import@beta \
            @openleaf-editor/plugins-import-docx@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'

installTableEditing()
installSyntaxHighlighting()
installImport()
installDocxImport()
```

Sanitize submitted HTML on the server. `@openleaf-editor/sanitize` ships the same allowlist as data.

See the [project README](https://github.com/PeytonNowlin/openleaf) for the rest.
