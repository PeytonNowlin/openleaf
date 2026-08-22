import { embedSrcFor, insertAudio, insertDetails, insertHtml, insertIframe, insertNamedAnchor, insertVideo, selectedMedia, setHeadingId, updateMedia, isNodeActive } from '@openleaf-editor/core'
import { promptForMedia } from '@openleaf-editor/ui'
import { listedSnippets } from './snippets.js'
import type { EditorView } from 'prosemirror-view'

/**
 * `host` is the editor to mount inside. Skin tokens are scoped to
 * `.ol-editor[data-ol-skin]`, so a dialog appended to `document.body` never
 * sees them; `showModal()` promotes to the top layer either way, so nesting is
 * free.
 */
function ask(doc: Document, title: string, fields: Array<{ name: string; label: string; value?: string }>, host?: HTMLElement): Promise<Record<string, string> | null> {
  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog'
  const form = doc.createElement('form')
  form.method = 'dialog'
  const heading = doc.createElement('h2')
  heading.textContent = title
  form.appendChild(heading)
  const inputs = new Map<string, HTMLInputElement>()
  for (const field of fields) {
    const label = doc.createElement('label')
    const span = doc.createElement('span')
    span.textContent = field.label
    const input = doc.createElement('input')
    input.type = 'text'
    input.name = field.name
    input.value = field.value ?? ''
    label.append(span, input)
    inputs.set(field.name, input)
    form.appendChild(label)
  }
  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  const ok = doc.createElement('button')
  ok.type = 'submit'
  ok.value = 'ok'
  ok.textContent = 'Insert'
  actions.append(cancel, ok)
  form.appendChild(actions)
  dialog.appendChild(form)
  ;(host && host.ownerDocument === doc ? host : doc.body).appendChild(dialog)

  return new Promise((resolve) => {
    const finish = (value: Record<string, string> | null): void => {
      dialog.close()
      dialog.remove()
      resolve(value)
    }
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      // Nested inside the editor this sits inside the host page's own <form>,
      // and `submit` bubbles: inserting a video must not read as a page save.
      event.stopPropagation()
      const values: Record<string, string> = {}
      for (const [name, input] of inputs) values[name] = input.value.trim()
      finish(values)
    })
    dialog.showModal()
    inputs.values().next().value?.focus()
  })
}

/** Extensions that mean audio rather than video. */
const AUDIO_FILES = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(\?|#|$)/i

/**
 * Which node type an address wants to be.
 *
 * The alternatives are consulted too: a source-only player has no `src` to
 * classify, and a set of `.ogg` sources is audio however little the empty main
 * address says.
 */
function mediaKindFor(src: string, sources: readonly { src: string }[]): 'iframe' | 'audio' | 'video' {
  if (src !== '' && embedSrcFor(src) !== null) return 'iframe'
  const addresses = [src, ...sources.map((source) => source.src)].filter((one) => one !== '')
  if (addresses.length > 0 && addresses.every((one) => AUDIO_FILES.test(one))) return 'audio'
  return 'video'
}

/**
 * Insert a player, or edit the one that is selected.
 *
 * The same toolbar button does both, because "insert" and "edit" are the same
 * dialog with the fields already filled in, and a separate control for editing
 * is one the author has to discover. `selectedMedia` returning null is what
 * distinguishes them -- and it insists on a real node selection, so a caret that
 * merely sits near a player still inserts a new one.
 */
export async function promptInsertMedia(view: EditorView, host: HTMLElement): Promise<void> {
  const current = selectedMedia(view.state)
  const result = await promptForMedia(host.ownerDocument, {
    host,
    ...(current
      ? {
          existing: {
            kind: current.kind,
            src: current.src ?? '',
            title: current.title,
            poster: current.poster,
            width: current.width,
            height: current.height,
            sources: current.sources.map((source) => ({ src: source.src, type: source.type ?? null })),
          },
        }
      : {}),
  })
  if (!result) {
    view.focus()
    return
  }

  const attrs = {
    src: result.src === '' ? null : result.src,
    title: result.title,
    poster: result.poster,
    width: result.width,
    height: result.height,
    sources: result.sources.map((source) => ({ src: source.src, type: source.type })),
  }

  if (current) {
    // Editing keeps the node type it already had. Retyping the address of a
    // selected video into a YouTube link should change the address, not silently
    // replace the node with an iframe and drop the sources beside it.
    updateMedia(attrs)(view.state, view.dispatch, view)
    view.focus()
    return
  }

  const kind = mediaKindFor(result.src, result.sources)
  if (kind === 'iframe') {
    // The converted address, not what the author typed: `insertIframe` runs the
    // value past the same allowlist, which refuses a watch page.
    insertIframe({ ...attrs, src: embedSrcFor(result.src) })(view.state, view.dispatch, view)
    view.focus()
    return
  }
  const insert = kind === 'audio' ? insertAudio : insertVideo
  insert(attrs)(view.state, view.dispatch, view)
  view.focus()
}

export async function promptInsertDetails(view: EditorView, host: HTMLElement): Promise<void> {
  const values = await ask(host.ownerDocument, 'Collapsible section', [
    { name: 'summary', label: 'Summary', value: 'Details' },
  ], host)
  if (!values) {
    view.focus()
    return
  }
  insertDetails(values['summary'] || 'Details')(view.state, view.dispatch, view)
  view.focus()
}

export async function promptInsertAnchor(view: EditorView, host: HTMLElement): Promise<void> {
  const values = await ask(host.ownerDocument, 'Named anchor', [{ name: 'id', label: 'Name' }], host)
  if (!values?.['id']) {
    view.focus()
    return
  }
  if (isNodeActive(view.state, 'heading')) {
    setHeadingId(values['id'])(view.state, view.dispatch, view)
  } else {
    insertNamedAnchor(values['id'])(view.state, view.dispatch, view)
  }
  view.focus()
}

export async function promptInsertSnippet(view: EditorView, host: HTMLElement): Promise<void> {
  const available = listedSnippets()
  if (available.length === 0) {
    view.focus()
    return
  }
  const values = await ask(host.ownerDocument, 'Insert snippet', [
    { name: 'id', label: `Snippet id (${available.map((s) => s.id).join(', ')})` },
  ], host)
  const found = available.find((s) => s.id === values?.['id'] || s.title === values?.['id'])
  if (!found) {
    view.focus()
    return
  }
  insertHtml(found.html)(view.state, view.dispatch, view)
  view.focus()
}
