/**
 * Vue 3 binding for `<openleaf-editor>`.
 *
 * `v-model` maps onto the element's `value`. The custom element remains the
 * source of truth for editing; this wrapper does not reimplement the schema.
 */

import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@openleaf-editor/element'
import type { OpenLeafEditor as OpenLeafEditorElement } from '@openleaf-editor/element'

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
    const el = ref<OpenLeafEditorElement | null>(null)

    const onChange = (event: Event): void => {
      const detail = (event as HTMLElementEventMap['openleaf:change']).detail
      // The detail carries the already-serialized document. Reading `.value`
      // back off the element serializes it a second time, per keystroke.
      emit('update:modelValue', detail?.value ?? el.value?.value ?? '')
    }

    onMounted(() => {
      const host = el.value
      if (!host) return
      // `!== undefined`, not truthiness. `modelValue` defaults to `''`, and `''`
      // is falsy -- so mounting with the declared default skipped the write
      // entirely and left whatever stale `innerHTML` was in the template.
      if (props.modelValue !== undefined) host.value = props.modelValue
      host.addEventListener('openleaf:change', onChange)
    })

    // React and Angular both cleaned up; Vue did not, so every unmount left a
    // listener holding a closure over the component's `emit` alive.
    onBeforeUnmount(() => {
      el.value?.removeEventListener('openleaf:change', onChange)
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
        // `^` forces `setAttribute` rather than a property write.
        //
        // Vue's `shouldSetAsProp` ends in `return key in el`, and every one of
        // these names is now a real accessor on the element -- so without the
        // prefix Vue takes the property path. That path is where `toolbar` used
        // to be a SILENT no-op: the element exposed a getter-only `toolbar`
        // accessor for plugin authors, `patchDOMProp` does
        // `try { el[key] = value } catch {}`, assigning to a getter-only
        // accessor throws in strict mode, and the throw was swallowed.
        // `<OpenLeafEditor toolbar="bold italic" />` rendered the full
        // 22-button default bar with no error anywhere.
        //
        // The element now has setters that reflect, so the property path works
        // too. Forcing attributes anyway keeps this wrapper correct against an
        // older element than itself, and keeps one spelling of the truth: the
        // attribute is what the element reads.
        '^toolbar': props.toolbar,
        '^toolbar2': props.toolbar2,
        '^menubar':
          props.menubar === true ? '' : props.menubar === false ? undefined : props.menubar,
        '^formats': props.formats,
        '^lang': props.lang,
        '^for': props.for,
      })
  },
})
