/**
 * Link and image dialogs, built on the native `<dialog>` element.
 *
 * `showModal()` supplies the focus trap, the Escape handler, the inert
 * background and the top-layer stacking for free. Hand-rolling those with ARIA
 * is a few hundred lines that would then owe real screen reader testing to be
 * worth anything, and the native element is already tested by the browser
 * vendors. Choosing it is the single biggest accessibility win available here.
 */

import { ensureStyles } from './styles.js'

export interface LinkResult {
  href: string
  target: string | null
  rel: string | null
}

export interface ImageResult {
  src: string
  /** `''` means explicitly decorative. `null` is never returned. */
  alt: string
}

interface FieldSpec {
  name: string
  label: string
  type?: string
  value?: string
  required?: boolean
  hint?: string
}

const DIALOG_CSS = `
.ol-dialog {
  box-sizing: border-box;
  max-width: min(28rem, calc(100vw - 2rem));
  padding: 0;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 6px);
  background: var(--openleaf-color-surface, #fff);
  color: var(--openleaf-color-text, #1f2328);
  font-family: var(--openleaf-font, system-ui, -apple-system, sans-serif);
  font-size: var(--openleaf-font-size, 14px);
}
.ol-dialog::backdrop { background: rgb(0 0 0 / 40%); }
.ol-dialog form { display: grid; gap: 12px; padding: 16px; margin: 0; }
.ol-dialog h2 { margin: 0; font-size: 1.1em; }
.ol-dialog label { display: grid; gap: 4px; font-weight: 500; }
.ol-dialog .ol-hint { font-weight: 400; font-size: .9em; opacity: .75; }
.ol-dialog input[type="text"], .ol-dialog input[type="url"] {
  box-sizing: border-box; width: 100%; padding: 6px 8px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: var(--openleaf-color-surface, #fff);
  color: inherit; font: inherit;
}
.ol-dialog .ol-check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.ol-dialog .ol-check input { margin: 0; }
.ol-dialog .ol-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ol-dialog button {
  box-sizing: border-box; padding: 6px 12px; margin: 0;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: transparent; color: inherit; font: inherit; cursor: pointer;
  appearance: none; -webkit-appearance: none;
}
.ol-dialog button[value="ok"] {
  border-color: var(--openleaf-color-accent, #0550ae);
  background: var(--openleaf-color-accent, #0550ae);
  color: #fff;
}
.ol-dialog button:focus-visible {
  outline: 2px solid var(--openleaf-color-focus, #0969da); outline-offset: 1px;
}
.ol-dialog .ol-error { color: #cf222e; font-size: .9em; min-height: 1.2em; }
`

let dialogStylesReady = false

function ensureDialogStyles(doc: Document): void {
  ensureStyles(doc)
  if (dialogStylesReady) return
  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(DIALOG_CSS)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      dialogStylesReady = true
      return
    }
  } catch {
    /* fall through */
  }
  const style = doc.createElement('style')
  style.textContent = DIALOG_CSS
  doc.head.appendChild(style)
  dialogStylesReady = true
}

/**
 * Build and show a modal form, resolving to the field values or null on cancel.
 *
 * Focus is returned to whatever held it before opening. `<dialog>` does this
 * itself in current browsers, but it is done explicitly because "where did my
 * cursor go" is the most common complaint about editor dialogs and relying on
 * an implementation detail for it is not good enough.
 */
function showForm(
  doc: Document,
  title: string,
  fields: FieldSpec[],
  options: { extraCheckbox?: { name: string; label: string; hint?: string } } = {},
  validate?: (values: Record<string, string>) => string | null,
): Promise<Record<string, string> | null> {
  ensureDialogStyles(doc)
  const previouslyFocused = doc.activeElement as HTMLElement | null

  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog'

  const form = doc.createElement('form')
  form.method = 'dialog'

  const heading = doc.createElement('h2')
  heading.textContent = title
  const headingId = `ol-dlg-${Math.abs(hash(title))}`
  heading.id = headingId
  dialog.setAttribute('aria-labelledby', headingId)
  form.appendChild(heading)

  const inputs = new Map<string, HTMLInputElement>()
  for (const field of fields) {
    const label = doc.createElement('label')
    const text = doc.createElement('span')
    text.textContent = field.label
    label.appendChild(text)
    if (field.hint) {
      const hint = doc.createElement('span')
      hint.className = 'ol-hint'
      hint.textContent = field.hint
      label.appendChild(hint)
    }
    const input = doc.createElement('input')
    input.type = field.type ?? 'text'
    input.name = field.name
    input.value = field.value ?? ''
    if (field.required) input.required = true
    label.appendChild(input)
    inputs.set(field.name, input)
    form.appendChild(label)
  }

  let checkbox: HTMLInputElement | null = null
  if (options.extraCheckbox) {
    const wrap = doc.createElement('label')
    wrap.className = 'ol-check'
    checkbox = doc.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.name = options.extraCheckbox.name
    wrap.appendChild(checkbox)
    const span = doc.createElement('span')
    span.textContent = options.extraCheckbox.label
    wrap.appendChild(span)
    form.appendChild(wrap)
    if (options.extraCheckbox.hint) {
      const hint = doc.createElement('div')
      hint.className = 'ol-hint'
      hint.textContent = options.extraCheckbox.hint
      form.appendChild(hint)
    }
  }

  const error = doc.createElement('div')
  error.className = 'ol-error'
  // Announced when it changes, so a validation failure is not silent for a
  // screen reader user who cannot see the red text appear.
  error.setAttribute('role', 'alert')
  form.appendChild(error)

  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  const ok = doc.createElement('button')
  ok.type = 'submit'
  ok.value = 'ok'
  ok.textContent = 'Save'
  actions.append(cancel, ok)
  form.appendChild(actions)

  dialog.appendChild(form)
  doc.body.appendChild(dialog)

  return new Promise((resolve) => {
    const finish = (result: Record<string, string> | null): void => {
      dialog.close()
      dialog.remove()
      previouslyFocused?.focus?.()
      resolve(result)
    }

    cancel.addEventListener('click', () => finish(null))
    // Escape fires `cancel` on <dialog>; treat it as a cancel, not a save.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const values: Record<string, string> = {}
      for (const [name, input] of inputs) values[name] = input.value.trim()
      if (checkbox) values[checkbox.name] = checkbox.checked ? 'on' : ''

      const message = validate?.(values) ?? null
      if (message) {
        error.textContent = message
        const first = fields.find((f) => f.required)
        if (first) inputs.get(first.name)?.focus()
        return
      }
      finish(values)
    })

    dialog.showModal()
    const firstInput = fields[0] ? inputs.get(fields[0].name) : undefined
    firstInput?.focus()
    firstInput?.select()
  })
}

function hash(value: string): number {
  let out = 0
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) | 0
  return out
}

export async function promptForLink(
  doc: Document,
  existing?: { href?: string; target?: string | null },
): Promise<LinkResult | null> {
  const values = await showForm(
    doc,
    existing?.href ? 'Edit link' : 'Insert link',
    [
      {
        name: 'href',
        label: 'Address',
        type: 'text',
        value: existing?.href ?? '',
        required: true,
        hint: 'For example https://example.org, /about, or mailto:someone@example.org',
      },
    ],
    {
      extraCheckbox: {
        name: 'newWindow',
        label: 'Open in a new window',
        hint:
          'Opening in a new window without warning can disorient people using ' +
          'screen readers or magnification. Leave this off unless you have a reason.',
      },
    },
    (v) => (v['href'] ? null : 'Enter an address for the link.'),
  )
  if (!values) return null

  const newWindow = values['newWindow'] === 'on'
  return {
    href: values['href'] ?? '',
    target: newWindow ? '_blank' : null,
    // rel="noopener" is not optional with target=_blank: without it the opened
    // page gets a handle on this window.
    rel: newWindow ? 'noopener noreferrer' : null,
  }
}

export async function promptForImage(doc: Document): Promise<ImageResult | null> {
  const values = await showForm(
    doc,
    'Insert image',
    [
      { name: 'src', label: 'Image address', type: 'text', required: true },
      {
        name: 'alt',
        label: 'Alternative text',
        type: 'text',
        hint: 'Describe what the image shows, for people who cannot see it.',
      },
    ],
    {
      extraCheckbox: {
        name: 'decorative',
        label: 'This image is decorative and needs no description',
      },
    },
    (v) => {
      if (!v['src']) return 'Enter an image address.'
      // Required unless explicitly marked decorative. The checkbox exists so
      // that the honest answer "this needs no description" is easier than
      // typing "image" to defeat a validator -- which is what a hard
      // requirement actually teaches people to do.
      if (!v['alt'] && v['decorative'] !== 'on') {
        return 'Add alternative text, or tick the decorative box.'
      }
      return null
    },
  )
  if (!values) return null

  return {
    src: values['src'] ?? '',
    // Explicitly empty for decorative images: alt="" tells a screen reader to
    // skip it, whereas a missing alt makes it read the filename.
    alt: values['decorative'] === 'on' ? '' : (values['alt'] ?? ''),
  }
}
