import { availableSkins, contentCssUrls, type Skin } from '@openleaf-editor/ui'

/**
 * Small native `<dialog>` prompts used by session tools.
 *
 * `showModal()` supplies the focus trap and Escape handling. These are not the
 * link/image forms; they are confirmations and read-only views, so they stay in
 * this package rather than growing the shared dialog helper.
 *
 * Each takes an optional `host`: the editor to mount inside. Skin tokens are
 * scoped to `.ol-editor[data-ol-skin]`, so a dialog appended to `document.body`
 * never sees them and is drawn in the default light palette no matter what the
 * editor looks like. `showModal()` promotes to the top layer wherever the
 * element sits, so nesting costs nothing in stacking or clipping.
 */

/**
 * Unique ids per dialog.
 *
 * These were constants -- `ol-session-confirm-title` and friends -- and every
 * one of them is appended to `doc.body`. With two editors on a page an
 * `aria-labelledby` resolved to whichever dialog came first in the document,
 * naming this one after somebody else's.
 */
let idCounter = 0

function nextId(kind: string): string {
  idCounter += 1
  return `ol-session-${kind}-${idCounter}`
}

/**
 * What the canvas actually looks like, and why preview cannot inherit it.
 *
 * The live editor is assembled in this order:
 *
 *   1. Host typography, inherited (no Shadow DOM on the content area).
 *   2. Skin tokens on `.ol-editor[data-ol-skin]`, plus `data-ol-scheme`.
 *   3. `content-css`, fetched and *scoped* under
 *      `.ol-editor .ol-content .ProseMirror` so a published `p.lead` cannot
 *      restyle the admin page. The scoper is a scanner, not a regex, because a
 *      rule inside `@media` used to ship unscoped; we do not touch it here.
 *   4. `dir` / `lang` on the host or `<html>`, plus any per-block `dir` in the
 *      document itself.
 *
 * Preview and print are a *different document* (an iframe `srcdoc`). The scoped
 * sheet lives on the host and cannot match inside the frame, wrapping the
 * markup in `.ol-editor .ol-content .ProseMirror` would make a "published
 * preview" lie about its DOM, and copying the scoped text verbatim would leave
 * every selector pointing at a wrapper the frame does not have. The published
 * URLs go in as `<link>` tags instead -- unscoped, the way the live site loads
 * them, and a `<link>` rather than a `<style>` so `style-src 'self'` still
 * holds. Skin tokens are copied onto the preview root because they do not
 * inherit across documents either.
 *
 * Print is not preview. A dark skin printed literally is a rectangle of toner
 * (and browsers already strip backgrounds unless asked not to). Light skins
 * still apply; a `scheme: 'dark'` skin is dropped. Page-break rules belong on
 * print only.
 */
interface CanvasAppearance {
  lang: string
  dir: string
  skinName: string | null
  scheme: string | null
  tokens: string
  contentCss: readonly string[]
}

function canvasLang(doc: Document, host?: HTMLElement): string {
  // The host `lang` is the UI locale, but the canvas content inherits it, so
  // a preview that only reads `<html lang>` (and falls back to English) is
  // announced in the wrong voice -- the failure that shipped.
  return host?.getAttribute('lang')?.trim()
    || doc.documentElement.getAttribute('lang')?.trim()
    || 'en'
}

function canvasDir(doc: Document, host?: HTMLElement): string {
  for (const el of [host, doc.documentElement]) {
    if (!el) continue
    const value = el.getAttribute('dir')?.trim()
    if (value === 'rtl' || value === 'ltr' || value === 'auto') return value
  }
  const target = host ?? doc.documentElement
  return target.ownerDocument.defaultView?.getComputedStyle(target).direction === 'rtl'
    ? 'rtl'
    : ''
}

function namedSkin(host?: HTMLElement): Skin | null {
  const name = host?.getAttribute('data-ol-skin')?.trim()
    || host?.getAttribute('skin')?.trim()
    || ''
  if (!name || name === 'default') return null
  return availableSkins().find((skin) => skin.name === name) ?? null
}

function flattenTokens(tokens: string): string {
  return tokens.replace(/\s+/g, ' ').trim()
}

function canvasAppearance(
  doc: Document,
  host: HTMLElement | undefined,
  kind: 'preview' | 'print',
): CanvasAppearance {
  const skin = namedSkin(host)
  // Print a midnight (or any dark) skin as a light page. Preview keeps it: the
  // author asked to see that canvas, and a screen can show black. Paper cannot
  // undo a rectangle of toner.
  const printDark = kind === 'print' && skin?.scheme === 'dark'
  const useSkin = skin !== null && !printDark
  return {
    lang: canvasLang(doc, host),
    dir: canvasDir(doc, host),
    skinName: useSkin ? skin.name : null,
    scheme: useSkin ? skin.scheme ?? null : null,
    tokens: useSkin ? flattenTokens(skin.tokens) : '',
    contentCss: contentCssUrls(host?.getAttribute('content-css') ?? null),
  }
}

function htmlOpen(appearance: CanvasAppearance): string {
  const attrs = [`lang="${attr(appearance.lang)}"`]
  if (appearance.dir) attrs.push(`dir="${attr(appearance.dir)}"`)
  if (appearance.skinName) attrs.push(`data-ol-skin="${attr(appearance.skinName)}"`)
  if (appearance.scheme) attrs.push(`data-ol-scheme="${attr(appearance.scheme)}"`)
  if (appearance.tokens) attrs.push(`style="${attr(appearance.tokens)}"`)
  return `<html ${attrs.join(' ')}>`
}

function contentCssLinks(urls: readonly string[]): string {
  return urls.map((url) => `<link rel="stylesheet" href="${attr(url)}">`).join('')
}

function chromeCss(kind: 'preview' | 'print'): string {
  // No `td, th { border }` on purpose. The canvas draws those as authoring
  // chrome so an unstyled table is still editable; the published page may not
  // have them, and inventing them here is how preview lied. `content-css`
  // supplies the borders the document actually ships with.
  const margin = kind === 'print' ? '1.5rem' : '1.25rem'
  const pagebreak = kind === 'print'
    ? 'hr.ol-pagebreak{break-after:page;page-break-after:always;border:0}'
    : ''
  return (
    `body{margin:${margin};font:16px/1.6 system-ui,sans-serif;` +
    'color:var(--openleaf-color-text,#1f2328);background:var(--openleaf-color-surface,#fff)}' +
    'img{max-width:100%;height:auto}table{border-collapse:collapse}' +
    pagebreak
  )
}

function generatedMarkup(
  title: string,
  html: string,
  appearance: CanvasAppearance,
  kind: 'preview' | 'print',
): string {
  // Concatenation, not a template literal wrapping `html`: author content that
  // happened to contain `${...}` would interpolate in *this* scope.
  return (
    '<!doctype html>' +
    htmlOpen(appearance) +
    '<head><meta charset="utf-8"><title>' +
    attr(title) +
    '</title>' +
    contentCssLinks(appearance.contentCss) +
    '<style>' +
    chromeCss(kind) +
    '</style></head><body>' +
    html +
    '</body></html>'
  )
}

/** Escaped for an attribute value, since it goes into generated markup. */
function attr(value: string): string {
  return value.replace(/[<>&"']/g, '')
}

/** Where to mount: the editor when there is one, `document.body` otherwise. */
function mountPoint(doc: Document, host?: HTMLElement): HTMLElement {
  return host && host.ownerDocument === doc ? host : doc.body
}

export async function confirmAction(
  doc: Document,
  options: { title: string; message: string; confirmLabel: string; danger?: boolean },
  host?: HTMLElement,
): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused = doc.activeElement as HTMLElement | null
    const dialog = doc.createElement('dialog')
    dialog.className = 'ol-dialog ol-session-dialog'
    const headingId = nextId('confirm-title')
    dialog.setAttribute('aria-labelledby', headingId)

    const form = doc.createElement('form')
    form.method = 'dialog'

    const heading = doc.createElement('h2')
    heading.id = headingId
    heading.textContent = options.title
    form.appendChild(heading)

    const message = doc.createElement('p')
    message.className = 'ol-hint'
    message.textContent = options.message
    form.appendChild(message)

    const actions = doc.createElement('div')
    actions.className = 'ol-actions'
    const cancel = doc.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    const ok = doc.createElement('button')
    ok.type = 'submit'
    ok.value = 'ok'
    ok.textContent = options.confirmLabel
    if (options.danger === true) ok.className = 'ol-danger'
    actions.append(cancel, ok)
    form.appendChild(actions)
    dialog.appendChild(form)
    mountPoint(doc, host).appendChild(dialog)

    const finish = (value: boolean): void => {
      dialog.close()
      dialog.remove()
      previouslyFocused?.focus?.()
      resolve(value)
    }

    cancel.addEventListener('click', () => finish(false))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(false)
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      // Mounted inside the editor this is usually inside the host page's own
      // <form>, and `submit` bubbles. Confirming "Discard draft?" must not also
      // look to the page like the author pressed Save.
      event.stopPropagation()
      finish(true)
    })

    dialog.showModal()
    // Never the destructive button. "Clear editor" focused by default means one
    // reflexive Enter -- the key that opened the dialog is still under the
    // author's finger -- discards the document.
    if (options.danger === true) cancel.focus()
    else ok.focus()
  })
}

export function showPreview(doc: Document, html: string, host?: HTMLElement): void {
  const previouslyFocused = doc.activeElement as HTMLElement | null
  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog ol-session-dialog ol-preview-dialog'
  const headingId = nextId('preview-title')
  dialog.setAttribute('aria-labelledby', headingId)

  const heading = doc.createElement('h2')
  heading.id = headingId
  heading.textContent = 'Preview'

  const frame = doc.createElement('iframe')
  frame.className = 'ol-preview-frame'
  frame.title = 'Published preview'
  frame.sandbox = ''
  // srcdoc rather than innerHTML on the host: the preview must not run script
  // from stored markup, and an iframe without allow-scripts is that boundary.
  // Appearance (content-css, skin, dir, lang) is copied in -- the frame is a
  // whole document and none of those inherit across the iframe boundary.
  frame.srcdoc = generatedMarkup(
    'Preview',
    html,
    canvasAppearance(doc, host, 'preview'),
    'preview',
  )

  const close = doc.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.className = 'ol-preview-close'

  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  actions.appendChild(close)

  dialog.append(heading, frame, actions)
  mountPoint(doc, host).appendChild(dialog)

  const finish = (): void => {
    dialog.close()
    dialog.remove()
    previouslyFocused?.focus?.()
  }

  close.addEventListener('click', finish)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    finish()
  })
  dialog.showModal()
  close.focus()
}

export function printHtml(doc: Document, html: string, title: string, host?: HTMLElement): void {
  const frame = doc.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  // srcdoc, same as preview, so the generated document is inspectable and so
  // `<link>` content-css has a chance to load before we call print. The frame
  // is not sandboxed: `window.print()` from here is what the browser's dialog
  // is, and unique-origin would take that away.
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = (): void => {
    if (timer !== undefined) globalThis.clearTimeout(timer)
    frame.remove()
  }
  const run = (): void => {
    const win = frame.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.addEventListener('afterprint', cleanup)
    timer = globalThis.setTimeout(cleanup, 60_000)
    // jsdom implements both as "not implemented" throws that also log; there
    // is no printer to drive, and the document is already in the frame for
    // tests. Playwright covers the real `print()` call.
    if (win.navigator.userAgent.includes('jsdom')) return
    win.focus()
    win.print()
  }
  frame.addEventListener('load', run)
  doc.body.appendChild(frame)
  frame.srcdoc = generatedMarkup(
    title,
    html,
    canvasAppearance(doc, host, 'print'),
    'print',
  )
}

export function showStats(
  doc: Document,
  stats: { words: number; characters: number; charactersExcludingSpaces: number; paragraphs: number },
  host?: HTMLElement,
): void {
  const previouslyFocused = doc.activeElement as HTMLElement | null
  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog ol-session-dialog'
  const headingId = nextId('stats-title')
  dialog.setAttribute('aria-labelledby', headingId)

  const heading = doc.createElement('h2')
  heading.id = headingId
  heading.textContent = 'Word count'

  const list = doc.createElement('ul')
  list.className = 'ol-stats'
  const rows: Array<[string, string]> = [
    ['Words', String(stats.words)],
    ['Characters', String(stats.characters)],
    ['Characters excluding spaces', String(stats.charactersExcludingSpaces)],
    ['Paragraphs', String(stats.paragraphs)],
  ]
  for (const [label, value] of rows) {
    const item = doc.createElement('li')
    item.textContent = `${label}: ${value}`
    list.appendChild(item)
  }

  const close = doc.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  actions.appendChild(close)

  dialog.append(heading, list, actions)
  mountPoint(doc, host).appendChild(dialog)

  const finish = (): void => {
    dialog.close()
    dialog.remove()
    previouslyFocused?.focus?.()
  }
  close.addEventListener('click', finish)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    finish()
  })
  dialog.showModal()
  close.focus()
}
