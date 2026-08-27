# @openleaf-editor/sanitize

One canonical allowlist, as data, plus generated configuration for DOMPurify,
Python bleach and PHP HTMLPurifier.

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
npm install @openleaf-editor/sanitize@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Why it exists

A CMS is rarely one language. The editor is JavaScript, the request handler is PHP
or Python, and a worker re-renders stored content somewhere else again. Each of
those normally grows its own hand-written allowlist, the three drift, and the
divergence is discovered by something getting through the weakest one.

One policy, three configurations, generated rather than transcribed.

```ts
import { DEFAULT_POLICY, sanitizeHtml, toBleachConfig } from '@openleaf-editor/sanitize'

sanitizeHtml(dirty)              // reference enforcement, no dependencies
toBleachConfig(DEFAULT_POLICY)   // emits a Python module
```

No dependency on `@openleaf-editor/core`: a server that only needs the policy
should not have to install ProseMirror. The rules themselves come from
[`@openleaf-editor/content-policy`](../content-policy), and
`test/agreement.test.ts` runs real documents through both the schema and the
policy and fails if they disagree.

## With DOMPurify, use `configureDOMPurify`

```ts
import DOMPurify from 'dompurify'
import { configureDOMPurify, DEFAULT_POLICY } from '@openleaf-editor/sanitize'

const purify = DOMPurify(window)
const config = configureDOMPurify(purify, DEFAULT_POLICY)
const clean = purify.sanitize(dirty, config)
```

`style` and `iframe` need per-element precision that no DOMPurify config can
express -- `ALLOWED_ATTR` is global and `ALLOWED_URI_REGEXP` applies to every URL
attribute at once. So `toDOMPurifyConfig` **withholds both by default**, and
`configureDOMPurify` installs the hooks and enables the features in one call, so a
config and the hooks it depends on cannot disagree. Forgetting it costs alignment,
colour and type, which is visible; the alternative was admitting
`position:fixed;inset:0`, which is not. `font-family` values are the same
allowlist `@openleaf-editor/content-policy` uses: letters, digits, spaces,
hyphens, apostrophes and plus, re-emitted as a CSS identifier or a
double-quoted string. `url()`, `expression()`, `var()`, comments and `;`
are refused.

## Read this before trusting `sanitizeHtml`

It is a reference enforcer, not a hardened sanitizer, and does not claim to be. It
does not defend against mutation XSS or parser differentials. **If you can add a
dependency, use DOMPurify with the config above.** `sanitizeHtml` exists because
"add no dependencies" is a real constraint in real deployments, and shipping
nothing would leave those integrators writing their own.

Either way: sanitize on the server.

## License

Apache-2.0.
