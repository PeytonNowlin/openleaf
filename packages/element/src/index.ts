/**
 * <openleaf-editor> -- the CMS drop-in.
 *
 * Design constraints, in priority order:
 *
 *  1. WORKS WITHOUT A BUILD STEP. A `<script>` tag and a custom element,
 *     because the integrations that most need a free editor are PHP templates
 *     and Django forms, not Vite projects.
 *
 *  2. HTML IN, HTML OUT. No proprietary document format. A CMS that adopts
 *     OpenLeaf and later drops it is left with content it can still render.
 *
 *  3. NO SHADOW DOM ON THE CONTENT AREA. Deliberate. CMS integrators expect the
 *     site's own typography to apply to the content they are editing -- that is
 *     what makes it WYSIWYG. Shadow DOM would block exactly the inheritance
 *     they want. Chrome styles are namespaced instead.
 *
 *  4. THE TEXTAREA CONTRACT. CMS forms submit textareas. The element keeps one
 *     in sync and writes to it before submit, so server-side code that already
 *     reads `$_POST['body']` keeps working untouched.
 *
 * Attributes:
 *   for          id of the textarea to bind to
 *   toolbar      space-separated item ids, `|` for a separator; `none` to omit
 *   readonly     render but do not allow editing
 *   aria-label   accessible name for the editable region
 */

import {
  buildKeymap,
  createRegisteredPlugins,
  onEditorPluginsChange,
  parseHtml,
  schema,
  serializeHtml,
} from '@openleaf/core'
import { normalizePastedHtml } from '@openleaf/paste'
import {
  SOURCE_TOGGLE_EVENT,
  Toolbar,
  ensureStyles,
  registerDefaultItems,
} from '@openleaf/ui'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

let hintCounter = 0

export class OpenLeafEditor extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['for', 'readonly']
  }

  #view: EditorView | null = null
  #toolbar: Toolbar | null = null
  #textarea: HTMLTextAreaElement | null = null
  #form: HTMLFormElement | null = null
  #contentHost: HTMLDivElement | null = null
  #sourceArea: HTMLTextAreaElement | null = null
  #sourceMode = false
  #basePlugins: import('prosemirror-state').Plugin[] = []
  #unwatchPlugins: (() => void) | undefined
  #onSubmit = (): void => this.#syncToTextarea()

  connectedCallback(): void {
    if (this.#view) return

    registerDefaultItems()
    ensureStyles(this.ownerDocument)

    this.#textarea = this.#findTextarea()
    const initialHtml = this.#textarea?.value ?? this.innerHTML
    // The element's own markup is only a seed; ProseMirror owns the DOM from
    // here, so clear it before mounting.
    this.innerHTML = ''
    this.classList.add('ol-editor')

    const layout = this.getAttribute('toolbar')
    const wantsToolbar = layout !== 'none'

    if (wantsToolbar) {
      this.#toolbar = new Toolbar(this, this.ownerDocument, {
        ...(layout ? { layout } : {}),
      })
      this.appendChild(this.#toolbar.el)
    }

    const contentHost = this.ownerDocument.createElement('div')
    contentHost.className = 'ol-content'
    this.appendChild(contentHost)
    this.#contentHost = contentHost

    // The Alt+F10 hint lives in a hidden element referenced by
    // aria-describedby. Screen reader users cannot guess the shortcut, and
    // discoverability comes from telling them rather than from choosing a
    // guessable key.
    const hintId = `ol-hint-${(hintCounter += 1)}`
    const hint = this.ownerDocument.createElement('span')
    hint.id = hintId
    hint.className = 'ol-live'
    hint.textContent = wantsToolbar
      ? 'Rich text editor. Press Alt plus F10 for the formatting toolbar.'
      : 'Rich text editor.'
    this.appendChild(hint)

    if (this.#toolbar) this.appendChild(this.#toolbar.liveRegion)

    this.#basePlugins = [
      history(),
      keymap({
        'Alt-F10': () => {
          this.#toolbar?.focusToolbar()
          return true
        },
      }),
      keymap(buildKeymap()),
      keymap(baseKeymap),
    ]

    this.#view = new EditorView(contentHost, {
      state: EditorState.create({
        doc: parseHtml(initialHtml),
        plugins: [
          history(),
          // Alt+F10 is bound before the shared keymap so it cannot be shadowed.
          keymap({
            'Alt-F10': () => {
              this.#toolbar?.focusToolbar()
              return true
            },
          }),
          // The shared shortcut table, so toolbar tooltips and any help dialog
          // render the real bindings rather than a duplicate list that drifts.
          keymap(buildKeymap()),
          keymap(baseKeymap),
          // Plugins contributed by opt-in bundles, instantiated fresh per
          // editor: a ProseMirror plugin instance carries per-editor state and
          // two editors sharing one would fight over it.
          ...createRegisteredPlugins(schema),
        ],
      }),
      editable: () => !this.hasAttribute('readonly'),
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': this.getAttribute('aria-label') ?? 'Rich text editor',
        'aria-describedby': hintId,
      },
      // Normalize before ProseMirror parses. Word and Google Docs express
      // structure as proprietary CSS, so without this a pasted list arrives as
      // a wall of paragraphs with stray bullet characters in the text.
      transformPastedHTML: (html) => normalizePastedHtml(html),
      dispatchTransaction: (tr) => {
        const view = this.#view
        if (!view) return
        view.updateState(view.state.apply(tr))
        // Passing the transaction lets the toolbar tell a formatting change from
        // a cursor move, which is what keeps its announcements useful instead of
        // chatty.
        this.#toolbar?.update(view.state, tr)
        if (tr.docChanged) {
          this.#syncToTextarea()
          this.dispatchEvent(new CustomEvent('openleaf:change', { bubbles: true }))
        }
      },
    })

    this.#toolbar?.mount(this.#view)
    this.addEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)

    // An editor already on the page when a deferred bundle finishes loading
    // would otherwise never receive its plugins, and the author would find
    // table controls that do nothing. `reconfigure` keeps the document and the
    // undo history; rebuilding the state from scratch would discard both.
    this.#unwatchPlugins = onEditorPluginsChange(() => {
      const view = this.#view
      if (!view) return
      view.updateState(
        view.state.reconfigure({
          plugins: [...this.#basePlugins, ...createRegisteredPlugins(schema)],
        }),
      )
      this.#toolbar?.update(view.state)
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
    this.removeEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)
    this.#unwatchPlugins?.()
    this.#toolbar?.destroy()
    this.#toolbar = null
    this.#view?.destroy()
    this.#view = null
  }

  /** Current document as an HTML string. */
  get value(): string {
    if (this.#sourceMode && this.#sourceArea) return this.#sourceArea.value
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
    this.#toolbar?.update(state)
    this.#syncToTextarea()
  }

  /** Escape hatch for plugins and integrations that need the real view. */
  get view(): EditorView | null {
    return this.#view
  }

  /** The toolbar, for plugins pushing external state via setItemState. */
  get toolbar(): Toolbar | null {
    return this.#toolbar
  }

  get sourceMode(): boolean {
    return this.#sourceMode
  }

  /* -------------------------------------------------------------- *
   * Source view
   * -------------------------------------------------------------- */

  /**
   * Toggle raw HTML editing.
   *
   * Switching view is a large context change, so focus moves into whichever
   * control is now live rather than being left on the button that caused the
   * switch. Leaving it silent and stranded is the common failure here.
   */
  #onToggleSource = (): void => {
    const view = this.#view
    const contentHost = this.#contentHost
    if (!view || !contentHost) return

    if (!this.#sourceMode) {
      const area = this.ownerDocument.createElement('textarea')
      area.className = 'ol-source'
      area.setAttribute('aria-label', 'HTML source')
      area.spellcheck = false
      area.value = serializeHtml(view.state.doc)
      contentHost.hidden = true
      contentHost.after(area)
      this.#sourceArea = area
      this.#sourceMode = true
      this.#toolbar?.setItemState('source', { active: true })
      area.focus()
      return
    }

    const area = this.#sourceArea
    if (area) {
      // Parsing is lenient by design: hand-edited HTML is frequently invalid,
      // and refusing to leave source view because of a stray tag would trap the
      // author in it.
      this.value = area.value
      area.remove()
      this.#sourceArea = null
    }
    contentHost.hidden = false
    this.#sourceMode = false
    this.#toolbar?.setItemState('source', { active: false })
    view.focus()
  }

  /* -------------------------------------------------------------- *
   * Textarea binding
   * -------------------------------------------------------------- */

  #findTextarea(): HTMLTextAreaElement | null {
    const id = this.getAttribute('for')
    if (id) {
      const el = (this.getRootNode() as Document | ShadowRoot).getElementById?.(id)
      if (el instanceof HTMLTextAreaElement) return el
      // A `for` that resolves to nothing is a silent data-loss bug waiting to
      // happen, so say so loudly rather than falling back.
      console.error(
        `<openleaf-editor for="${id}">: no <textarea id="${id}"> found. ` +
          'Content will not be submitted with the form.',
      )
      return null
    }
    return this.querySelector('textarea')
  }

  #syncToTextarea(): void {
    if (!this.#textarea) return
    if (this.#sourceMode && this.#sourceArea) {
      this.#textarea.value = this.#sourceArea.value
      return
    }
    if (!this.#view) return
    this.#textarea.value = serializeHtml(this.#view.state.doc)
  }
}

/**
 * Re-exported so the single-file bundle can offer paste normalization without a
 * second script tag. Useful for custom paste handling, and for normalizing
 * clipboard HTML somewhere other than the editor.
 */
export { normalizePastedHtml } from '@openleaf/paste'

/** Idempotent: safe to import twice, or alongside a bundled copy. */
export function defineOpenLeafEditor(tag = 'openleaf-editor'): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tag)) return
  customElements.define(tag, OpenLeafEditor)
}

defineOpenLeafEditor()
