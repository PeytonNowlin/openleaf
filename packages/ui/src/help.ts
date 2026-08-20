/**
 * In-editor help: the shortcut table plus the chrome controls that have no
 * key of their own.
 *
 * The shortcut list is the same array `buildKeymap` reads. A hand-maintained
 * help page that drifted from the keymap would be worse than no help at all.
 */

import { shortcutFor, shortcuts } from '@openleaf-editor/core'
import { ensureDialogStyles } from './dialog.js'
import { t, withLocale } from './i18n.js'
import { ensureStyles } from './styles.js'

const HELP_CHROME: Array<[string, string]> = [
  ['Alt+F10', 'Move focus to the formatting toolbar'],
  ['Escape', 'Return focus to the document'],
  ['F1', 'Open this help dialog'],
]

/**
 * Unique per dialog.
 *
 * `ol-help-title` was a constant, so a second editor's help dialog carried the
 * same id and `aria-labelledby` resolved to whichever was first in the
 * document -- naming this dialog after somebody else's.
 */
let helpCounter = 0

/** `locale` is the editor's own `lang`, not the document-wide one. */
export function promptHelp(doc: Document, locale?: string | null): void {
  withLocale(locale, () => buildHelp(doc))
}

function buildHelp(doc: Document): void {
  ensureStyles(doc)
  ensureDialogStyles(doc)
  const previouslyFocused = doc.activeElement as HTMLElement | null
  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog ol-help'
  const headingId = `ol-help-title-${(helpCounter += 1)}`
  dialog.setAttribute('aria-labelledby', headingId)

  const form = doc.createElement('form')
  form.method = 'dialog'

  const heading = doc.createElement('h2')
  heading.id = headingId
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
  doc.body.appendChild(dialog)
  dialog.addEventListener('close', () => {
    dialog.remove()
    previouslyFocused?.focus()
  })
  dialog.showModal()
}
