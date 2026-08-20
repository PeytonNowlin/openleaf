# @openleaf-editor/plugins-import-docx

Word `.docx` import, using mammoth.

## Install

```sh
npm install @openleaf-editor/plugins-import-docx@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

With a bundler:

```ts
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'
installDocxImport()
```

With a script tag, load it after the core bundle -- it borrows the first one's
ProseMirror runtime rather than shipping a second copy:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-import-docx.min.js"></script>
```

Requires [`@openleaf-editor/plugins-import`](../plugins-import), which owns the
`importFile` control this registers a converter with.

## Its own bundle, for a reason

mammoth is larger than the entire editor -- around 123 KB gzipped against core's
108. A site that only imports HTML must not pay for it, which is why this is a
separate package and a separate script tag rather than an option on the importer.

## License

Apache-2.0.
