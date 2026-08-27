# `@openleaf-editor/plugins-webmcp`

An opt-in WebMCP tool surface for [OpenLeaf](https://github.com/PeytonNowlin/openleaf): an agent driving the browser can ask which OpenLeaf editors are on the page and get a stable identifier for each one.

This is a **beta** (`0.1.0-beta.4`). Keep every `@openleaf-editor/*` package on the
same version.

It is not in the core bundle, and not only for weight. An editor should have no
agent surface unless the integrator decided it should, and the browser API this
is built against is young enough to have been renamed twice — so it lives behind
a package boundary, where the next rename is one file rather than a change to
the editor core.

It contributes nothing to the document format: no node types, no marks, no
toolbar items, no icons, and no CSS. A deployment that does not install it is
byte-for-byte the deployment it is today.

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
npm install @openleaf-editor/element@beta @openleaf-editor/plugins-webmcp@beta
```

```ts
import '@openleaf-editor/element'
import { installAgentTools } from '@openleaf-editor/plugins-webmcp'

installAgentTools()
```

Or as a second script tag, in this order:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-webmcp.min.js"></script>
```

The script tag installs on load. Calling `installAgentTools()` twice is
harmless — the second call is ignored, options and all — because a CMS template
that includes the bundle on two paths must not try to register the same tool
names twice.

## Tools

Tool names are page-global, so every one of them is in the `openleaf_`
namespace.

| Tool | Read-only | Returns document content | What it does |
| --- | --- | --- | --- |
| `openleaf_list_editors` | yes | no | Lists the OpenLeaf editors on the page, with an identifier for each. |

Every result is a **JSON string**, because a string is all the browser's execute
path returns. The envelope is the same for every tool:

```json
{ "ok": true,  "editors": [{ "id": "post-body", "label": "Post body" }] }
{ "ok": false, "error": "unknown-editor", "message": "…what to do instead" }
```

Read tools carry the `readOnlyHint` annotation, so the client driving the agent
can decide when a call needs a person's confirmation. Any tool that returns
document content carries `untrustedContentHint`, because a document is exactly
where text aimed at the agent reading it can hide. `openleaf_list_editors`
returns identifiers and accessible names only, and is annotated accordingly.

## Editor identity

Every tool other than the listing takes an editor identifier, so the identifier
has to be stable across a whole agent task.

- The host element's `id`, when it has one. Integrators already give these
  elements ids to bind them to a textarea, so in practice the identifier is one
  you recognise and can act on.
- Otherwise an ordinal: `editor-2` is the second editor registered on the page.
  The number is never reused, so an editor that is removed does not hand its
  name to a later one.

An editor removed from the page stops being listed. An editor mounted after the
bundle loaded starts being listed. Both follow from where the register is kept:
the editor plugin's own per-view lifecycle.

## Browser support

The tools are registered with the browser's agent API — `document.modelContext`,
falling back to the deprecated `navigator.modelContext`. In a browser that has
neither, installing does nothing at all: no error, no console output, and no
half-wired editor. Shipping the bundle is safe for every visitor.

In Chrome the API is currently behind `--enable-blink-features=WebMCP`.

## The tool set as a value

The tools are a plain array — names, titles, descriptions, input schemas,
annotations, and executable handlers — and installing is a thin wrapper that
hands that array to the browser:

```ts
import { agentTools } from '@openleaf-editor/plugins-webmcp'

agentTools.map((tool) => tool.name) // ['openleaf_list_editors']
```

From a script tag it is `OpenLeaf.agentTools` once the bundle has loaded, the
same way `OpenLeaf.registerSaveHandler` is exposed by the session bundle. This
is what makes the surface testable without a flagged browser, and it is what a
host integration reaches for when it wants to drive a tool itself.

## Accessibility and CSP

Nothing here renders. There is no UI, no stylesheet, and no icon set, so there
is nothing to make accessible and nothing for a style-src policy to allow.
