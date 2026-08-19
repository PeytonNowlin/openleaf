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
 *   skin         named appearance: midnight, paper, contrast, compact
 *   theme        light | dark | auto (default: follow the visitor's system)
 *   toolbar      space-separated item ids, `|` for a separator; `none` to omit
 *   readonly     render but do not allow editing
 *   aria-label   accessible name for the editable region
 */

import {
  buildKeymap,
  coreSchema,
  createRegisteredPlugins,
  onEditorPluginsChange,
  onSchemaExtensionsChange,
  parseHtml,
  serializeHtml,
  type EditorPluginFactory,
} from '@openleaf/core'
import { normalizePastedHtml } from '@openleaf/paste'
import {
  SOURCE_TOGGLE_EVENT,
  Toolbar,
  applyColourScheme,
  applySkin,
  ensureSkins,
  ensureStyles,
  registerDefaultItems,
  type ColourScheme,
} from '@openleaf/ui'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

let hintCounter = 0

/**
 * Emitted when the HTML source view opens and closes, carrying the textarea.
 *
 * The extension point exists so an opt-in bundle can enhance the source box --
 * formatting, syntax highlighting -- without the element having to know anything
 * about it. Names are defined here rather than imported so the element keeps no
 * dependency on any plugin.
 */
export const SOURCE_OPEN_EVENT = 'openleaf:source-open'
export const SOURCE_CLOSE_EVENT = 'openleaf:source-close'

export class OpenLeafEditor extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['for', 'readonly', 'skin', 'theme']
  }

  /**
   * Appearance attributes are applied on change as well as at build time, so a
   * host that lets a person switch theme does not have to rebuild the editor --
   * which would cost them their undo history for a colour change.
   */
  attributeChangedCallback(name: string): void {
    if (name === 'skin') applySkin(this, this.getAttribute('skin'))
    if (name === 'theme') applyColourScheme(this, this.#colourScheme())
    if (name === 'readonly') this.#applyReadonly()
    if (name === 'for') this.#rebindTextarea()
  }

  #colourScheme(): ColourScheme {
    const value = this.getAttribute('theme')
    return value === 'light' || value === 'dark' ? value : 'auto'
  }

  #view: EditorView | null = null
  #toolbar: Toolbar | null = null
  #textarea: HTMLTextAreaElement | null = null
  #form: HTMLFormElement | null = null
  #contentHost: HTMLDivElement | null = null
  #sourceArea: HTMLTextAreaElement | null = null
  #sourceMode = false
  #deferred = false
  /** The schema this editor was built with. Fixed for its lifetime. */
  #schema = coreSchema()
  #basePlugins: Plugin[] = []
  #pluginCache = new Map<EditorPluginFactory, Plugin[]>()
  #unwatchPlugins: (() => void) | undefined
  #unwatchSchema: (() => void) | undefined
  #onSubmit = (): void => this.#syncToTextarea()
  #onFormData = (event: FormDataEvent): void => {
    this.#syncToTextarea()
    // formdata fires after the browser has already built event.formData from
    // the current controls. Updating textarea.value does not change that
    // snapshot; the entry has to be written onto the FormData itself.
    if (this.#textarea?.name) event.formData.set(this.#textarea.name, this.#textarea.value)
  }
  #onReset = (): void => {
    // The reset event fires *before* the controls are restored -- read
    // textarea.value in the handler and it is still the edited text. The
    // microtask runs after the reset algorithm finishes, which is the first
    // point the default is actually readable. Removing it re-loads the
    // editor with the content the reset was meant to discard.
    queueMicrotask(() => {
      if (this.#textarea) this.value = this.#textarea.value
    })
  }

  /**
   * Build the editor -- but not before the document's scripts have run.
   *
   * A custom element upgrades at the microtask checkpoint that ends the script
   * defining it, so `connectedCallback` fires BEFORE the next `<script>` tag
   * executes. Every documented integration loads plugin bundles as later script
   * tags, which means they register after this point.
   *
   * ProseMirror plugins survive that, because `state.reconfigure` can swap them
   * into a live editor. A schema cannot: `reconfigure` keeps the old schema by
   * construction. So an editor built at upgrade time could never contain a
   * plugin's node types -- not as an edge case, but in every shipped layout.
   *
   * Waiting for `DOMContentLoaded` closes that gap for the whole two-script-tag
   * model. The editor already appears asynchronously via element upgrade, so
   * nothing about this is visible to an author.
   */
  connectedCallback(): void {
    if (this.#view || this.#deferred) return

    if (this.ownerDocument.readyState === 'loading') {
      this.#deferred = true
      this.ownerDocument.addEventListener(
        'DOMContentLoaded',
        () => {
          this.#deferred = false
          if (this.isConnected && !this.#view) this.#build()
        },
        { once: true },
      )
      return
    }
    this.#build()
  }

  #build(): void {
    registerDefaultItems()
    ensureStyles(this.ownerDocument)
    ensureSkins(this.ownerDocument)
    applySkin(this, this.getAttribute('skin'))
    applyColourScheme(this, this.#colourScheme())

    this.#textarea = this.#findTextarea()
    const initialHtml = this.#textarea?.value ?? this.innerHTML
    const nestedTextarea =
      this.#textarea && this.contains(this.#textarea) ? this.#textarea : null
    // Nested binding used to `innerHTML = ''` the textarea out of the document,
    // so it was no longer a successful form control. Lift it aside first, then
    // put it back hidden so the form still posts it.
    nestedTextarea?.remove()
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

    this.#schema = coreSchema()

    this.#view = new EditorView(contentHost, {
      state: EditorState.create({
        doc: parseHtml(initialHtml, { schema: this.#schema }),
        plugins: [...this.#basePlugins, ...createRegisteredPlugins(this.#schema, this.#pluginCache)],
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

        // Persistence comes FIRST, and deliberately so. The document is already
        // committed by the line above; nothing about writing it out should
        // depend on chrome rendering succeeding. With this the other way round,
        // a third-party toolbar predicate that threw on one keystroke threw on
        // every keystroke after it, and the textarea sync plus this event never
        // ran again for the rest of the session -- an autosave listening here
        // would stop silently and the author would lose work.
        if (tr.docChanged) {
          this.#syncToTextarea()
          this.dispatchEvent(new CustomEvent('openleaf:change', { bubbles: true }))
        }

        // Passing the transaction lets the toolbar tell a formatting change from
        // a cursor move, which is what keeps its announcements useful instead of
        // chatty. Guarded because everything it calls may be third-party code.
        try {
          this.#toolbar?.update(view.state, tr)
        } catch (error) {
          console.error('@openleaf/element: toolbar update failed', error)
        }
      },
    })

    this.#toolbar?.mount(this.#view)
    this.addEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)

    if (nestedTextarea) {
      nestedTextarea.hidden = true
      this.appendChild(nestedTextarea)
    }

    // An editor already on the page when a deferred bundle finishes loading
    // would otherwise never receive its plugins, and the author would find
    // table controls that do nothing. `reconfigure` keeps the document and the
    // undo history; rebuilding the state from scratch would discard both.
    this.#unwatchSchema = onSchemaExtensionsChange(() => {
      if (!this.#view) return
      if (coreSchema() === this.#schema) return
      console.warn(
        '@openleaf/element: a schema extension registered after this editor was ' +
          'built, so its node types are not available here. A document\'s schema is ' +
          'fixed when its editor is created -- load the plugin script before the ' +
          'editor, or reload the page. Editors created from now on will have it.',
      )
    })

    this.#unwatchPlugins = onEditorPluginsChange(() => {
      const view = this.#view
      if (!view) return
      view.updateState(
        view.state.reconfigure({
            plugins: [...this.#basePlugins, ...createRegisteredPlugins(this.#schema, this.#pluginCache)],
        }),
      )
      this.#toolbar?.update(view.state)
    })

    // Belt and braces: `submit` covers ordinary posts, `formdata` covers
    // fetch-based submissions built from a FormData snapshot.
    // Prefer the bound textarea's form: the documented `for` binding allows
    // the editor to live outside the <form>, next to a hidden textarea inside it.
    this.#form = this.#textarea?.form ?? this.closest('form')
    this.#form?.addEventListener('submit', this.#onSubmit)
    this.#form?.addEventListener('formdata', this.#onFormData)
    this.#form?.addEventListener('reset', this.#onReset)
    this.#syncToTextarea()
  }

  disconnectedCallback(): void {
    // Persist whatever is in the source box before tearing it down, so a
    // framework that moves the element does not drop unsaved HTML.
    this.#syncToTextarea()
    this.#teardownSource({ apply: false })
    this.#form?.removeEventListener('submit', this.#onSubmit)
    this.#form?.removeEventListener('formdata', this.#onFormData)
    this.#form?.removeEventListener('reset', this.#onReset)
    this.removeEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)
    this.#unwatchPlugins?.()
    this.#unwatchSchema?.()
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
    if (this.#sourceMode && this.#sourceArea) {
      this.#sourceArea.value = html
      this.#syncToTextarea()
      return
    }
    if (!this.#view) {
      if (this.#textarea) this.#textarea.value = html
      return
    }
    this.#replaceDocument(html)
  }

  /** Escape hatch for plugins and integrations that need the real view. */
  get view(): EditorView | null {
    return this.#view
  }

  /** The schema this editor was built with. */
  get schema(): import('prosemirror-model').Schema {
    return this.#schema
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
      area.readOnly = this.hasAttribute('readonly')
      area.value = serializeHtml(view.state.doc)
      contentHost.hidden = true
      contentHost.after(area)
      this.#sourceArea = area
      this.#sourceMode = true
      this.#toolbar?.setItemState('source', { active: true })
      // Announced before focus so an enhancer can wrap the textarea while it is
      // still inert; focusing first would move the caret and then move the
      // element out from under it.
      this.dispatchEvent(
        new CustomEvent(SOURCE_OPEN_EVENT, { bubbles: true, detail: { textarea: area } }),
      )
      area.focus()
      return
    }

    // `apply: false` under readonly: the source box is read-only there, so
    // there is nothing to write back and parsing it would be a no-op that
    // still lands a transaction.
    this.#teardownSource({ apply: !this.hasAttribute('readonly') })
    contentHost.hidden = false
    this.#toolbar?.setItemState('source', { active: false })
    view.focus()
  }

  /**
   * Leave source mode.
   *
   * `apply: false` is disconnect: fire the close event so enhancers can
   * tear down, but do not parse the leftover textarea back into a view that
   * is about to be destroyed.
   */
  #teardownSource(options: { apply: boolean }): void {
    const area = this.#sourceArea
    const view = this.#view
    if (!area) {
      this.#sourceMode = false
      return
    }
    this.dispatchEvent(
      new CustomEvent(SOURCE_CLOSE_EVENT, { bubbles: true, detail: { textarea: area } }),
    )
    const html = area.value
    area.remove()
    this.#sourceArea = null
    this.#sourceMode = false
    if (options.apply && view) {
      // Compare documents, not strings. A source-view enhancer is free to
      // pretty-print the HTML for display, and that indentation parses to the
      // same document. Comparing the text would call it an edit, so merely
      // looking at the source would land an undo step and fire
      // openleaf:change -- the two things leaving source is meant not to do.
      this.#replaceDocument(html, { onlyIfChanged: true })
    }
  }

  /**
   * Replace the document with a transaction, so undo and change events survive.
   *
   * `onlyIfChanged` skips the dispatch when the HTML parses to the document
   * already on screen.
   */
  #replaceDocument(html: string, options?: { onlyIfChanged?: boolean }): void {
    const view = this.#view
    if (!view) return
    const next = parseHtml(html, { schema: this.#schema })
    if (options?.onlyIfChanged && next.eq(view.state.doc)) return
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
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

  #applyReadonly(): void {
    // `editable()` already reads the attribute; the view has to be told to
    // re-evaluate it. Without this, adding readonly after mount leaves
    // contenteditable="true" until some unrelated transaction.
    this.#view?.setProps({})
    if (this.#sourceArea) this.#sourceArea.readOnly = this.hasAttribute('readonly')
    if (this.#view) this.#toolbar?.update(this.#view.state)
  }

  #rebindTextarea(): void {
    if (!this.#view) return
    this.#textarea = this.#findTextarea()
    this.#syncToTextarea()
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
