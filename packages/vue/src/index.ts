/**
 * Vue 3 binding for `<openleaf-editor>`.
 *
 * `v-model` maps onto the element's `value`. The custom element remains the
 * source of truth for editing; this wrapper does not reimplement the schema.
 */

import { defineComponent, h, onMounted, ref, watch } from 'vue'
import '@openleaf-editor/element'

type Host = HTMLElement & { value: string }

export const OpenLeafEditor = defineComponent({
  name: 'OpenLeafEditor',
  props: {
    modelValue: { type: String, default: '' },
    toolbar: { type: String, default: undefined },
    toolbar2: { type: String, default: undefined },
    menubar: { type: [String, Boolean], default: undefined },
    formats: { type: String, default: undefined },
    lang: { type: String, default: undefined },
    for: { type: String, default: undefined },
  },
  emits: ['update:modelValue'],
  setup(props, { emit, attrs }) {
    const el = ref<Host | null>(null)

    onMounted(() => {
      const host = el.value
      if (!host) return
      if (props.modelValue) host.value = props.modelValue
      host.addEventListener('openleaf:change', () => {
        emit('update:modelValue', host.value)
      })
    })

    watch(
      () => props.modelValue,
      (html) => {
        const host = el.value
        if (!host || html === undefined) return
        if (host.value !== html) host.value = html
      },
    )

    return () =>
      h('openleaf-editor', {
        ...attrs,
        ref: el,
        toolbar: props.toolbar,
        toolbar2: props.toolbar2,
        menubar: props.menubar === true ? '' : props.menubar === false ? undefined : props.menubar,
        formats: props.formats,
        lang: props.lang,
        for: props.for,
      })
  },
})
