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
  type ImageUploader,
  type ToolbarHandle,
} from '@openleaf-editor/ui'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Schema } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection } from 'prosemirror-state'
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
 */
export const SOURCE_OPEN_EVENT = 'openleaf:source-open'
export const SOURCE_CLOSE_EVENT = 'openleaf:source-close'

// Evaluating a custom-element module must be safe during SSR. Registration and
// construction still happen only in a browser, but framework servers routinely
// import their component modules while rendering a route.
const HTMLElementBase = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement

/**
 * Attributes that shape the chrome and take effect by rebuilding it.
 *
 * Each of these is read once while the toolbars, menubar, floating bars and
 * context menu are constructed, so applying a change means constructing them
 * again -- which `#rerenderChrome` does without touching the view, the document
 * or the undo history.
 */
const CHROME_ATTRIBUTES = [
  'toolbar',
  'toolbar2',
  'menubar',
  'formats',
  'contextmenu',
  'selection-toolbar',
  'insert-toolbar',
  'toolbar-overflow',
] as const

export class OpenLeafEditor extends HTMLElementBase {
  /**
   * Every attribute this element documents, not the five it used to observe.
   *
   * `observedAttributes` returned `['for','readonly','skin','theme','lang']`
   * while all three framework wrappers forwarded `toolbar`, `formats`,
   * `aria-label` and the rest as reactive bindings. So `setAttribute('toolbar',
   * 'bold')` after mount left all 22 default buttons in place and
   * `setAttribute('aria-label', ...)` left the editable region labelled "Rich
   * text editor" -- with no error either time. A prop that reactively does
   * nothing is worse than one that does not exist: an integrator ships it, QA
   * checks it once on mount, and it breaks on the first state change.
   */
  static get observedAttributes(): string[] {
    return [
      'for',
      'readonly',
      'skin',
      'theme',
      'lang',
      'aria-label',
      'inline',
      'autoresize',
      'visualaids',
      'autolink',
      'content-css',
      ...CHROME_ATTRIBUTES,
    ]
  }

  /**
   * Apply an attribute change to a running editor.
   *
   * Nothing here rebuilds the view, so a change costs neither the document nor
   * the undo history -- which is the whole reason these are applied incrementally
   * rather than by tearing the editor down. Every branch is a no-op before
   * `#build()` has run, because the callback also fires for attributes already
   * present at upgrade time.
   */
  attributeChangedCallback(name: string): void {
    switch (name) {
      case 'skin':
        applySkin(this, this.getAttribute('skin'))
        return
      case 'theme':
        applyColourScheme(this, this.#colourScheme())
        return
      case 'readonly':
        this.#applyReadonly()
        return
      case 'for':
        if (this.#view) this.#formBridge.rebind()
        return
      case 'lang':
        this.#applyLocale()
        return
      case 'aria-label':
        this.#view?.setProps({ attributes: this.#viewAttributes() })
        return
      case 'inline':
        this.#applyInline()
        return
      case 'autoresize':
        this.#applyAutoresize()
        return
      case 'visualaids':
        this.#applyVisualAids(this.getAttribute('visualaids') !== 'false')
        return
      case 'autolink':
        this.#reconfigurePlugins()
        return
      case 'content-css':
        void this.#mountContentCss()
        return
      default:
        this.#rerenderChrome()
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
  #sourceArea: HTMLTextAreaElement | null = null
  #sourceMode = false
  #deferred = false
  /** The schema this editor was built with. Fixed for its lifetime. */
  #schema = coreSchema()
  /**
   * The plugins that never change once built, held so `reconfigure` hands the
   * view back the *same* `history()` it was created with. Building a second one
   * is what dropped undo when a plugin registered late.
   */
  #corePlugins: Plugin[] = []
  /** Uploader for this editor alone, overriding `registerImageUploader`. */
  imageUploader: ImageUploader | null = null
  #hintId = ''
  #pluginCache = new Map<EditorPluginFactory, Plugin[]>()
  #unwatchPlugins: (() => void) | undefined
  #unwatchSchema: (() => void) | undefined
  #resizeObserver: ResizeObserver | null = null
  #visualAids = true
  #fullscreen = false
  /** True while a real fullscreen session is ours, as opposed to the fallback. */
  #nativeFullscreen = false

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

    const textarea = this.#formBridge.bind()
    const initialHtml = textarea?.value ?? this.innerHTML
    const nestedTextarea =
      textarea && this.contains(textarea) ? textarea : null
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

    const contentHost = this.ownerDocument.createElement('div')
    contentHost.className = 'ol-content'
    this.#contentHost = contentHost

    // The Alt+F10 hint lives in a hidden element referenced by
    // aria-describedby. Screen reader users cannot guess the shortcut, and
    // discoverability comes from telling them rather than from choosing a
    // guessable key.
    this.#hintId = `ol-hint-${(hintCounter += 1)}`

    // Chrome first, so the toolbars sit above the canvas in the DOM; the hint
    // and the live region go in afterwards.
    this.#buildChrome()

    // Held on the instance rather than built inline, because `reconfigure`
    // has to hand the view back the *same* history() it was created with.
    // Building a second one is what dropped undo when a plugin registered late.
    this.#corePlugins = [
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
      disclosurePlugin(),
    ]

    this.#schema = coreSchema()

    this.#view = new EditorView(contentHost, {
      state: EditorState.create({
        doc: parseHtml(initialHtml, { schema: this.#schema }),
        // Plugins contributed by opt-in bundles. The cache is per editor, so
        // instances are still never shared between two editors -- each carries
        // its own state and two editors sharing one would fight over it -- but
        // reconfiguring this editor reuses its own, which is what stops a late
        // registration resetting the plugin state of the ones already running.
        plugins: this.#allPlugins(),
      }),
      editable: () => !this.hasAttribute('readonly'),
      attributes: this.#viewAttributes(),
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
          // Serialized once and used twice: the textarea and the event detail
          // want the same string, and this runs on every keystroke.
          const value = this.value
          this.#formBridge.sync(value)
          this.#emitChange(value)
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

    this.#mountChrome()
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
      this.#reconfigurePlugins()
    })

    // Belt and braces: `submit` covers ordinary posts, `formdata` covers
    // fetch-based submissions built from a FormData snapshot.
    // Prefer the bound textarea's form: the documented `for` binding allows
    // the editor to live outside the <form>, next to a hidden textarea inside it.
    this.#formBridge.attach()
    this.#toolbar?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar2?.setItemState('visualAids', { active: this.#visualAids })
    this.#formBridge.sync()
  }

  /* -------------------------------------------------------------- *
   * Chrome, built once and rebuilt when an attribute changes
   * -------------------------------------------------------------- */

  /**
   * Construct the toolbars, menubar and canvas, in DOM order.
   *
   * Split out of `#build` so `#rerenderChrome` can run exactly the same code on
   * an attribute change. Everything here reads attributes and creates elements;
   * nothing touches the view, which is what makes re-running it safe.
   */
  #buildChrome(): void {
    const contentHost = this.#contentHost
    if (!contentHost) return

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

    // Appended, not re-created, so the view it already hosts is not disturbed by
    // a rebuild -- the canvas keeps its place under the new toolbars.
    this.appendChild(contentHost)

    const hint = this.ownerDocument.createElement('span')
    hint.id = this.#hintId
    hint.className = 'ol-live'
    hint.textContent = wantsToolbar
      ? 'Rich text editor. Press Alt plus F10 for the formatting toolbar.'
      : 'Rich text editor.'
    this.appendChild(hint)

    if (this.#toolbar) this.appendChild(this.#toolbar.liveRegion)
  }

  /** Give the freshly built chrome the view, and the state it cannot derive. */
  #mountChrome(): void {
    const view = this.#view
    if (!view) return
    this.#toolbar?.mount(view)
    this.#toolbar2?.mount(view)
    this.#menubar?.mount(view)
    this.#mountFloating()
    this.#mountContextMenu()
    this.#toolbar?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar2?.setItemState('visualAids', { active: this.#visualAids })
    this.#toolbar?.setItemState('source', { active: this.#sourceMode })
    this.#toolbar2?.setItemState('source', { active: this.#sourceMode })
    this.#toolbar?.setItemState('fullscreen', { active: this.#fullscreen })
    this.#toolbar2?.setItemState('fullscreen', { active: this.#fullscreen })
  }

  /** Tear the chrome down, leaving the canvas and the view untouched. */
  #destroyChrome(): void {
    this.removeEventListener('contextmenu', this.#onContextMenu)
    this.ownerDocument.removeEventListener('pointerdown', this.#onContextPointer, true)
    this.#floating?.destroy()
    this.#floating = null
    this.#contextMenu?.destroy()
    this.#contextMenu = null
    // `destroy()` unsubscribes and clears listeners but does not unparent, so
    // the elements are removed here. Missing this left a dead toolbar on the
    // page next to the live one.
    this.#menubar?.destroy()
    this.#menubar?.el.remove()
    this.#menubar = null
    this.#toolbar2?.destroy()
    this.#toolbar2?.el.remove()
    this.#toolbar2 = null
    this.#toolbar?.destroy()
    this.#toolbar?.el.remove()
    this.#toolbar?.liveRegion.remove()
    this.#toolbar = null
    this.ownerDocument.getElementById(this.#hintId)?.remove()
  }

  /**
   * Rebuild the chrome for a changed attribute, preserving everything else.
   *
   * The view, the document, the selection and the undo history all survive,
   * because none of them is touched: the canvas element is re-parented rather
   * than replaced. This is what makes `toolbar`, `menubar`, `formats` and the
   * rest safe to treat as reactive props, which all three wrappers already
   * did -- to no effect, before this existed.
   */
  #rerenderChrome(): void {
    if (!this.#view || !this.#contentHost) return
    this.#destroyChrome()
    this.#buildChrome()
    this.#mountChrome()
    this.#toolbar?.update(this.#view.state)
    this.#toolbar2?.update(this.#view.state)
  }

  /** The attributes ProseMirror puts on the editable region. */
  #viewAttributes(): Record<string, string> {
    return {
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': this.getAttribute('aria-label') ?? 'Rich text editor',
      'aria-describedby': this.#hintId,
    }
  }

  /**
   * The full plugin list: the fixed core, the two attribute-driven optionals,
   * then whatever the registry holds.
   *
   * The optionals are recomputed rather than held, so `autolink` and `visualaids`
   * can change after mount; the core list is not, so `history()` stays the same
   * instance across every reconfigure and undo survives.
   */
  #allPlugins(): Plugin[] {
    const plugins = [...this.#corePlugins]
    if (this.getAttribute('autolink') !== 'false') plugins.push(autolinkPlugin())
    if (this.#visualAids) plugins.push(visualAidsPlugin())
    // Plugins contributed by opt-in bundles. The cache is per editor, so
    // instances are still never shared between two editors -- each carries its
    // own state and two editors sharing one would fight over it -- but
    // reconfiguring this editor reuses its own, which is what stops a late
    // registration resetting the plugin state of the ones already running.
    plugins.push(...createRegisteredPlugins(this.#schema, this.#pluginCache))
    return plugins
  }

  /** Swap the plugin set into the running view, keeping document and history. */
  #reconfigurePlugins(): void {
    const view = this.#view
    if (!view) return
    view.updateState(view.state.reconfigure({ plugins: this.#allPlugins() }))
    this.#toolbar?.update(view.state)
    this.#toolbar2?.update(view.state)
    this.#floating?.update(view.state)
  }

  /**
   * Announce a document change.
   *
   * `composed: true` because a design system that puts the editor inside its own
   * shadow root -- every Lit, Stencil and LWC component does -- otherwise never
   * receives this at all: a bubbling event stops at the shadow boundary. The
   * element already anticipates that host, since `FormBridge.bind()` resolves
   * its textarea through a root that may be a `ShadowRoot`.
   *
   * The `detail` carries the value so a listener does not have to read `.value`
   * back off the element, which serializes the document a second time.
   */
  #emitChange(value: string): void {
    this.dispatchEvent(
      new CustomEvent('openleaf:change', {
        bubbles: true,
        composed: true,
        detail: { value },
      }),
    )
  }

  disconnectedCallback(): void {
    // Persist whatever is in the source box before tearing it down, so a
    // framework that moves the element does not drop unsaved HTML.
    this.#formBridge.sync()
    this.#teardownSource({ apply: false })
    this.#formBridge.detach()
    this.removeEventListener(SOURCE_TOGGLE_EVENT, this.#onToggleSource)
    this.removeEventListener(FULLSCREEN_TOGGLE_EVENT, this.#onToggleFullscreen)
    this.ownerDocument.removeEventListener('fullscreenchange', this.#onFullscreenChange)
    this.removeEventListener(VISUAL_AIDS_TOGGLE_EVENT, this.#onToggleVisualAids)
    this.removeEventListener('focusin', this.#onInlineFocus)
    this.removeEventListener('focusout', this.#onInlineBlur)
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#unwatchPlugins?.()
    this.#unwatchSchema?.()
    this.#destroyChrome()
    this.#view?.destroy()
    this.#view = null
  }

  /** Current document as an HTML string. */
  get value(): string {
    if (this.#sourceMode && this.#sourceArea) return this.#sourceArea.value
    if (!this.#view) return this.#formBridge.textarea?.value ?? ''
    return serializeHtml(this.#view.state.doc)
  }

  set value(html: string) {
    if (this.#sourceMode && this.#sourceArea) {
      this.#sourceArea.value = html
      this.#formBridge.sync()
      return
    }
    if (!this.#view) {
      if (this.#formBridge.textarea) this.#formBridge.textarea.value = html
      return
    }
    // `onlyIfChanged` because a controlled framework binding writes this on
    // every render pass. Replacing the document unconditionally would land an
    // undo step and move the caret to the start of the document each time --
    // which is what all three wrappers grew their own `if (host.value !== html)`
    // guard to avoid, one guard at a time, each of which could be forgotten.
    this.#replaceDocument(html, { onlyIfChanged: true })
  }

  /** Escape hatch for plugins and integrations that need the real view. */
  get view(): EditorView | null {
    return this.#view
  }

  /**
   * The schema this editor was built with.
   *
   * Typed through the document node so the generic parameters are the schema's
   * own rather than `Schema<any, any>`, which is what a bare `Schema` widens to
   * and what made every node and mark name on it `any` for a consumer.
   */
  get schema(): Schema<string, string> {
    return this.#schema as Schema<string, string>
  }

  /**
   * The toolbar, for plugins pushing external state via `setItemState`.
   *
   * Renamed from `toolbar`, which is now the attribute-reflecting property every
   * framework expects a custom element to have. The old name was a **silent
   * data-loss bug** in every framework binding: Vue's `shouldSetAsProp` ends in
   * `return key in el`, `'toolbar' in el` was true because of this accessor, so
   * Vue took the property path, `patchDOMProp` did `try { el[key] = value }
   * catch {}`, assigning to a getter-only accessor threw in strict mode, and the
   * throw was swallowed. `<OpenLeafEditor toolbar="bold italic" />` rendered the
   * full 22-button default bar with no error anywhere. React 19's custom-element
   * property path has the same shape.
   *
   * Narrowed to `ToolbarHandle` as well: the documented need is `setItemState`
   * and `focusToolbar`, and publishing the whole `Toolbar` class froze its
   * entire surface into the public API before 1.0.
   */
  get toolbarInstance(): ToolbarHandle | null {
    return this.#toolbar
  }

  /** The `toolbar` attribute. Assigning reflects, as HTML properties should. */
  get toolbar(): string | null {
    return this.getAttribute('toolbar')
  }

  set toolbar(layout: string | null) {
    this.#reflect('toolbar', layout)
  }

  /** The `toolbar2` attribute. */
  get toolbar2(): string | null {
    return this.getAttribute('toolbar2')
  }

  set toolbar2(layout: string | null) {
    this.#reflect('toolbar2', layout)
  }

  /** The `menubar` attribute. */
  get menubar(): string | null {
    return this.getAttribute('menubar')
  }

  set menubar(menus: string | null) {
    this.#reflect('menubar', menus)
  }

  /** The `formats` attribute. */
  get formats(): string | null {
    return this.getAttribute('formats')
  }

  set formats(spec: string | null) {
    this.#reflect('formats', spec)
  }

  /** The `readonly` attribute, as the boolean every framework binds it as. */
  get readOnly(): boolean {
    return this.hasAttribute('readonly')
  }

  set readOnly(value: boolean) {
    this.#reflect('readonly', value ? '' : null)
  }

  #reflect(name: string, value: string | null): void {
    if (value === null || value === undefined) this.removeAttribute(name)
    else this.setAttribute(name, value)
  }

  /** Whether the HTML source view is open. Assigning toggles it. */
  get sourceMode(): boolean {
    return this.#sourceMode
  }

  set sourceMode(open: boolean) {
    if (open === this.#sourceMode) return
    this.#onToggleSource()
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
        new CustomEvent(SOURCE_OPEN_EVENT, {
        bubbles: true,
        composed: true,
        detail: { textarea: area },
      }),
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
      new CustomEvent(SOURCE_CLOSE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { textarea: area },
      }),
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
    // Reads `this.imageUploader` first, then the global one. The property is now
    // declared on the class, so a consumer setting it gets a type instead of
    // `error TS2339: Property 'imageUploader' does not exist on type
    // 'OpenLeafEditor'` -- which is what the README and the JSDoc shipped in
    // dist/index.d.ts had been telling them to write since the first beta.
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

  /** `inline` after mount: attach or detach the focus-reveal listeners. */
  #applyInline(): void {
    const wanted = this.hasAttribute('inline')
    this.classList.toggle('ol-inline', wanted)
    // Both are idempotent: adding a listener twice with the same function
    // reference is a no-op, and removing one that is not attached is too.
    this.removeEventListener('focusin', this.#onInlineFocus)
    this.removeEventListener('focusout', this.#onInlineBlur)
    if (wanted) this.#mountInline()
    else this.classList.remove('ol-inline-active')
  }

  /** `autoresize` after mount: start or stop growing the canvas. */
  #applyAutoresize(): void {
    const wanted = this.hasAttribute('autoresize')
    this.classList.toggle('ol-autoresize', wanted)
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    if (wanted) {
      this.#mountAutoresize()
      return
    }
    // Leaving the measured pixel height behind would freeze the canvas at
    // whatever size it happened to be when the attribute was removed.
    const pm = this.#contentHost?.querySelector<HTMLElement>('.ProseMirror')
    if (pm) pm.style.height = ''
  }

  /**
   * Turn visual aids on or off.
   *
   * Both the class (which draws them) and the decoration plugin (which marks
   * what to draw) have to move together, so this is also what the toolbar button
   * calls. Toggling only the class left the decorations in the document with
   * nothing styling them.
   */
  #applyVisualAids(active: boolean): void {
    if (active === this.#visualAids) return
    this.#visualAids = active
    this.classList.toggle('ol-visual-aids', active)
    this.#toolbar?.setItemState('visualAids', { active })
    this.#toolbar2?.setItemState('visualAids', { active })
    this.#reconfigurePlugins()
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
    this.#applyVisualAids(!this.#visualAids)
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
  type ToolbarHandle,
} from '@openleaf-editor/ui'

/** The `detail` of `openleaf:change`. */
export interface OpenLeafChangeDetail {
  /** The document as HTML, already serialized. */
  value: string
}

/** The `detail` of `openleaf:source-open` and `openleaf:source-close`. */
export interface OpenLeafSourceDetail {
  textarea: HTMLTextAreaElement
}

/**
 * Teach the DOM about this element.
 *
 * Without this, `document.querySelector('openleaf-editor')` is an `Element` and
 * `document.createElement('openleaf-editor')` is an `HTMLElement` -- neither of
 * which has `.value`, `.view`, `.schema` or `.sourceMode`. There was no
 * `declare global` anywhere in the repository, and the project's own docs
 * worked around the gap: `docs/authoring-plugins.md` told plugin authors to
 * write `(el as HTMLElement & { toolbar?: { setItemState(...): void } })`, which
 * re-declares a *weaker* structural type for a member the class already types
 * properly.
 *
 * The event map matters as much as the tag map. `addEventListener('openleaf:change')`
 * handed back a bare `Event`, so reading `event.detail` was `error TS2339` and
 * every listener in every example had to cast.
 */
declare global {
  interface HTMLElementTagNameMap {
    'openleaf-editor': OpenLeafEditor
  }
  interface HTMLElementEventMap {
    'openleaf:change': CustomEvent<OpenLeafChangeDetail>
    'openleaf:source-open': CustomEvent<OpenLeafSourceDetail>
    'openleaf:source-close': CustomEvent<OpenLeafSourceDetail>
  }
  /**
   * The same three on `document` and `window`.
   *
   * `document.addEventListener` resolves against `DocumentEventMap`, not
   * `HTMLElementEventMap`, so without these a delegated listener -- the ordinary
   * way to watch every editor on a page, and the one `composed: true` now makes
   * reliable from outside a shadow root -- was back to a bare `Event` and a cast
   * to read `detail`.
   */
  interface DocumentEventMap {
    'openleaf:change': CustomEvent<OpenLeafChangeDetail>
    'openleaf:source-open': CustomEvent<OpenLeafSourceDetail>
    'openleaf:source-close': CustomEvent<OpenLeafSourceDetail>
  }
  interface WindowEventMap {
    'openleaf:change': CustomEvent<OpenLeafChangeDetail>
    'openleaf:source-open': CustomEvent<OpenLeafSourceDetail>
    'openleaf:source-close': CustomEvent<OpenLeafSourceDetail>
  }
}

/** Idempotent: safe to import twice, or alongside a bundled copy. */
export function defineOpenLeafEditor(tag = 'openleaf-editor'): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tag)) return
  customElements.define(tag, OpenLeafEditor)
}

defineOpenLeafEditor()
