# @openleaf-editor/vue

Vue 3 wrapper for the OpenLeaf custom element.

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
npm install @openleaf-editor/vue@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

```vue
<script setup>
import { ref } from 'vue'
import { OpenLeafEditor } from '@openleaf-editor/vue'

const html = ref('<p>Hello</p>')
</script>

<template>
  <OpenLeafEditor v-model="html" toolbar="bold italic | link" />
</template>
```

### If you use the custom element directly

This wrapper registers nothing with Vue's compiler, so it just works. Reaching
for `<openleaf-editor>` in a template instead means telling Vue that it is a
custom element, or you get `[Vue warn]: Failed to resolve component:
openleaf-editor`:

```js
// vite.config.js
export default {
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => tag.startsWith('openleaf-') },
      },
    }),
  ],
}
```

## It is a wrapper, not a port

The editor is the `<openleaf-editor>` custom element. This forwards attributes,
keeps a controlled value in sync, and re-emits `openleaf:change`. Nothing about
editing lives here.

That is deliberate: three framework ports would be three copies of the schema and
three sets of bugs, and a node built by one is not a node type another accepts. If
you are not using Vue, skip this package -- the element works on its own
and that is the supported path, not a fallback.

Importing this module does not touch the DOM, so it is safe in a server render.
The element upgrades on the client.

## License

Apache-2.0.
