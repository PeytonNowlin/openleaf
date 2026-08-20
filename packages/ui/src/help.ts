/**
 * In-editor help: the shortcut table plus the chrome controls that have no
 * key of their own.
 *
 * The shortcut list is the same array `buildKeymap` reads. A hand-maintained
 * help page that drifted from the keymap would be worse than no help at all.
 */

import { shortcutFor, shortcuts } from '@openleaf-editor/core'
import { ensureDialogStyles } from './dialog.js'
import { t } from './i18n.js'
import { ensureStyles } from './styles.js'

const HELP_CHROME: Array<[string, string]> = [
  ['Alt+F10', 'Move focus to the formatting toolbar'],
  ['Escape', 'Return focus to the document'],
  ['F1', 'Open this help dialog'],
]

/**
 * `host` is the editor to mount inside, so the dialog inherits its skin. It is
 * optional only so the existing `promptHelp(doc)` shape keeps working; pass it
 * whenever there is one, or the help dialog is drawn in the default light
 * palette on top of whatever the editor actually looks like.
 */
export function promptHelp(doc: Document, host?: HTMLElement): void {
  ensureStyles(doc)
  ensureDialogStyles(doc)
  const previouslyFocused = doc.activeElement as HTMLElement | null
  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog ol-help'
  dialog.setAttribute('aria-labelledby', 'ol-help-title')

  const form = doc.createElement('form')
  form.method = 'dialog'

  const heading = doc.createElement('h2')
  heading.id = 'ol-help-title'
  heading.textContent = t('Keyboard shortcuts')
  form.appendChild(heading)

  const table = doc.createElement('table')
  table.className = 'ol-help-table'
  const body = doc.createElement('tbody')
  for (const shortcut of shortcuts) {
    const row = doc.createElement('tr')
    const keys = doc.createElement('th')
    keys.scope = 'row'
    keys.textContent = shortcutFor(shortcut.label) ?? shortcut.keys
    const label = doc.createElement('td')
    label.textContent = t(shortcut.label)
    row.appendChild(keys)
    row.appendChild(label)
    body.appendChild(row)
  }
  for (const [keys, label] of HELP_CHROME) {
    const row = doc.createElement('tr')
    const keyCell = doc.createElement('th')
    keyCell.scope = 'row'
    keyCell.textContent = keys
    const labelCell = doc.createElement('td')
    labelCell.textContent = t(label)
    row.appendChild(keyCell)
    row.appendChild(labelCell)
    body.appendChild(row)
  }
  table.appendChild(body)
  form.appendChild(table)

  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  const close = doc.createElement('button')
  close.type = 'submit'
  close.value = 'ok'
  close.textContent = t('Close')
  actions.appendChild(close)
  form.appendChild(actions)
  dialog.appendChild(form)
  // Inside the editor, so the skin reaches it. `showModal` promotes to the top
  // layer regardless of where the element sits, so nesting costs nothing.
  ;(host && host.ownerDocument === doc ? host : doc.body).appendChild(dialog)
  // The close button is a submit button in a `method="dialog"` form, so closing
  // fires `submit`. Mounted inside the editor that now bubbles into the host
  // page's own form; stop it, or dismissing help looks like saving the document.
  form.addEventListener('submit', (event) => {
    event.stopPropagation()
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    previouslyFocused?.focus()
  })
  dialog.showModal()
}
