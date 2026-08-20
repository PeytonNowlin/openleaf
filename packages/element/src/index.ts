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
  disclosurePlugin,
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
  type MenuEntry,
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
  announce,
  imageUploaderFor,
  liveRegion,
  loadContentCss,
  promptForImage,
  promptHelp,
  registerDefaultItems,
  runUploader,
  t,
  withLocale,
  type ColourScheme,
} from '@openleaf-editor/ui'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, NodeSelection, Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { FormBridge } from './form-bridge.js'

let hintCounter = 0

/**
 * Emitted when the HTML source view opens and closes, carrying the textarea.
 *
 * The extension point exists so an opt-in bundle can enhance the source box --
 * formatting, syntax highlighting -- without the element having to know anything
 * about it. Names are defined here rather than imported so the element keeps no
 * dependency on any plugin.
 *
 * These fire on a REAL teardown, not on a DOM move. Moving the element keeps
 * the whole session -- including source mode and the same textarea node -- so
 * an enhancer that attached on open stays correctly attached, and gets its
 * close only when the element is actually removed for good.
 */
export const SOURCE_OPEN_EVENT = 'openleaf:source-open'
export const SOURCE_CLOSE_EVENT = 'openleaf:source-close'

// Evaluating a custom-element module must be safe during SSR. Registration and
// construction still happen only in a browser, but framework servers routinely
// import their component modules while rendering a route.
const HTMLElementBase = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement

export class OpenLeafEditor extends HTMLElementBase {
  static get observedAttributes(): string[] {
    // `aria-label` is observed because a framework changes it after mount far
    // more often than it sets it once: a React editor whose label came from
    // props never reached the editable region at all.
    return ['for', 'readonly', 'skin', 'theme', 'lang', 'aria-label']
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
    if (name === 'for' && this.#view) {
      this.#formBridge.rebind()
      // The name may have come from the old textarea's <label>.
      this.#view.setProps({})
    }
    if (name === 'lang') this.#applyLocale()
    if (name === 'aria-label') {
      this.#applyHostRole()
      this.#view?.setProps({})
    }
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
  #formBridge = new FormBridge(this, () => this.value, (html) => { this.value = html })
  #contentHost: HTMLDivElement | null = null
  /** The Alt+F10 hint, when there is a toolbar for it to describe. */

    // Unconditionally, and not from whichever bar happens to exist. A layout of
    // `toolbar="none" toolbar2="bold italic"` used to mount no region at all, so
    // Ctrl+B was silent -- the failure the whole announcement design exists to
    // prevent. One region per editor, shared by every bar on it.
    liveRegion(this)

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
          promptHelp(this.ownerDocument, this)
          return true
        },
      }),
      keymap(buildKeymap()),
      keymap(baseKeymap),
      nonEditablePlugin(),
      disclosurePlugin(),
    ]
    if (this.getAttribute('autolink') !== 'false') this.#basePlugins.push(autolinkPlugin())
    if (this.#visualAids) this.#basePlugins.push(visualAidsPlugin())

    this.#schema = coreSchema()
    // Cleared before the view exists, so a transaction dispatched during mount
    // is counted as a real change rather than wiped by a later reset.
    this.#docTouched = false

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
      // A function, not a literal. The literal was evaluated once at
      // construction, so `readonly` added later never reached the region and a
      // label changed later never reached it either -- both of which are the
      // ordinary case, not an edge one.
      attributes: () => this.#regionAttributes(),
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
          this.#docTouched = true
          this.#formBridge.sync()
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

    // Live from here on. Set as soon as there is something to tear down rather
    // than at the end of the build: anything below this line may throw --
    // mounting third-party chrome, serializing a document that contains a
    // plugin's node type -- and a view that teardown refuses to touch is a
    // permanent leak with a destroyed editor's listeners still attached.
    this.#built = true
    this.#boundDoc = this.ownerDocument

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
    this.#formBridge.attach()
    const aidsState = { active: this.#visualAids, enabled: this.#visualAidsAvailable }
    this.#toolbar?.setItemState('visualAids', aidsState)
    this.#toolbar2?.setItemState('visualAids', aidsState)
    this.#formBridge.sync()
  }

  /**
   * Tear down -- but only once the element is really gone.
   *
   * Moving a node fires disconnect and then connect SYNCHRONOUSLY, so a guard
   * in `connectedCallback` can never help: by the time it runs the view has
   * already been destroyed. Deferring the decision by one microtask makes a
   * move a no-op, which is what keeps undo history, selection and every
   * plugin's state alive across a keyed-list reorder, an `insertBefore`
   * shuffle or a drag-to-reorder.
   *
   * The limit is worth being precise about, because it is not "unmounting is
   * safe now": this only covers a move completed within one task. Anything that
   * parks the element in a detached container across ticks -- Vue's
   * `<KeepAlive>` does exactly that -- is a real removal and tears down, which
   * is why the rebuild path has to stay correct rather than merely unreachable.
   */
  disconnectedCallback(): void {
    // Persist whatever is in the source box before tearing it down, so a
    // framework that moves the element does not drop unsaved HTML. This part
    // stays synchronous: the value has to be in the textarea even if the
    // element is removed on the way into a form submission.
    this.#formBridge.sync()
    // Snapshot the document HERE rather than in the microtask below. A
    // reconnection rebuilds from this instead of from the chrome left in the
    // subtree -- and serializing needs a live document, which is not
    // guaranteed by the time a deferred callback runs (a closing page, or a
    // test environment being torn down). Guarded on `#built` so a disconnect
    // before the first build cannot record an empty document over the
    // element's real markup.
    if (this.#built) this.#initialHtml = this.value
    queueMicrotask(() => {
      if (this.isConnected) return
      this.#teardown()
    })
  }

  /** Idempotent: two queued teardowns, or a teardown after one, do nothing. */
  #teardown(): void {
    if (!this.#built) return
    this.#built = false

    // The document the listeners went ON, which is not necessarily the one this
    // element belongs to now -- see #boundDoc.
    const doc = this.#boundDoc ?? this.ownerDocument
    this.#boundDoc = null

    this.#teardownSource({ apply: false })
    this.#formBridge.detach()
    this.removeEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)
    this.removeEventListener(FULLSCREEN_TOGGLE_EVENT, this.#onToggleFullscreen)
    doc.removeEventListener('fullscreenchange', this.#onFullscreenChange)
    this.removeEventListener(VISUAL_AIDS_TOGGLE_EVENT, this.#onToggleVisualAids)
    this.removeEventListener('contextmenu', this.#onContextMenu)
    this.removeEventListener('keydown', this.#onContextKey, true)
    doc.removeEventListener('pointerdown', this.#onContextPointer, true)
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

    // Everything this element appended goes with it. Chrome left behind is not
    // just a leak: `#build()` reads `this.innerHTML` as a last resort, so
    // leftovers become the next document.
    this.#contentHost?.remove()
    this.#contentHost = null
    this.#hint?.remove()
    this.#hint = null

    // Presentation state goes too. `ol-fullscreen` is fixed-position, inset 0,
    // at the top of the stacking order, and nothing re-applies it on a rebuild
    // -- so an editor removed while fullscreen used to come back as an opaque
    // full-viewport overlay whose toolbar button showed inactive.
    this.#fullscreen = false
    this.#nativeFullscreen = false
    this.classList.remove(
      'ol-fullscreen',
      'ol-inline-active',
      'ol-editor',
      'ol-inline',
      'ol-autoresize',
      'ol-visual-aids',
    )
  }

  /** Current document as an HTML string. */
  get value(): string {
    if (this.#sourceMode && this.#sourceArea) return this.#sourceArea.value
    // After a teardown there is no view, but the document is not gone: it was
    // snapshotted on disconnect. Without `#initialHtml` here an unbound editor
    // reports an empty document the moment it is unmounted, which is the same
    // content loss this fix exists to stop -- just read back rather than
    // rebuilt.
    if (!this.#view) {
      return this.#pendingValue ?? this.#formBridge.textarea?.value ?? this.#initialHtml ?? ''
    }
    return serializeHtml(this.#view.state.doc)
  }

  set value(html: string) {
    if (this.#sourceMode && this.#sourceArea) {
      this.#sourceArea.value = html
      this.#formBridge.sync()
      return
    }
    if (!this.#view) {
      // No view to receive it: either the build has not happened yet (an
      // assignment before upgrade, or while waiting for DOMContentLoaded) or it
      // has been torn down. Hold it for the next build rather than dropping it.
      this.#pendingValue = html
      if (this.#formBridge.textarea) this.#formBridge.textarea.value = html
      return
    }
    // `onlyIfChanged` makes assignment idempotent: `el.value = el.value` is a
    // no-op instead of an undo step, a change event and a collapsed selection.
    //
    // The mount-then-fill exception is narrow on purpose. Every wrapper renders
    // a bare element and pushes the server's HTML in afterwards, so that fill
    // lands on an untouched, empty document -- and making it undoable is what
    // let an author's FIRST Ctrl-Z wipe everything. An assignment onto a
    // document that already HAS content is a different thing entirely: it is a
    // "load template" or "reset draft" button replacing the author's work, and
    // that must stay undoable.
    this.#replaceDocument(html, {
      onlyIfChanged: true,
      addToHistory: this.#docTouched || !this.#isEmptyDocument(),
    })
  }

  /** An untouched editor holds one empty text block -- what a wrapper mounts. */
  #isEmptyDocument(): boolean {
    const doc = this.#view?.state.doc
    if (!doc) return true
    const first = doc.firstChild
    return doc.childCount <= 1 && (!first || (first.isTextblock && first.content.size === 0))
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
      area.setAttribute('aria-label', this.#localised('HTML source'))
      area.spellcheck = false
      area.readOnly = this.hasAttribute('readonly')
      area.value = serializeHtml(view.state.doc)
      contentHost.hidden = true
      contentHost.after(area)
      this.#sourceArea = area
      this.#sourceMode = true
      this.#toolbar?.setItemState('source', { active: true })
      this.#toolbar2?.setItemState('source', { active: true })
      // Every other control goes unavailable: a formatting command here runs
      // against the hidden document, which `#teardownSource` then reparses over
      // the top of. The mode change is announced because moving focus into a
      // textarea full of angle brackets, with no explanation, is disorienting.
      this.#toolbar?.setSourceMode(true)
      this.#toolbar2?.setSourceMode(true)
      announce(this, this.#localised('HTML source view'))
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
    this.#toolbar?.setSourceMode(false)
    this.#toolbar2?.setSourceMode(false)
    announce(this, this.#localised('Rich text view'))
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
   * already on screen. `addToHistory: false` keeps the replacement out of the
   * undo stack, for the mount-then-fill sequence every wrapper performs.
   */
  #replaceDocument(
    html: string,
    options?: { onlyIfChanged?: boolean; addToHistory?: boolean },
  ): void {
    const view = this.#view
    if (!view) return
    const next = parseHtml(html, { schema: this.#schema })
    if (options?.onlyIfChanged && next.eq(view.state.doc)) return

    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, next.content)
    // Replacing the whole document maps every old position onto the boundary,
    // so the caret would jump to the top on any programmatic assignment. Put it
    // back where the author left it, clamped to the new document.
    const at = Math.min(view.state.selection.from, tr.doc.content.size)
    tr.setSelection(TextSelection.near(tr.doc.resolve(at)))
    if (options?.addToHistory === false) tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }

  /* -------------------------------------------------------------- *
   * Textarea binding
   * -------------------------------------------------------------- */

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

  /* -------------------------------------------------------------- *
   * Accessible semantics of the editable region
   * -------------------------------------------------------------- */

  /**
   * The ARIA attributes ProseMirror puts on the editable region.
   *
   * Recomputed on every update rather than frozen at construction, which is
   * what makes `readonly` and a changing name observable at all.
   */
  #regionAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {
      role: 'textbox',
      'aria-multiline': 'true',
      // Always written, never omitted when false. `contenteditable="false"` is
      // not a signal any screen reader reports, so without this a read-only
      // editor announced "edit multiline", the author typed, and nothing
      // happened.
      'aria-readonly': this.hasAttribute('readonly') ? 'true' : 'false',
      'aria-label': this.#regionName(),
    }
    if (this.#hint) attributes['aria-describedby'] = this.#hint.id
    return attributes
  }

  /**
   * What this editor is called.
   *
   * The documented integration is `<label for="body">` beside
   * `<textarea id="body">`, and that label names the TEXTAREA -- the editable
   * region is a different element entirely, so it inherited nothing. Every
   * integrator who followed the README and did not also duplicate the text as
   * `aria-label` shipped an editor called "Rich text editor", and two of them on
   * one page were indistinguishable.
   */
  #regionName(): string {
    const explicit = this.getAttribute('aria-label')?.trim()
    if (explicit) return explicit
    const inherited = this.#formBridge.textarea?.labels?.[0]?.textContent?.trim()
    if (inherited) return inherited
    return this.#localised('Rich text editor')
  }

  /**
   * Give the host a role when, and only when, it carries `aria-label`.
   *
   * ARIA prohibits a label on a `generic` element, which is what
   * `<openleaf-editor>` is with no role of its own -- axe reports it as
   * `aria-prohibited-attr`. Adding the role unconditionally would instead have
   * every editor announce its name twice, once for the group and once for the
   * region inside it, so it is added exactly where the violation is.
   */
  #applyHostRole(): void {
    if (this.getAttribute('aria-label')?.trim()) this.setAttribute('role', 'group')
    else if (this.getAttribute('role') === 'group') this.removeAttribute('role')
  }

  /** A UI string in this editor's own `lang`, not the document-wide locale. */
  #localised(source: string): string {
    return withLocale(this.getAttribute('lang'), () => t(source))
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
    this.#floating?.setLocale(lang)
    if (this.#hint) {
      this.#hint.textContent = this.#localised('Press Alt plus F10 for the formatting toolbar.')
    }
    if (this.#sourceArea) {
      this.#sourceArea.setAttribute('aria-label', this.#localised('HTML source'))
    }
    // The region's own name may be the generic fallback, which is translated.
    this.#view?.setProps({})
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
      locale: this.getAttribute('lang'),
    })
    this.#floating.mount(view)
  }

  #mountContextMenu(): void {
    if (this.getAttribute('contextmenu') === 'none') return
    this.#contextMenu = new PopupMenu(this, this.ownerDocument)
    if (this.#view) this.#contextMenu.attach(this.#view)
    this.appendChild(this.#contextMenu.el)
    this.addEventListener('contextmenu', this.#onContextMenu)
    this.addEventListener('keydown', this.#onContextKey, true)
    this.ownerDocument.addEventListener('pointerdown', this.#onContextPointer, true)
  }

  #onContextPointer = (event: PointerEvent): void => {
    const menu = this.#contextMenu
    if (!menu?.open) return
    if (event.target instanceof Node && menu.el.contains(event.target)) return
    menu.close()
  }

  /**
   * Open the context menu from the keyboard.
   *
   * Shift+F10 and the Menu key were assumed to arrive as a synthesized
   * `contextmenu` event, and the handler was left to work out the rest. They do
   * not, reliably: Chromium fires no `contextmenu` for Shift+F10 at all when the
   * key is delivered to the renderer, so the documented keyboard entry point was
   * a no-op that no test could see, because no test pressed the key.
   *
   * Opening straight from the key is also the only way to get the two things
   * that follow right -- the node the caret is in, and a position to put the
   * menu at -- because neither is recoverable from a synthesized mouse event.
   */
  #onContextKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    const view = this.#view
    if (!view) return
    if (!this.#showContext(view, this.#contextItemsAtCaret(view.state), null)) return
    event.preventDefault()
  }

  /** Open a menu, at a point for a pointer or at the caret for a key. */
  #showContext(
    view: EditorView,
    items: readonly MenuEntry[] | null,
    point: { x: number; y: number } | null,
  ): boolean {
    const menu = this.#contextMenu
    if (!menu || !items) return false
    let x = point?.x ?? 0
    let y = point?.y ?? 0
    // A synthesized event carries the focused element's corner at best and 0,0
    // at worst; neither of them is where the caret is.
    if (!point || x <= 0) {
      const coords = view.coordsAtPos(view.state.selection.from)
      x = coords.left
      y = coords.bottom
    }
    menu.show(items, x, y, { label: 'Editor menu', onClose: () => view.focus() })
    return true
  }

  /**
   * What the menu is about, read from the document rather than the DOM.
   *
   * For a pointer the answer is whatever was clicked. For the keyboard it is
   * emphatically NOT `event.target`: the focused element is the ProseMirror
   * contenteditable div, and `closest()` walks UP from it, so it never found the
   * `<a>` or `<img>` the caret was in and the handler returned in silence. The
   * selection is the only thing that knows where the caret is, and asking the
   * document is more direct than mapping a position back to a node and walking
   * the tree from there.
   */
  #contextItemsAtCaret(state: EditorState): readonly MenuEntry[] | null {
    const selection = state.selection
    const $from = selection.$from
    const link = state.schema.marks['link']
    if (link && link.isInSet($from.marks())) return LINK_CONTEXT_ITEMS
    const node = selection instanceof NodeSelection ? selection.node : $from.nodeAfter
    if (node?.type.name === 'image') return IMAGE_CONTEXT_ITEMS
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === 'table') return TABLE_CONTEXT_ITEMS
    }
    return null
  }

  #onContextMenu = (event: MouseEvent): void => {
    const view = this.#view
    if (!view) return
    const clicked = event.target
    if (!(clicked instanceof Element) || !this.#contentHost?.contains(clicked)) return
    const items = clicked.closest('a')
      ? LINK_CONTEXT_ITEMS
      : clicked.closest('img')
        ? IMAGE_CONTEXT_ITEMS
        : clicked.closest('table')
          ? TABLE_CONTEXT_ITEMS
          : null
    if (this.#showContext(view, items, { x: event.clientX, y: event.clientY })) {
      event.preventDefault()
    }
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
    // `visualaids="false"` is read once, at build time, and the plugin that
    // draws the aids is never installed. The toggle still flipped aria-pressed,
    // so the button reported a feature as on that does not exist -- a lie a
    // screen reader repeats, and the one kind of state error ARIA cannot
    // recover from. The control is disabled instead.
    if (!this.#visualAidsAvailable) return
    this.#visualAids = !this.#visualAids
    this.classList.toggle('ol-visual-aids', this.#visualAids)
    this.#toolbar?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar2?.setItemState('visualAids', { active: this.#visualAids })
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
