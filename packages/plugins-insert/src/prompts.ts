import { insertAudio, insertDetails, insertHtml, insertIframe, insertNamedAnchor, insertVideo, setHeadingId, isNodeActive } from '@openleaf-editor/core'
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

export async function promptInsertMedia(view: EditorView, host: HTMLElement): Promise<void> {
  const values = await ask(host.ownerDocument, 'Insert media', [
    { name: 'src', label: 'Address' },
    { name: 'title', label: 'Title' },
  ], host)
  if (!values?.['src']) {
    view.focus()
    return
  }
  const src = values['src']
  const title = values['title'] || null
  const kind = /youtube|vimeo|dailymotion|spotify|soundcloud|twitch|google\.com\/maps/i.test(src)
    ? insertIframe
    : /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(src)
      ? insertAudio
      : insertVideo
  kind({ src, title })(view.state, view.dispatch, view)
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
