/**
 * Small native `<dialog>` prompts used by session tools.
 *
 * `showModal()` supplies the focus trap and Escape handling. These are not the
 * link/image forms; they are confirmations and read-only views, so they stay in
 * this package rather than growing the shared dialog helper.
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
 * The language a generated document should declare.
 *
 * A preview or a print-out with no `lang` is read by a screen reader in whatever
 * voice it happened to be using -- English prose in a French voice, or the other
 * way round. The host page already knows the answer.
 */
function documentLang(doc: Document): string {
  return doc.documentElement.getAttribute('lang')?.trim() || 'en'
}

/** Escaped for an attribute value, since it goes into generated markup. */
function attr(value: string): string {
  return value.replace(/[<>&"']/g, '')
}

export async function confirmAction(
  doc: Document,
  options: { title: string; message: string; confirmLabel: string; danger?: boolean },
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
    doc.body.appendChild(dialog)

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
      finish(true)
    })

    dialog.showModal()
    ok.focus()
  })
}

export function showPreview(doc: Document, html: string): void {
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
  // `lang` and a `<title>`: the frame is a whole document, and one with neither
  // is announced as an untitled page in whatever voice the reader was already
  // using.
  frame.srcdoc = `<!doctype html><html lang="${attr(documentLang(doc))}"><head><meta charset="utf-8">\
<title>Preview</title><style>
    body { margin: 1.25rem; font: 16px/1.6 system-ui, sans-serif; color: #1f2328; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #d1d9e0; padding: .3rem .5rem; }
  </style></head><body>${html}</body></html>`

  const close = doc.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.className = 'ol-preview-close'

  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  actions.appendChild(close)

  dialog.append(heading, frame, actions)
  doc.body.appendChild(dialog)

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

export function printHtml(doc: Document, html: string, title: string): void {
  const frame = doc.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  doc.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) {
    frame.remove()
    return
  }
  const safeTitle = title.replace(/[<>&"]/g, '')
  win.document.open()
  win.document.write(`<!doctype html><html lang="${attr(documentLang(doc))}"><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{margin:1.5rem;font:16px/1.6 system-ui,sans-serif} img{max-width:100%} table{border-collapse:collapse} td,th{border:1px solid #333;padding:.3rem .5rem}</style>
</head><body>${html}</body></html>`)
  win.document.close()
  const cleanup = (): void => {
    frame.remove()
  }
  win.addEventListener('afterprint', cleanup)
  win.focus()
  win.print()
  globalThis.setTimeout(cleanup, 60_000)
}

export function showStats(
  doc: Document,
  stats: { words: number; characters: number; charactersExcludingSpaces: number; paragraphs: number },
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
  doc.body.appendChild(dialog)

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
