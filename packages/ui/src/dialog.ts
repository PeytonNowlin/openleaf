/**
 * Link and image dialogs, built on the native `<dialog>` element.
 *
 * `showModal()` supplies the focus trap, the Escape handler, the inert
 * background and the top-layer stacking for free. Hand-rolling those with ARIA
 * is a few hundred lines that would then owe real screen reader testing to be
 * worth anything, and the native element is already tested by the browser
 * vendors. Choosing it is the single biggest accessibility win available here.
 *
 * ## Why committing is asynchronous
 *
 * The image dialog uploads a file, and an upload is the one thing in this editor
 * that can take five seconds and fail for a reason the author needs to read. So
 * the form's commit step returns a promise: the dialog stays open while it runs,
 * disables its buttons, says what it is doing in a polite live region, and on
 * failure shows the message and keeps everything the author typed.
 *
 * The alternative -- close the dialog, upload in the background, report through a
 * toast -- loses the alt text they wrote when the upload fails, and makes the
 * retry a whole new dialog.
 */

import { ensureStyles } from './styles.js'
import { IMAGE_ACCEPT, dimension, type ImageUploadResult } from './upload.js'

export interface LinkResult {
  href: string
  target: string | null
  rel: string | null
}

export interface ImageResult {
  src: string
  /** `''` means explicitly decorative. `null` is never returned. */
  alt: string
  /** Intrinsic size, when an uploader reported one. */
  width: string | null
  height: string | null
}

export interface FieldOption {
  value: string
  label: string
}

export interface FieldSpec {
  name: string
  label: string
  type?: string
  value?: string
  required?: boolean
  hint?: string
  /** For `type: 'file'`: the accept list. */
  accept?: string
  /** For `type: 'select'`. */
  options?: readonly FieldOption[]
}

/** What a commit attempt produced: a value to resolve with, or a message to show. */
type Commit<T> = (
  values: Record<string, string>,
  files: Record<string, File | undefined>,
) => Promise<{ value: T } | { error: string }> | { value: T } | { error: string }

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
.ol-dialog input[type="text"], .ol-dialog input[type="url"], .ol-dialog input[type="file"],
.ol-dialog input[type="color"], .ol-dialog input[type="number"], .ol-dialog select {
  box-sizing: border-box; width: 100%; padding: 6px 8px;
  border: 1px solid var(--openleaf-color-border, #d1d9e0);
  border-radius: var(--openleaf-radius, 4px);
  background: var(--openleaf-color-surface, #fff);
  color: inherit; font: inherit;
}
.ol-dialog input[type="color"] { height: 2.25rem; padding: 2px; }
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
.ol-dialog button[aria-disabled="true"] { opacity: .55; cursor: default; }
.ol-dialog .ol-error { color: #cf222e; font-size: .9em; min-height: 1.2em; }
.ol-dialog .ol-progress { font-size: .9em; opacity: .8; min-height: 1.2em; }
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
 * Build and show a modal form, resolving to whatever `commit` produced or null
 * on cancel.
 *
 * Focus is returned to whatever held it before opening. `<dialog>` does this
 * itself in current browsers, but it is done explicitly because "where did my
 * cursor go" is the most common complaint about editor dialogs and relying on
 * an implementation detail for it is not good enough.
 */
function showForm<T>(
  doc: Document,
  title: string,
  fields: FieldSpec[],
  options: {
    extraCheckbox?: { name: string; label: string; hint?: string; checked?: boolean }
    /** Static text above the fields, for something the author has already chosen. */
    note?: string
    /** What the primary button says while `commit` is running. */
    busyLabel?: string
  } = {},
  commit: Commit<T> = () => ({ error: 'This form has nothing to do.' }),
): Promise<T | null> {
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

  if (options.note) {
    const note = doc.createElement('div')
    note.className = 'ol-hint'
    note.textContent = options.note
    form.appendChild(note)
  }

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>()
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
    if (field.type === 'select') {
      const select = doc.createElement('select')
      select.name = field.name
      for (const option of field.options ?? []) {
        const el = doc.createElement('option')
        el.value = option.value
        el.textContent = option.label
        select.appendChild(el)
      }
      select.value = field.value ?? ''
      label.appendChild(select)
      inputs.set(field.name, select)
    } else {
      const input = doc.createElement('input')
      input.type = field.type ?? 'text'
      input.name = field.name
      if (field.type === 'file') {
        if (field.accept) input.accept = field.accept
      } else {
        input.value = field.value ?? ''
      }
      // `required` is deliberately not set on the element. The browser's own
      // validation bubble cannot be read by a screen reader in every engine and
      // cannot express "one of these two fields"; the commit step reports into a
      // live region instead.
      label.appendChild(input)
      inputs.set(field.name, input)
    }
    form.appendChild(label)
  }

  let checkbox: HTMLInputElement | null = null
  if (options.extraCheckbox) {
    const wrap = doc.createElement('label')
    wrap.className = 'ol-check'
    checkbox = doc.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.name = options.extraCheckbox.name
    checkbox.checked = options.extraCheckbox.checked === true
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

  // Progress and failure are separate regions with different urgency. An upload
  // starting is polite news; an upload failing is something the author must act
  // on, and role="alert" is what makes it interrupt.
  const progress = doc.createElement('div')
  progress.className = 'ol-progress'
  progress.setAttribute('role', 'status')
  progress.setAttribute('aria-live', 'polite')
  form.appendChild(progress)

  const error = doc.createElement('div')
  error.className = 'ol-error'
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
    let busy = false

    const finish = (result: T | null): void => {
      dialog.close()
      dialog.remove()
      previouslyFocused?.focus?.()
      resolve(result)
    }

    const setBusy = (value: boolean): void => {
      busy = value
      form.setAttribute('aria-busy', value ? 'true' : 'false')
      for (const button of [ok, cancel]) {
        // aria-disabled rather than the disabled attribute, for the same reason
        // the toolbar uses it: a disabled button leaves the tab order, so a
        // screen reader user loses track of where they are mid-upload.
        button.setAttribute('aria-disabled', value ? 'true' : 'false')
      }
      ok.textContent = value ? (options.busyLabel ?? 'Working…') : 'Save'
      progress.textContent = value ? (options.busyLabel ?? 'Working…') : ''
    }

    cancel.addEventListener('click', () => {
      // Cancelling mid-upload abandons the result rather than the request: there
      // is no portable way to cancel somebody else's fetch, and pretending
      // otherwise would leave the author thinking nothing was sent.
      if (!busy) finish(null)
    })
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      if (!busy) finish(null)
    })

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (busy) return

      const values: Record<string, string> = {}
      const files: Record<string, File | undefined> = {}
      for (const [name, input] of inputs) {
        if (input instanceof HTMLInputElement && input.type === 'file') files[name] = input.files?.[0]
        else values[name] = input.value.trim()
      }
      if (checkbox) values[checkbox.name] = checkbox.checked ? 'on' : ''

      error.textContent = ''
      let outcome: ReturnType<Commit<T>>
      try {
        outcome = commit(values, files)
      } catch (thrown) {
        error.textContent = messageFrom(thrown)
        return
      }

      if (!(outcome instanceof Promise)) {
        if ('error' in outcome) {
          error.textContent = outcome.error
          focusFirst()
          return
        }
        finish(outcome.value)
        return
      }

      setBusy(true)
      void outcome
        .then((settled) => {
          setBusy(false)
          if ('error' in settled) {
            error.textContent = settled.error
            focusFirst()
            return
          }
          finish(settled.value)
        })
        .catch((thrown: unknown) => {
          setBusy(false)
          error.textContent = messageFrom(thrown)
        })
    })

    const focusFirst = (): void => {
      const first = fields[0] ? inputs.get(fields[0].name) : undefined
      first?.focus()
    }

    dialog.showModal()
    focusFirst()
    const first = fields[0] ? inputs.get(fields[0].name) : undefined
    if (first instanceof HTMLInputElement && first.type !== 'file') first.select()
  })
}

/** A failure message worth showing an author, from whatever was thrown. */
function messageFrom(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  return message === '' ? 'Something went wrong.' : message
}

function hash(value: string): number {
  let out = 0
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) | 0
  return out
}

export interface PromptFormOptions {
  extraCheckbox?: { name: string; label: string; hint?: string; checked?: boolean }
  note?: string
  busyLabel?: string
}

/**
 * A generic modal form, used by table property dialogs and anything else that
 * is a handful of labelled fields rather than a specialised prompt.
 */
export function promptFields<T>(
  doc: Document,
  title: string,
  fields: FieldSpec[],
  options: PromptFormOptions,
  commit: (
    values: Record<string, string>,
    files: Record<string, File | undefined>,
  ) => Promise<{ value: T } | { error: string }> | { value: T } | { error: string },
): Promise<T | null> {
  return showForm(doc, title, fields, options, commit)
}

export async function promptForLink(
  doc: Document,
  existing?: { href?: string; target?: string | null },
): Promise<LinkResult | null> {
  return showForm<LinkResult>(
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
        checked: existing?.target === '_blank',
        hint:
          'Opening in a new window without warning can disorient people using ' +
          'screen readers or magnification. Leave this off unless you have a reason.',
      },
    },
    (values) => {
      const href = values['href'] ?? ''
      if (!href) return { error: 'Enter an address for the link.' }
      const newWindow = values['newWindow'] === 'on'
      return {
        value: {
          href,
          target: newWindow ? '_blank' : null,
          // rel="noopener" is not optional with target=_blank: without it the
          // opened page gets a handle on this window.
          rel: newWindow ? 'noopener noreferrer' : null,
        },
      }
    },
  )
}

export interface ImagePromptOptions {
  /**
   * A file the author has already chosen, by dropping or pasting it.
   *
   * When present the dialog does not offer a picker or an address field: the
   * source is settled and the only open question is the description.
   */
  file?: File
  /** Uploads a file and reports where it landed. Absent means URL-only. */
  upload?: (file: File) => Promise<ImageUploadResult>
}

/**
 * Ask for an image.
 *
 * The alternative text is asked for in the same dialog as the file, and this is
 * the reason the upload happens on submit rather than on selection: one dialog
 * means one decision point, and there is no path through it that inserts an
 * image nobody described. A drop that uploaded immediately and asked afterwards
 * would leave an undescribed image in the document every time somebody cancelled
 * -- and OpenLeaf has no image-editing dialog yet, so "afterwards" would mean
 * never.
 */
export async function promptForImage(
  doc: Document,
  options: ImagePromptOptions = {},
): Promise<ImageResult | null> {
  const { file, upload } = options

  const describe: FieldSpec = {
    name: 'alt',
    label: 'Alternative text',
    type: 'text',
    hint: 'Describe what the image shows, for people who cannot see it.',
  }

  const fields: FieldSpec[] = file
    ? [describe]
    : [
        ...(upload
          ? [
              {
                name: 'file',
                label: 'Choose a file',
                type: 'file',
                accept: IMAGE_ACCEPT,
                hint: 'PNG, JPEG, GIF, WebP or AVIF.',
              },
            ]
          : []),
        {
          name: 'src',
          label: upload ? 'Or paste an image address' : 'Image address',
          type: 'text',
          required: !upload,
        },
        describe,
      ]

  const decorative = {
    name: 'decorative',
    label: 'This image is decorative and needs no description',
  }

  return showForm<ImageResult>(
    doc,
    file ? 'Describe this image' : 'Insert image',
    fields,
    {
      extraCheckbox: decorative,
      ...(file ? { note: `Ready to upload: ${file.name}` } : {}),
      busyLabel: 'Uploading…',
    },
    (values, files) => {
      const chosen = file ?? files['file']
      const src = values['src'] ?? ''

      if (!chosen && !src) {
        return { error: upload ? 'Choose a file or enter an image address.' : 'Enter an image address.' }
      }
      // Required unless explicitly marked decorative. The checkbox exists so
      // that the honest answer "this needs no description" is easier than
      // typing "image" to defeat a validator -- which is what a hard
      // requirement actually teaches people to do.
      if (!values['alt'] && values['decorative'] !== 'on') {
        return { error: 'Add alternative text, or tick the decorative box.' }
      }

      const alt = values['decorative'] === 'on' ? '' : (values['alt'] ?? '')

      if (!chosen || !upload) {
        return { value: { src, alt, width: null, height: null } }
      }

      return upload(chosen).then((result) => ({
        value: {
          src: result.src,
          // An uploader's description only pre-fills; what the author confirmed
          // in the dialog is what gets stored.
          alt,
          width: dimension(result.width),
          height: dimension(result.height),
        },
      }))
    },
  )
}
