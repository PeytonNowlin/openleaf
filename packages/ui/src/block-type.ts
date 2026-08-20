import {
  activeBlockClass,
  activeHeadingLevel,
  formatParts,
  setBlockClass,
  setHeading,
  setParagraph,
  toggleHeading,
  type FormatSpec,
} from '@openleaf-editor/core'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { t } from './i18n.js'
import type { ToolbarControl } from './registry.js'

export function blockTypeControl(
  view: EditorView,
  host: HTMLElement,
  formats: readonly FormatSpec[],
): ToolbarControl {
  const select = host.ownerDocument.createElement('select')
  select.className = 'ol-select'
  select.dataset['olId'] = 'blockType'
  select.setAttribute('aria-label', t('Paragraph style'))

  const options: Array<[string, string]> = [
    ['p', t('Paragraph')], ['1', t('Heading 1')], ['2', t('Heading 2')],
    ['3', t('Heading 3')], ['4', t('Heading 4')], ['5', t('Heading 5')], ['6', t('Heading 6')],
  ]
  const addOption = (label: string, value: string) => {
    const option = host.ownerDocument.createElement('option')
    option.textContent = label
    option.value = value
    select.add(option)
  }
  for (const [value, label] of options) addOption(label, value)
  for (const format of formats) addOption(t(format.label), `format:${format.token}`)

  let pointerDriven = false
  select.addEventListener('pointerdown', () => { pointerDriven = true })
  select.addEventListener('mousedown', (event) => event.stopPropagation())
  select.addEventListener('keydown', (event) => {
    pointerDriven = false
    if (event.key === 'Enter') {
      event.preventDefault()
      view.focus()
    }
  })
  select.addEventListener('change', () => {
    if (host.hasAttribute('readonly')) return
    const value = select.value
    if (value.startsWith('format:')) {
      const { element, className } = formatParts(value.slice('format:'.length))
      if (element === 'p') setParagraph(view.state, view.dispatch, view)
      else if (element !== null && /^h[1-6]$/.test(element)) {
        setHeading(Number(element.slice(1)))(view.state, view.dispatch, view)
      }
      setBlockClass(className)(view.state, view.dispatch, view)
    } else {
      const command = value === 'p' ? setParagraph : toggleHeading(Number(value))
      command(view.state, view.dispatch, view)
    }
    if (pointerDriven) {
      pointerDriven = false
      view.focus()
    }
  })

  return {
    el: select,
    focusable: select,
    update(state: EditorState) {
      select.setAttribute('aria-disabled', host.hasAttribute('readonly') ? 'true' : 'false')
      const formatClass = activeBlockClass(state)
      const level = activeHeadingLevel(state)
      const activeElement = level === null ? 'p' : `h${level}`
      const matching = formats.find((format) => {
        const { element, className } = formatParts(format.token)
        return className === formatClass && (element === null || element === activeElement)
      })
      const next = matching ? `format:${matching.token}` : level === null ? 'p' : String(level)
      if (select.value !== next) select.value = next
    },
  }
}
