import {
  activeBlockClass,
  activeHeadingLevel,
  formatParts,
  isNodeActive,
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
  // Empty value for selections that are not a paragraph or heading (a figure
  // caption). Without it the control would display "Paragraph" over a node
  // setParagraph cannot convert.
  addOption('', '')
  select.options[0]!.hidden = true
  select.options[0]!.disabled = true
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
    // `select.disabled` as well as the attribute, because readonly is not the
    // only reason this control goes unavailable: the toolbar disables it in
    // source view too, where the document this would format is hidden behind a
    // textarea that gets reparsed over the result. A native disabled select
    // cannot fire `change` at all -- this is the guard for a synthetic one, and
    // for the window before the first `update()`.
    if (host.hasAttribute('readonly') || select.disabled) return
    const value = select.value
    if (!value) return
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
      // Both, and the real `disabled` is the load-bearing half: with only
      // `aria-disabled` the control still opened and still changed its own
      // displayed value, so a readonly editor showed "Heading 2" over a document
      // that was still a paragraph.
      const readonly = host.hasAttribute('readonly')
      select.setAttribute('aria-disabled', readonly ? 'true' : 'false')
      select.disabled = readonly
      for (const option of Array.from(select.options)) {
        if (option.value === '') continue
        option.disabled = readonly || !blockTypeAvailable(state, option.value)
      }
      const formatClass = activeBlockClass(state)
      const level = activeHeadingLevel(state)
      const inParagraph = isNodeActive(state, 'paragraph')
      const activeElement = level === null ? (inParagraph ? 'p' : null) : `h${level}`
      const matching = formats.find((format) => {
        const { element, className } = formatParts(format.token)
        return className === formatClass && (element === null || element === activeElement)
      })
      const next = matching
        ? `format:${matching.token}`
        : level !== null
          ? String(level)
          : inParagraph
            ? 'p'
            : ''
      if (select.value !== next) select.value = next
    },
  }
}

/**
 * Whether this dropdown entry's command would apply. A figure is a textblock
 * but not a paragraph; without this check Heading and Paragraph stay enabled
 * in a caption and choosing one destroys the figure.
 */
function blockTypeAvailable(state: EditorState, value: string): boolean {
  if (value.startsWith('format:')) {
    const { element } = formatParts(value.slice('format:'.length))
    if (element === 'p') return setParagraph(state)
    if (element !== null && /^h[1-6]$/.test(element)) {
      return setHeading(Number(element.slice(1)))(state)
    }
    return true
  }
  if (value === 'p') return setParagraph(state)
  return setHeading(Number(value))(state)
}
