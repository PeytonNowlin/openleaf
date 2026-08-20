# @openleaf-editor/plugins-import

Opt-in file import: HTML and plain text, with no dependency, plus a seam for
.docx and other formats.

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
npm install @openleaf-editor/plugins-import@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

With a bundler:

```ts
import { installImport } from '@openleaf-editor/plugins-import'
installImport()
```

With a script tag, load it after the core bundle -- it borrows the first one's
ProseMirror runtime rather than shipping a second copy:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-import.min.js"></script>
```

Adds an `importFile` toolbar item. Name it in your `toolbar` attribute.

## Registering another format

The importer is a seam, not a fixed list. `registerFileConverter` takes a matcher
and a converter, and `addAcceptedExtensions` widens the file picker -- which is
exactly how
[`@openleaf-editor/plugins-import-docx`](../plugins-import-docx) adds Word support
without this package depending on mammoth.

Imported HTML goes through the same preservation pipeline as stored content, not
the paste pipeline: a file you chose to import is a document, not a clipboard.

## License

Apache-2.0.
