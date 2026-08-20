# @openleaf-editor/content-policy

Dependency-free URL, CSS and embed rules, shared by the OpenLeaf editor and its
sanitizers.

This is not a package most integrations install directly. It exists so that
`@openleaf-editor/core` and `@openleaf-editor/sanitize` cannot disagree.

Those two answer the same questions — is this URL safe to store, is this CSS
declaration one we model, is this iframe host on the allowlist — from opposite
sides of the wire. `sanitize` deliberately does not depend on `core`, because a
server that only needs the policy should not have to install ProseMirror. For a
while that meant the rules were written twice, kept honest by a test that
compared the two copies answer for answer. This package is the shared original
instead: one definition, both sides importing it.

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
npm install @openleaf-editor/content-policy@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly.

## What is in it

| Entry point | Contents |
| --- | --- |
| `@openleaf-editor/content-policy` | Everything below, re-exported |
| `.../url` | Scheme allowlist, `isSafeUrl`, event-handler attribute detection |
| `.../css` | The modelled declaration vocabulary and per-property value checks |
| `.../embed` | The iframe host allowlist and the `allow` permission tokens |

```ts
import { isSafeUrl } from '@openleaf-editor/content-policy/url'
import { isAllowedEmbedSrc } from '@openleaf-editor/content-policy/embed'

isSafeUrl('javascript:alert(1)')                        // false
isAllowedEmbedSrc('https://www.youtube.com/embed/abc')  // true
isAllowedEmbedSrc('https://evil.example/')              // false
```

No dependencies, no DOM requirement, `sideEffects: false`. Safe to import in a
request handler, a worker, or a build step.

## Widening a rule

Adding a host to the embed allowlist or a property to the CSS vocabulary changes
what the editor stores *and* what every sanitizer adapter permits, which is the
point of it living here. Both directions are covered by
`packages/sanitize/test/agreement.test.ts`, which runs real documents through the
schema and then the policy and fails if they disagree.

## License

Apache-2.0.
