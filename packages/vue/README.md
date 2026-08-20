# @openleaf-editor/vue

Vue 3 wrapper for the OpenLeaf custom element.

## Install

```sh
npm install @openleaf-editor/vue@beta
```

Keep every `@openleaf-editor/*` package on the same version. They pin each other
exactly, so mixing versions installs two copies of the schema and the toolbar
registry -- and a node built by one is not a node type the other accepts.

## Use it

```tsx
<script setup>
import { OpenLeafEditor } from '@openleaf-editor/vue'
const html = ref('<p>Hello</p>')
</script>

<template>
  <OpenLeafEditor v-model="html" toolbar="bold italic | link" />
</template>
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
