# @openleaf-editor/plugins-highlight

Opt-in syntax highlighting for code blocks, and a formatted, highlighted
source view.

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
npm install @openleaf-editor/plugins-highlight@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

With a bundler:

```ts
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
installSyntaxHighlighting()
```

With a script tag, load it after the core bundle -- it borrows the first one's
ProseMirror runtime rather than shipping a second copy:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-highlight.min.js"></script>
```

Highlighting applies to code blocks automatically. The formatted source view
replaces the plain `source` textarea when this is loaded.

## Bring your own highlighter

A small built-in tokenizer covers HTML, CSS and JavaScript, which is what a CMS
code block usually contains. For anything else, `setHighlighter` takes
Prism, refractor or highlight.js. `SUPPORTED_LANGUAGES` and `canHighlight` report
what the current highlighter covers.

A highlighter that throws is caught, logged once, and the text is shown
unhighlighted. A colour scheme is not worth losing a code block over.

## License

Apache-2.0.
