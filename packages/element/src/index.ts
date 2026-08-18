/**
 * <openleaf-editor> -- the CMS drop-in.
 *
 * Design constraints, in priority order:
 *
 *  1. WORKS WITHOUT A BUILD STEP. A `<script>` tag and a custom element,
 *     because the integrations that most need a free editor are PHP
 *     templates and Django forms, not Vite projects.
 *
 *  2. HTML IN, HTML OUT. No proprietary document format. A CMS that adopts
 *     Openleaf and later drops it is left with content it can still render.
 *
 *  3. NO SHADOW DOM ON THE CONTENT AREA. Deliberate. CMS integrators expect
 *     the site's own typography to apply to the content they are editing --
 *     that is what makes it WYSIWYG. Shadow DOM would block exactly the
 *     inheritance they want. Chrome styles are namespaced instead.
 *
 *  4. THE TEXTAREA CONTRACT. CMS forms submit textareas. The element keeps
 *     one in sync and writes to it before submit, so server-side code that
 *     already reads `$_POST['body']` keeps working untouched.
 */

import { parseHtml, serializeHtml, schema } from '@openleaf/core'
import { normalizePastedHtml } from '@openleaf/paste'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

export class OpenleafEditor extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['for', 'readonly']
  }

  #view: EditorView | null = null
  #textarea: HTMLTextAreaElement | null = null
  #form: HTMLFormElement | null = null
  #onSubmit = (): void => this.#syncToTextarea()

  connectedCallback(): void {
    if (this.#view) return
    this.#textarea = this.#findTextarea()

    const initialHtml = this.#textarea?.value ?? this.innerHTML
    // The element's own markup is only a seed; ProseMirror owns the DOM
    // from here, so clear it before mounting.
    if (!this.#textarea) this.innerHTML = ''

    const mount = document.createElement('div')
    mount.className = 'openleaf-content'
    this.appendChild(mount)

    this.#view = new EditorView(mount, {
      state: EditorState.create({
        doc: parseHtml(initialHtml),
        plugins: [
          history(),
          keymap({
            'Mod-b': toggleMark(schema.marks['strong']!),
            'Mod-i': toggleMark(schema.marks['em']!),
            'Mod-u': toggleMark(schema.marks['underline']!),
            'Mod-z': undo,
            'Mod-y': redo,
            'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
        ],
      }),
      editable: () => !this.hasAttribute('readonly'),
      // Normalize before ProseMirror parses. Word and Google Docs express
      // structure as proprietary CSS, so without this a pasted list arrives as
      // a wall of paragraphs with stray bullet characters in the text -- the
      // single most common complaint about editors that get this wrong.
      transformPastedHTML: (html) => normalizePastedHtml(html),
      attributes: {
        // Announce the editable region to assistive technology. Without a
        // role and a name, a screen reader reports an unlabelled text box.
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': this.getAttribute('aria-label') ?? 'Rich text editor',
      },
      dispatchTransaction: (tr) => {
        const view = this.#view
        if (!view) return
        view.updateState(view.state.apply(tr))
        if (tr.docChanged) {
          this.#syncToTextarea()
          this.dispatchEvent(new CustomEvent('openleaf:change', { bubbles: true }))
        }
      },
    })

    // Belt and braces: `submit` covers ordinary posts, `formdata` covers
    // fetch-based submissions built from a FormData snapshot.
    this.#form = this.closest('form')
    this.#form?.addEventListener('submit', this.#onSubmit)
    this.#form?.addEventListener('formdata', this.#onSubmit)
    this.#syncToTextarea()
  }

  disconnectedCallback(): void {
    this.#form?.removeEventListener('submit', this.#onSubmit)
    this.#form?.removeEventListener('formdata', this.#onSubmit)
    this.#view?.destroy()
    this.#view = null
  }

  /** Current document as an HTML string. */
  get value(): string {
    if (!this.#view) return this.#textarea?.value ?? ''
    return serializeHtml(this.#view.state.doc)
  }

  set value(html: string) {
    if (!this.#view) {
      if (this.#textarea) this.#textarea.value = html
      return
    }
    const state = EditorState.create({
      doc: parseHtml(html),
      plugins: this.#view.state.plugins,
    })
    this.#view.updateState(state)
    this.#syncToTextarea()
  }

  /** Escape hatch for plugins and integrations that need the real view. */
  get view(): EditorView | null {
    return this.#view
  }

  #findTextarea(): HTMLTextAreaElement | null {
    const id = this.getAttribute('for')
    if (id) {
      const el = (this.getRootNode() as Document | ShadowRoot).getElementById?.(id)
      if (el instanceof HTMLTextAreaElement) return el
      // A `for` that resolves to nothing is a silent data-loss bug waiting
      // to happen, so say so loudly rather than falling back.
      console.error(
        `<openleaf-editor for="${id}">: no <textarea id="${id}"> found. ` +
          'Content will not be submitted with the form.',
      )
      return null
    }
    return this.querySelector('textarea')
  }

  #syncToTextarea(): void {
    if (!this.#textarea || !this.#view) return
    this.#textarea.value = serializeHtml(this.#view.state.doc)
  }
}

/** Idempotent: safe to import twice, or alongside a bundled copy. */
export function defineOpenleafEditor(tag = 'openleaf-editor'): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tag)) return
  customElements.define(tag, OpenleafEditor)
}

defineOpenleafEditor()
