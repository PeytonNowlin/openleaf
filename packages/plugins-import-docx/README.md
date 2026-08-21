# @openleaf-editor/plugins-import-docx

Word `.docx` import, using mammoth.

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

```sh
npm install @openleaf-editor/plugins-import-docx@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

With a bundler:

```ts
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'

installImport()      // required, and required first
installDocxImport()
```

`installImport()` is not optional and the order matters. This package registers a
**converter**, not a control; the `importFile` toolbar item that reaches it
belongs to `@openleaf-editor/plugins-import`. Call `installDocxImport()` alone
and `.docx` conversion is registered and unreachable — there is no button.

With a script tag, load it after the core bundle -- it borrows the first one's
ProseMirror runtime rather than shipping a second copy:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-import.min.js"></script>
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
