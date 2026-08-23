# Integrating OpenLeaf

This is the canonical installation guide for developers and coding agents adding
OpenLeaf to an application. Inspect the application first, choose one integration
path below, and preserve its existing package manager, framework conventions,
form handling, and test commands.

> [!WARNING]
> OpenLeaf is currently beta. Use the `@beta` release channel -- a new beta
> publishes most Mondays -- keep every `@openleaf-editor/*` package on the same
> version, and review the
> [known limitations](../README.md#project-status) before production use.

No `@openleaf-editor/*` package runs an install-time script, so npm 12's
`allowScripts`-off default needs no `npm approve-scripts` entry for OpenLeaf.
Releases are published from CI by trusted publishing, so they carry provenance
attestations that `npm audit signatures` verifies.

## Choose the integration

| Application | Package | Binding |
| --- | --- | --- |
| Plain HTML, server-rendered forms, or any other framework | `@openleaf-editor/element` | A bound `<textarea>` or the element's `value` property |
| React 18 or newer, including Next.js | `@openleaf-editor/react` | Controlled `value` and `onOpenLeafChange` props |
| Vue 3.4 or newer, including Nuxt | `@openleaf-editor/vue` | `v-model` |
| Angular | `@openleaf-editor/element` | The custom element directly; there is no supported Angular wrapper package |

Prefer the framework wrapper where one exists. Both wrappers remain thin hosts
around the same custom element; plugin APIs and element attributes still apply.

## Rules every integration must keep

1. **Sanitize on the server.** Editor output is untrusted HTML. Client-side
   filtering is not a security boundary, because the author controls the client.
2. **Keep package versions together.** Install the editor, plugins, and
   `@openleaf-editor/sanitize` in one package-manager operation where practical.
   Do not mix stable, beta, or explicit versions within the OpenLeaf packages.
3. **Give the editor an accessible name.** Use a visible `<label>` for a bound
   textarea and set `aria-label` on `<openleaf-editor>` or the framework wrapper.
4. **Choose one source of truth.** Use textarea binding for an ordinary form, or
   use the framework's controlled value binding. Do not add a second competing
   state synchronization layer.
5. **Treat configuration as trusted application code.** In particular,
   `content-css` URLs and plugins must not come from user input. A plugin has the
   same privileges as the page that loads it.
6. **Keep initial HTML in an HTML-safe context.** When a server template writes
   stored HTML into a textarea, escape it for the textarea context.

## Plain HTML or a custom element

Install and register the element once in the application's browser entry point.
Use the package manager already present in the project; the command below uses
npm only as an example.

```sh
npm install @openleaf-editor/element@beta
```

```ts
import '@openleaf-editor/element'
```

For an existing form, bind the editor to a textarea. OpenLeaf writes the
textarea shortly after document changes and synchronously before submission.

```html
<form method="post">
  <label for="body">Post body</label>
  <openleaf-editor for="body" aria-label="Post body"></openleaf-editor>
  <textarea id="body" name="body" hidden></textarea>
  <button type="submit">Save</button>
</form>
```

Set the textarea's initial value to load a document. The textarea may also be
nested inside the element; OpenLeaf will discover and bind it automatically.

For application-managed state, use the element's `value` property and listen to
`openleaf:change`. Compare before assigning an external value so a synchronization
loop does not create unnecessary transactions.

```ts
import '@openleaf-editor/element'
import type { OpenLeafEditor } from '@openleaf-editor/element'

const editor = document.querySelector<OpenLeafEditor>('openleaf-editor')
if (!editor) throw new Error('The OpenLeaf editor is missing.')

editor.value = initialHtml
editor.addEventListener('openleaf:change', (event) => {
  saveDraft(event.detail.value)
})
```

The change event bubbles, crosses shadow-root boundaries, and contains a lazy
`detail.value` getter for the current serialized HTML. The bound textarea may
still be waiting for its short deferred synchronization when the listener runs;
read the event detail when code needs the value immediately.

## React

Install the React wrapper. It brings in the element; do not install both unless
another direct dependency needs the element package explicitly.

```sh
npm install @openleaf-editor/react@beta
```

```tsx
import { useState } from 'react'
import { OpenLeafEditor } from '@openleaf-editor/react'

export function PostEditor() {
  const [html, setHtml] = useState('<p></p>')

  return (
    <OpenLeafEditor
      value={html}
      onOpenLeafChange={setHtml}
      toolbar="bold italic | link | undo redo"
      aria-label="Post body"
    />
  )
}
```

The package declares its browser boundary with `'use client'` and its imports
are safe during server rendering. In a Next.js App Router application, render it
as a client component just as you would any stateful input. Do not dynamically
import OpenLeaf solely to hide an SSR import error; such an error is a bug worth
reporting.

The wrapper guards controlled-value assignments and passes the event's already
serialized HTML to `onOpenLeafChange`. A ref exposes the underlying
`OpenLeafEditor` element when the imperative API is needed.

## Vue

```sh
npm install @openleaf-editor/vue@beta
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { OpenLeafEditor } from '@openleaf-editor/vue'

const html = ref('<p></p>')
</script>

<template>
  <OpenLeafEditor
    v-model="html"
    toolbar="bold italic | link | undo redo"
    aria-label="Post body"
  />
</template>
```

The wrapper is safe to import during SSR and upgrades the element in the
browser. Attributes not declared as Vue props are forwarded to the custom
element.

If an application uses `<openleaf-editor>` directly in Vue templates, configure
Vue's compiler to recognize `openleaf-` tags as custom elements. The wrapper
does not need that configuration; see the
[Vue package guide](../packages/vue/README.md#if-you-use-the-custom-element-directly).

## Angular

The previously published `@openleaf-editor/angular` package was withdrawn. Do
not install it. Angular supports custom elements directly:

```sh
npm install @openleaf-editor/element@beta
```

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
import '@openleaf-editor/element'

@Component({
  selector: 'app-post-editor',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <openleaf-editor
      toolbar="bold italic | link | undo redo"
      aria-label="Post body"
    ></openleaf-editor>
  `,
})
export class PostEditorComponent {}
```

Angular's template parser cannot bind the colon in `openleaf:change`
declaratively. Use the typed directive in the
[Angular integration recipe](../packages/angular/README.md#two-way-binding) for
`[(value)]`, and adapt it to a `ControlValueAccessor` when the application needs
reactive forms.

## Optional plugins

Install only the features the application needs, in the same command as the
chosen editor package when possible:

| Feature | Package | Installer |
| --- | --- | --- |
| Table editing | `@openleaf-editor/plugins-table` | `installTableEditing()` |
| Text and highlight colours | `@openleaf-editor/plugins-colour` | `installColourPicker()` |
| Syntax highlighting | `@openleaf-editor/plugins-highlight` | `installSyntaxHighlighting()` |
| HTML and text file import | `@openleaf-editor/plugins-import` | `installImport()` |
| Word `.docx` import | `@openleaf-editor/plugins-import-docx` | `installDocxImport()` |
| Find, count, save, preview, print, and recovery | `@openleaf-editor/plugins-session` | `installSessionTools()` |
| Media, details, symbols, snippets, and image resize | `@openleaf-editor/plugins-insert` | `installInsertTools()` |

Example:

```sh
npm install @openleaf-editor/react@beta \
  @openleaf-editor/plugins-table@beta \
  @openleaf-editor/plugins-colour@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installColourPicker } from '@openleaf-editor/plugins-colour'

installTableEditing()
installColourPicker()
```

Run installers in a browser entry point before rendering the first editor. A
plugin registers capability; it does not rearrange a custom toolbar. Add its
toolbar item IDs explicitly when the editor has a `toolbar` attribute. The full
ID list is in [Optional plugins](../README.md#optional-plugins).

Word import is the ordering exception: install both import packages and call
`installImport()` before `installDocxImport()`. The DOCX package supplies a
converter behind the `importFile` control owned by the base import package.
That converter also refuses a ZIP bomb: 25 MB compressed, 256 MB expanded, and
it fails closed when the archive's directory cannot be read. See
[SECURITY.md](../SECURITY.md#scope-and-threat-model) and
[`@openleaf-editor/plugins-import-docx`](../packages/plugins-import-docx/README.md).

Third-party schema extensions must register before an editor is built because a
ProseMirror schema is immutable. See
[Authoring schemas and plugins](authoring-plugins.md#11-schema-extensions).

## Server-side sanitization

Sanitize submitted HTML in a trusted server process before storing or rendering
it. If the server is JavaScript, install the policy package on the same OpenLeaf
version and configure DOMPurify atomically:

```sh
npm install @openleaf-editor/sanitize@beta dompurify jsdom
```

```js
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import {
  configureDOMPurify,
  DEFAULT_POLICY,
} from '@openleaf-editor/sanitize'

const serverWindow = new JSDOM('').window
const purify = DOMPurify(serverWindow)
const config = configureDOMPurify(purify, DEFAULT_POLICY)
const cleanHtml = purify.sanitize(untrustedHtml, config)
```

Keep the server's DOM implementation current; older jsdom releases have had
security defects. Do not move sanitization into the browser to avoid using a
DOM implementation on Node.js. Use
`configureDOMPurify`, not only `toDOMPurifyConfig`: OpenLeaf's safe handling for
style values and allowlisted iframe hosts requires the hooks installed by the
combined function.

The package can also emit policy configuration for Python Bleach and PHP
HTMLPurifier. Read the [sanitizer package guide](../packages/sanitize/README.md)
and [security threat model](../SECURITY.md) before choosing an adapter. If the
application preserves custom elements or attributes, extend the policy
explicitly with `policyForPreserved`; a permissive "trust editor output" mode
would be a security vulnerability.

## Image upload

URL insertion works without configuration. File selection, paste, and drop need
an application-owned upload endpoint:

```ts
import { registerImageUploader } from '@openleaf-editor/element'

registerImageUploader(async (file) => {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch('/media', { method: 'POST', body })
  if (!response.ok) throw new Error('The image could not be uploaded.')
  return response.json()
})
```

Validate file type, size, authorization, and the returned URL on the server. The
result may be a URL string or an object with `src` and optional `alt`, `title`,
`width`, and `height`. OpenLeaf deliberately has no `data:` URL fallback. The
picker and drop path accept JPEG (including `.jfif`), PNG, GIF, WebP and AVIF;
HEIC/HEIF is refused with a live-region message rather than converted.

## No-build applications

OpenLeaf's demo uses a prebuilt `openleaf.min.js` IIFE and matching optional
plugin bundles. A no-build application may self-host those files, loading the
core bundle before plugin bundles. Treat the set as one version: do not combine
files from different builds, and do not use the mutable live-demo URL as a
production CDN. npm packages are the preferred installation path for
applications that already have a bundler.

## Verify the result

An integration is complete only after these checks pass:

- The application builds in both its server and browser targets, when it has
  both.
- Initial HTML appears and editing updates exactly one application state or
  bound textarea.
- Form submission or the save handler receives the current HTML.
- Reloading the saved value preserves supported and application-specific
  markup as intended.
- The editor has an accessible name and can be reached by keyboard.
- A paste from Word or Google Docs retains text and list structure.
- Server-side sanitization removes scripts, event-handler attributes, unsafe
  URLs, unapproved embeds, and disallowed CSS.
- Every configured toolbar item is registered; OpenLeaf emits a console warning
  for an unknown ID.
- The application's existing unit, type, build, and browser checks still pass.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `no toolbar item registered` warning | The plugin was not installed, its installer was not called, or the toolbar ID is misspelled. |
| A plugin appears installed but its nodes or controls do not work | Multiple OpenLeaf or ProseMirror versions were bundled, or a schema extension loaded after the editor was built. |
| Angular production build asks for the JIT compiler | The withdrawn Angular wrapper was installed; use the custom element recipe above. |
| Vue reports `Failed to resolve component: openleaf-editor` | The direct custom element was used without `isCustomElement`; use the Vue wrapper or configure the compiler. |
| The editor works in development but SSR fails | Report the offending OpenLeaf entry point; all published entries are tested without a DOM. Do not paper over it with a client-only dynamic import. |
| Alignment, colour, or embeds disappear after saving | The server sanitizer is missing OpenLeaf's DOMPurify hooks or uses a policy that does not cover preserved markup. |
| Changing a controlled value adds undo steps or loops | Compare values before assignment and use the framework wrapper's binding rather than a second custom listener. |

## Public references

- [`<openleaf-editor>` API](api-reference.md) — attributes, properties, events,
  form behavior, and re-exported extension functions
- [Security](../SECURITY.md) — threat model, preservation policy, plugin trust,
  CSP, and vulnerability reporting
- [Project README](../README.md) — feature overview, toolbar IDs, package index,
  and beta limitations
- [Authoring plugins](authoring-plugins.md) — extension contracts and timing
- [React](../packages/react/README.md), [Vue](../packages/vue/README.md), and
  [Angular](../packages/angular/README.md) framework-specific details

If this guide conflicts with the public TypeScript surface, the implementation
and tests are authoritative; please report the documentation mismatch.
