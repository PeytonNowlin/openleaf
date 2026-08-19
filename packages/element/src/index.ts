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
 *   for              id of the textarea to bind to
 *   skin             named appearance: midnight, paper, contrast, compact
 *   theme            light | dark | auto (default: follow the visitor's system)
 *   toolbar          space-separated item ids, `|` for a separator; `none` to omit
 *   toolbar2         a second toolbar, same grammar
 *   menubar          space-separated menu ids, or omit to hide; `none` also hides
 *   contextmenu      `none` to disable; default is link, image and table menus
 *   selection-toolbar floating bar for a non-empty selection; `none` disables
 *   insert-toolbar    floating bar for an empty block; `none` disables
 *   formats          `p.lead=Lead|h2=Section` entries for the formats dropdown
 *   content-css      comma-separated URLs scoped onto the canvas
 *   lang             UI locale, matched against registerTranslations()
 *   inline           hide chrome until the editor is focused
 *   autoresize       grow the canvas with the document
 *   toolbar-overflow collapse overflowing groups into a More menu
 *   readonly         render but do not allow editing
 *   aria-label       accessible name for the editable region
 */

import {
  autolinkPlugin,
  buildKeymap,
  coreSchema,
  createRegisteredPlugins,
  insertImage,
  nonEditablePlugin,
  onEditorPluginsChange,
  onSchemaExtensionsChange,
  parseFormatList,
  parseHtml,
  serializeHtml,
  visualAidsPlugin,
  type EditorPluginFactory,
} from '@openleaf-editor/core'
import { normalizePastedHtml } from '@openleaf-editor/paste'
import {
  DEFAULT_INSERT_LAYOUT,
  DEFAULT_SELECTION_LAYOUT,
  FULLSCREEN_TOGGLE_EVENT,
  FloatingToolbars,
  IMAGE_CONTEXT_ITEMS,
  LINK_CONTEXT_ITEMS,
  MenuBar,
  PopupMenu,
  SOURCE_TOGGLE_EVENT,
  selectMenus,
  TABLE_CONTEXT_ITEMS,
  Toolbar,
  VISUAL_AIDS_TOGGLE_EVENT,
  applyColourScheme,
  applySkin,
  canUploadImages,
  contentCssUrls,
  ensureSkins,
  ensureStyles,
  imageFilesFrom,
  imageUploaderFor,
  loadContentCss,
  promptForImage,
  promptHelp,
  registerDefaultItems,
  runUploader,
  type ColourScheme,
} from '@openleaf-editor/ui'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, Plugin, TextSelection } from 'prosemirror-state'
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
    return ['for', 'readonly', 'skin', 'theme', 'lang']
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
    if (name === 'lang') this.#applyLocale()
  }

  #colourScheme(): ColourScheme {
    const value = this.getAttribute('theme')
    return value === 'light' || value === 'dark' ? value : 'auto'
  }

  #view: EditorView | null = null
  #toolbar: Toolbar | null = null
  #toolbar2: Toolbar | null = null
  #menubar: MenuBar | null = null
  #contextMenu: PopupMenu | null = null
  #floating: FloatingToolbars | null = null
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
  #resizeObserver: ResizeObserver | null = null
  #visualAids = true
  #fullscreen = false
  /** True while a real fullscreen session is ours, as opposed to the fallback. */
  #nativeFullscreen = false
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
    if (this.hasAttribute('inline')) this.classList.add('ol-inline')
    if (this.hasAttribute('autoresize')) this.classList.add('ol-autoresize')
    this.#visualAids = this.getAttribute('visualaids') !== 'false'
    if (this.#visualAids) this.classList.add('ol-visual-aids')

    const formats = parseFormatList(this.getAttribute('formats'))
    const overflow = this.hasAttribute('toolbar-overflow')
    const layout = this.getAttribute('toolbar')
    const wantsToolbar = layout !== 'none'
    const menubarAttr = this.getAttribute('menubar')
    const wantsMenubar = menubarAttr !== null && menubarAttr !== 'none'

    if (wantsMenubar) {
      // The attribute is a list, not a flag: `menubar="edit help"` asks for those
      // two menus in that order. An unrecognised list leaves no menubar rather
      // than an empty one with nothing in it.
      const menus = selectMenus(menubarAttr)
      if (menus.length > 0) {
        this.#menubar = new MenuBar(this, this.ownerDocument, menus, this.getAttribute('lang'))
        this.appendChild(this.#menubar.el)
      }
    }

    if (wantsToolbar) {
      this.#toolbar = new Toolbar(this, this.ownerDocument, {
        ...(layout ? { layout } : {}),
        overflow,
        formats,
        locale: this.getAttribute('lang'),
      })
      this.appendChild(this.#toolbar.el)
    }

    const toolbar2 = this.getAttribute('toolbar2')
    if (toolbar2 && toolbar2 !== 'none') {
      this.#toolbar2 = new Toolbar(this, this.ownerDocument, {
        layout: toolbar2,
        label: 'More formatting',
        overflow,
        formats,
        locale: this.getAttribute('lang'),
      })
      this.appendChild(this.#toolbar2.el)
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

    // Held on the instance rather than built inline, because `reconfigure`
    // has to hand the view back the *same* history() it was created with.
    // Building a second one is what dropped undo when a plugin registered late.
    this.#basePlugins = [
      history(),
      keymap({
        'Alt-F10': () => {
          this.#toolbar?.focusToolbar()
          return true
        },
        F1: () => {
          promptHelp(this.ownerDocument)
          return true
        },
      }),
      keymap(buildKeymap()),
      keymap(baseKeymap),
      nonEditablePlugin(),
    ]
    if (this.getAttribute('autolink') !== 'false') this.#basePlugins.push(autolinkPlugin())
    if (this.#visualAids) this.#basePlugins.push(visualAidsPlugin())

    this.#schema = coreSchema()

    this.#view = new EditorView(contentHost, {
      state: EditorState.create({
        doc: parseHtml(initialHtml, { schema: this.#schema }),
        // Plugins contributed by opt-in bundles. The cache is per editor, so
        // instances are still never shared between two editors -- each carries
        // its own state and two editors sharing one would fight over it -- but
        // reconfiguring this editor reuses its own, which is what stops a late
        // registration resetting the plugin state of the ones already running.
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
      // Dropping or pasting an image file is the way most people expect to add
      // one, and both arrive as a File rather than as markup.
      handleDrop: (view, event) => this.#handleImageFiles(view, event, event.dataTransfer),
      handlePaste: (view, event) => this.#handleImageFiles(view, event, event.clipboardData),
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
          this.#toolbar2?.update(view.state, tr)
          this.#floating?.update(view.state)
        } catch (error) {
          console.error('@openleaf-editor/element: toolbar update failed', error)
        }
      },
    })

    this.#toolbar?.mount(this.#view)
    this.#toolbar2?.mount(this.#view)
    this.#menubar?.mount(this.#view)
    this.#mountFloating()
    this.#mountContextMenu()
    this.#mountInline()
    this.#mountAutoresize()
    void this.#mountContentCss()
    this.addEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)
    this.addEventListener(FULLSCREEN_TOGGLE_EVENT, this.#onToggleFullscreen)
    this.ownerDocument.addEventListener('fullscreenchange', this.#onFullscreenChange)
    this.addEventListener(VISUAL_AIDS_TOGGLE_EVENT, this.#onToggleVisualAids)

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
        '@openleaf-editor/element: a schema extension registered after this editor was ' +
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
          plugins: [
            ...this.#basePlugins,
            ...createRegisteredPlugins(this.#schema, this.#pluginCache),
          ],
        }),
      )
      this.#toolbar?.update(view.state)
      this.#toolbar2?.update(view.state)
      this.#floating?.update(view.state)
    })

    // Belt and braces: `submit` covers ordinary posts, `formdata` covers
    // fetch-based submissions built from a FormData snapshot.
    // Prefer the bound textarea's form: the documented `for` binding allows
    // the editor to live outside the <form>, next to a hidden textarea inside it.
    this.#form = this.#textarea?.form ?? this.closest('form')
    this.#form?.addEventListener('submit', this.#onSubmit)
    this.#form?.addEventListener('formdata', this.#onFormData)
    this.#form?.addEventListener('reset', this.#onReset)
    this.#toolbar?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar2?.setItemState('visualAids', { active: this.#visualAids })
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
    this.removeEventListener(FULLSCREEN_TOGGLE_EVENT, this.#onToggleFullscreen)
    this.ownerDocument.removeEventListener('fullscreenchange', this.#onFullscreenChange)
    this.removeEventListener(VISUAL_AIDS_TOGGLE_EVENT, this.#onToggleVisualAids)
    this.removeEventListener('contextmenu', this.#onContextMenu)
    this.ownerDocument.removeEventListener('pointerdown', this.#onContextPointer, true)
    this.removeEventListener('focusin', this.#onInlineFocus)
    this.removeEventListener('focusout', this.#onInlineBlur)
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#unwatchPlugins?.()
    this.#unwatchSchema?.()
    this.#floating?.destroy()
    this.#floating = null
    this.#contextMenu?.destroy()
    this.#contextMenu = null
    this.#menubar?.destroy()
    this.#menubar = null
    this.#toolbar2?.destroy()
    this.#toolbar2 = null
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
      this.#toolbar2?.setItemState('source', { active: true })
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
    this.#toolbar2?.setItemState('source', { active: false })
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

  /**
   * Claim a drop or paste that carries image files.
   *
   * Returns false -- declining, so ProseMirror and anything listening further up
   * behave as they did -- unless this editor can actually upload. A drop that is
   * intercepted and then silently does nothing is worse than one that falls
   * through to the browser.
   *
   * `stopPropagation` is not tidiness. The import bundle listens for file drops
   * at the DOCUMENT level and claims any drop over an editor, so without it a
   * dropped PNG would be handled here AND handed to the import converters, which
   * would announce that they cannot read a .png over the top of a working upload.
   */
  #handleImageFiles(
    view: EditorView,
    event: DragEvent | ClipboardEvent,
    transfer: DataTransfer | null,
  ): boolean {
    if (this.hasAttribute('readonly')) return false
    if (!canUploadImages(this)) return false
    const files = imageFilesFrom(transfer)
    if (files.length === 0) return false

    event.preventDefault()
    event.stopPropagation()

    // Insert where the author dropped, not where the caret happens to be. The
    // position is resolved now, while the coordinates are still meaningful: the
    // dialog that follows is modal and the pointer will have moved.
    if (event instanceof DragEvent) {
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (at) {
        view.dispatch(
          view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))),
        )
      }
    }

    void this.#uploadImages(view, files)
    return true
  }

  /**
   * Upload dropped files one at a time, asking for a description of each.
   *
   * Sequential rather than concurrent, and it is a deliberate trade of speed for
   * a property worth more: every image OpenLeaf inserts has been described or
   * explicitly marked decorative. Uploading in parallel would mean either
   * stacking modal dialogs or inserting undescribed images and asking later --
   * and "later" has no UI, because there is no image-editing dialog yet.
   */
  async #uploadImages(view: EditorView, files: readonly File[]): Promise<void> {
    const uploader = imageUploaderFor(this)
    if (!uploader) return

    for (const file of files) {
      const result = await promptForImage(this.ownerDocument, {
        file,
        upload: (chosen) => runUploader(uploader, chosen, this),
        host: this,
      })
      // A cancelled description skips this file and moves to the next, rather
      // than abandoning the rest of a multi-file drop.
      if (!result) continue
      insertImage({
        src: result.src,
        alt: result.alt,
        title: result.title,
        width: result.width,
        height: result.height,
        align: result.align,
        className: result.className,
        ...(result.caption ? { caption: result.caption } : {}),
      })(view.state, view.dispatch, view)
    }
    view.focus()
  }

  #applyReadonly(): void {
    // `editable()` already reads the attribute; the view has to be told to
    // re-evaluate it. Without this, adding readonly after mount leaves
    // contenteditable="true" until some unrelated transaction.
    this.#view?.setProps({})
    if (this.#sourceArea) this.#sourceArea.readOnly = this.hasAttribute('readonly')
    if (this.#view) {
      this.#toolbar?.update(this.#view.state)
      this.#toolbar2?.update(this.#view.state)
    }
  }

  /**
   * Relabel this editor's chrome for its own `lang`.
   *
   * Deliberately not `setUiLocale`, which is the document-wide default: two
   * editors with different `lang` values on one page both ended up in whichever
   * built last, because every subscribed toolbar re-rendered on the change.
   */
  #applyLocale(): void {
    const lang = this.getAttribute('lang')
    this.#toolbar?.setLocale(lang)
    this.#toolbar2?.setLocale(lang)
  }

  #mountFloating(): void {
    const view = this.#view
    if (!view) return
    const selection = this.getAttribute('selection-toolbar')
    const insert = this.getAttribute('insert-toolbar')
    const selectionLayout =
      selection === null ? null : selection === 'none' ? null : selection || DEFAULT_SELECTION_LAYOUT
    const insertLayout =
      insert === null ? null : insert === 'none' ? null : insert || DEFAULT_INSERT_LAYOUT
    if (!selectionLayout && !insertLayout) return
    this.#floating = new FloatingToolbars(this, this.ownerDocument, {
      selectionLayout,
      insertLayout,
    })
    this.#floating.mount(view)
  }

  #mountContextMenu(): void {
    if (this.getAttribute('contextmenu') === 'none') return
    this.#contextMenu = new PopupMenu(this, this.ownerDocument)
    if (this.#view) this.#contextMenu.attach(this.#view)
    this.appendChild(this.#contextMenu.el)
    this.addEventListener('contextmenu', this.#onContextMenu)
    this.ownerDocument.addEventListener('pointerdown', this.#onContextPointer, true)
  }

  #onContextPointer = (event: PointerEvent): void => {
    const menu = this.#contextMenu
    if (!menu?.open) return
    if (event.target instanceof Node && menu.el.contains(event.target)) return
    menu.close()
  }

  #onContextMenu = (event: MouseEvent): void => {
    const view = this.#view
    const menu = this.#contextMenu
    if (!view || !menu) return
    const target = event.target
    if (!(target instanceof Element) || !this.#contentHost?.contains(target)) return

    const items = target.closest('a')
      ? LINK_CONTEXT_ITEMS
      : target.closest('img')
        ? IMAGE_CONTEXT_ITEMS
        : target.closest('table')
          ? TABLE_CONTEXT_ITEMS
          : null
    if (!items) return
    event.preventDefault()
    menu.show(items, event.clientX, event.clientY, () => view.focus())
  }

  #mountInline(): void {
    if (!this.hasAttribute('inline')) return
    this.addEventListener('focusin', this.#onInlineFocus)
    this.addEventListener('focusout', this.#onInlineBlur)
  }

  #onInlineFocus = (): void => {
    this.classList.add('ol-inline-active')
  }

  #onInlineBlur = (event: FocusEvent): void => {
    const next = event.relatedTarget
    if (next instanceof Node && this.contains(next)) return
    this.classList.remove('ol-inline-active')
  }

  #mountAutoresize(): void {
    const host = this.#contentHost
    const view = this.#view
    if (!host || !view || !this.hasAttribute('autoresize')) return
    const apply = (): void => {
      const pm = host.querySelector<HTMLElement>('.ProseMirror')
      if (!pm) return
      pm.style.height = 'auto'
      pm.style.height = `${pm.scrollHeight}px`
    }
    apply()
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(apply)
      this.#resizeObserver.observe(host)
    }
  }

  async #mountContentCss(): Promise<void> {
    const urls = contentCssUrls(this.getAttribute('content-css'))
    if (urls.length === 0) return
    await loadContentCss(this.ownerDocument, urls)
  }

  #applyFullscreen(active: boolean): void {
    this.#fullscreen = active
    this.classList.toggle('ol-fullscreen', active)
    this.#toolbar?.setItemState('fullscreen', { active })
    this.#toolbar2?.setItemState('fullscreen', { active })
  }

  /**
   * Reconcile with a fullscreen session that ended somewhere else.
   *
   * Escape and the browser's own control leave fullscreen without going through
   * the toolbar. The `ol-fullscreen` class carries the fixed-position fallback,
   * so left set it kept the editor covering the page, and the next press of the
   * button only cleared the stale state instead of entering fullscreen.
   *
   * Guarded on `#nativeFullscreen`, because no `fullscreenchange` fires when
   * `requestFullscreen` is unavailable and the class-based fallback is all there
   * is -- an event about some other element must not tear that down.
   */
  #onFullscreenChange = (): void => {
    const native = this.ownerDocument.fullscreenElement === this
    if (native) this.#applyFullscreen(true)
    else if (this.#nativeFullscreen) this.#applyFullscreen(false)
    this.#nativeFullscreen = native
  }

  #onToggleFullscreen = (): void => {
    const next = !this.#fullscreen
    this.#applyFullscreen(next)
    if (next) {
      void Promise.resolve(this.requestFullscreen?.()).catch(() => {
        /* class-based fallback already applied */
      })
    } else if (this.ownerDocument.fullscreenElement === this) {
      void this.ownerDocument.exitFullscreen?.()
    }
    this.#view?.focus()
  }

  #onToggleVisualAids = (): void => {
    this.#visualAids = !this.#visualAids
    this.classList.toggle('ol-visual-aids', this.#visualAids)
    this.#toolbar?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar2?.setItemState('visualAids', { active: this.#visualAids })
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
export { normalizePastedHtml } from '@openleaf-editor/paste'

/**
 * Re-exported so a plain `<script>` integration can register an upload endpoint
 * without a build step: `OpenLeaf.registerImageUploader(fn)`. Setting
 * `element.imageUploader` overrides it for one editor.
 */
export {
  registerFilePicker,
  registerImageClasses,
  registerImageList,
  registerImageUploader,
  registerLinkList,
  registerTranslations,
  setUiLocale,
  type FilePicker,
  type FilePickerKind,
  type ImageUploadResult,
  type ImageUploader,
  type ListedResource,
  type PickedResource,
} from '@openleaf-editor/ui'

/** Idempotent: safe to import twice, or alongside a bundled copy. */
export function defineOpenLeafEditor(tag = 'openleaf-editor'): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tag)) return
  customElements.define(tag, OpenLeafEditor)
}

defineOpenLeafEditor()
