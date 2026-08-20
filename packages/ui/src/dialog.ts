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

import { t, withLocale } from './i18n.js'
import { ensureStyles } from './styles.js'
import { IMAGE_ACCEPT, dimension, type ImageUploadResult } from './upload.js'
import {
  filePickerFor,
  listedImageClasses,
  listedImages,
  listedLinks,
} from './pickers.js'

export interface LinkResult {
  href: string
  title: string | null
  target: string | null
  rel: string | null
}

export interface ImageResult {
  src: string
  /** `''` means explicitly decorative. `null` is never returned. */
  alt: string
  title: string | null
  /** Intrinsic size, when an uploader reported one. */
  width: string | null
  height: string | null
  className: string | null
  align: 'left' | 'right' | 'center' | null
  caption: string | null
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
  /** When set, the field is a `<select>` rather than an input. */
  options?: readonly FieldOption[]
  /**
   * The field this control writes into when it changes.
   *
   * A chooser that only *contributed* its value could never change a field that
   * was already filled in: editing a link or an image prefills the address, so
   * picking from the list lost to it every time and the list worked only for new
   * insertions. Writing into the field it fills keeps one source of truth, and
   * shows the author what they picked so they can still edit it.
   */
  fills?: string
}

/**
 * A commit failure.
 *
 * `field` names the control the message is about, when there is one. Without it
 * a failed submit could only mark the FIRST field invalid and focus it, which is
 * a guess -- and a wrong `aria-invalid` is worse for a screen reader user than
 * none, because it sends them to correct a field that was already right.
 */
export interface CommitError {
  error: string
  field?: string
}

/** What a commit attempt produced: a value to resolve with, or a message to show. */
type Commit<T> = (
  values: Record<string, string>,
  files: Record<string, File | undefined>,
) => Promise<{ value: T } | CommitError> | { value: T } | CommitError

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
/* The field, not the label, is the grid: the hint sits between the two as the
   control's DESCRIPTION rather than folding into its accessible name. */
.ol-dialog .ol-field { display: grid; gap: 4px; }
.ol-dialog label { font-weight: 500; }
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

export function ensureDialogStyles(doc: Document): void {
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
    /** A button that fills fields from a shared file picker. */
    browse?: { label: string; fill: () => Promise<Record<string, string> | null> }
    /**
     * The editor's own `lang`.
     *
     * Scoped rather than global, for the reason the toolbar already gives: two
     * editors with different languages on one page must not overwrite each
     * other. Without it this whole file was English -- including the accessible
     * names of Cancel and Save, and every hint a screen reader reads as the
     * description of a field.
     */
    locale?: string | null
  } = {},
  commit: Commit<T> = () => ({ error: 'This form has nothing to do.' }),
): Promise<T | null> {
  const locale = options.locale ?? null
  return withLocale(locale, () => buildForm(doc, locale, title, fields, options, commit))
}

function buildForm<T>(
  doc: Document,
  locale: string | null,
  title: string,
  fields: FieldSpec[],
  options: {
    extraCheckbox?: { name: string; label: string; hint?: string; checked?: boolean }
    note?: string
    busyLabel?: string
    browse?: { label: string; fill: () => Promise<Record<string, string> | null> }
    locale?: string | null
  },
  commit: Commit<T>,
): Promise<T | null> {
  ensureDialogStyles(doc)
  const previouslyFocused = doc.activeElement as HTMLElement | null

  const dialog = doc.createElement('dialog')
  dialog.className = 'ol-dialog'

  const form = doc.createElement('form')
  form.method = 'dialog'

  const heading = doc.createElement('h2')
  heading.textContent = t(title)
  // A counter, not a hash of the title. Two dialogs with the same title -- two
  // editors on one page, or a prompt reopened -- produced the same id, and
  // `aria-labelledby` then resolved to whichever came first in the document.
  const headingId = nextDialogId('t')
  heading.id = headingId
  dialog.setAttribute('aria-labelledby', headingId)
  form.appendChild(heading)

  if (options.note) {
    const note = doc.createElement('div')
    note.className = 'ol-hint'
    note.textContent = t(options.note)
    form.appendChild(note)
  }

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>()
  /** Each control's own hint id, so the error can be added without losing it. */
  const described = new Map<string, string[]>()
  for (const field of fields) {
    const wrap = doc.createElement('div')
    wrap.className = 'ol-field'

    const controlId = nextDialogId('c')
    const label = doc.createElement('label')
    label.htmlFor = controlId
    label.textContent = t(field.label)
    wrap.appendChild(label)

    const describedBy: string[] = []
    if (field.hint) {
      // Outside the <label>, and referenced instead of contained. As a child of
      // the label it folded into the accessible NAME, so the address field was
      // called "Address For example https://example.org, /about, or
      // mailto:someone@example.org" -- which is not a name anybody can use.
      const hintId = nextDialogId('h')
      const hint = doc.createElement('span')
      hint.id = hintId
      hint.className = 'ol-hint'
      hint.textContent = t(field.hint)
      wrap.appendChild(hint)
      describedBy.push(hintId)
    }

    let control: HTMLInputElement | HTMLSelectElement
    if (field.options) {
      const select = doc.createElement('select')
      select.name = field.name
      for (const option of field.options) {
        const item = doc.createElement('option')
        item.value = option.value
        item.textContent = t(option.label)
        if (option.value === (field.value ?? '')) item.selected = true
        select.appendChild(item)
      }
      control = select
    } else {
      const input = doc.createElement('input')
      input.type = field.type ?? 'text'
      input.name = field.name
      if (field.type === 'file') {
        if (field.accept) input.accept = field.accept
      } else {
        input.value = field.value ?? ''
      }
      control = input
    }
    control.id = controlId
    // `required` is deliberately not set on the element. The browser's own
    // validation bubble cannot be read by a screen reader in every engine and
    // cannot express "one of these two fields"; the commit step reports into a
    // live region instead. `aria-required` still has to say so, though -- the
    // omission left the field announcing nothing about being mandatory.
    if (field.required === true) control.setAttribute('aria-required', 'true')
    if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '))
    described.set(field.name, describedBy)
    wrap.appendChild(control)
    inputs.set(field.name, control)
    form.appendChild(wrap)
  }

  // Wired after the loop, so a chooser can fill a field declared after it.
  for (const field of fields) {
    if (!field.fills) continue
    const source = inputs.get(field.name)
    const target = inputs.get(field.fills)
    if (!source || !target) continue
    source.addEventListener('change', () => {
      if (source.value !== '') target.value = source.value
    })
  }

  if (options.browse) {
    const browse = doc.createElement('button')
    browse.type = 'button'
    browse.textContent = t(options.browse.label)
    browse.addEventListener('click', () => {
      void options.browse?.fill().then((filled) => {
        if (!filled) return
        for (const [name, value] of Object.entries(filled)) {
          const control = inputs.get(name)
          if (control && control instanceof HTMLInputElement && control.type !== 'file') {
            control.value = value
          } else if (control) {
            control.value = value
          }
        }
      })
    })
    form.appendChild(browse)
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
    span.textContent = t(options.extraCheckbox.label)
    wrap.appendChild(span)
    form.appendChild(wrap)
    if (options.extraCheckbox.hint) {
      const hintId = nextDialogId('h')
      const hint = doc.createElement('div')
      hint.id = hintId
      hint.className = 'ol-hint'
      hint.textContent = t(options.extraCheckbox.hint)
      form.appendChild(hint)
      // The new-window warning is the reason this hint exists; a checkbox that
      // does not point at it is a checkbox whose warning is never read.
      checkbox.setAttribute('aria-describedby', hintId)
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
  const errorId = nextDialogId('e')
  error.id = errorId
  error.className = 'ol-error'
  error.setAttribute('role', 'alert')
  form.appendChild(error)

  // Translated once, in scope. `setBusy` runs after an await, long outside any
  // synchronous locale scope, so reading these later would give English.
  const saveLabel = t('Save')
  const busyLabel = t(options.busyLabel ?? 'Working…')

  const actions = doc.createElement('div')
  actions.className = 'ol-actions'
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  cancel.textContent = t('Cancel')
  const ok = doc.createElement('button')
  ok.type = 'submit'
  ok.value = 'ok'
  ok.textContent = saveLabel
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
      ok.textContent = value ? busyLabel : saveLabel
      progress.textContent = value ? busyLabel : ''
    }

    /**
     * Show a failure, and put a screen reader user on the field it is about.
     *
     * `role="alert"` announces the text; `aria-invalid` plus the description is
     * what makes the field itself say what is wrong when they arrive on it.
     */
    const showError = (failure: CommitError): void => {
      error.textContent = failure.error
      for (const [name, control] of inputs) {
        const own = described.get(name) ?? []
        const invalid = failure.field !== undefined && failure.field === name
        control.setAttribute('aria-invalid', invalid ? 'true' : 'false')
        const ids = invalid ? [...own, errorId] : own
        if (ids.length > 0) control.setAttribute('aria-describedby', ids.join(' '))
        else control.removeAttribute('aria-describedby')
      }
      const target = failure.field ? inputs.get(failure.field) : undefined
      ;(target ?? firstControl())?.focus()
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
        // In scope: the messages a commit produces are the ones a screen reader
        // reads, so they are translated in the editor's language, not the page's.
        outcome = withLocale(locale, () => commit(values, files))
      } catch (thrown) {
        showError({ error: messageFrom(thrown) })
        return
      }

      if (!(outcome instanceof Promise)) {
        if ('error' in outcome) {
          showError(outcome)
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
            showError(settled)
            return
          }
          finish(settled.value)
        })
        .catch((thrown: unknown) => {
          setBusy(false)
          showError({ error: messageFrom(thrown) })
        })
    })

    const firstControl = (): HTMLInputElement | HTMLSelectElement | undefined =>
      fields[0] ? inputs.get(fields[0].name) : undefined

    dialog.showModal()
    const first = firstControl()
    first?.focus()
    if (first instanceof HTMLInputElement && first.type !== 'file') first.select()
  })
}

/** A failure message worth showing an author, from whatever was thrown. */
function messageFrom(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  return message === '' ? t('Something went wrong.') : message
}

/**
 * Unique ids for one dialog's parts.
 *
 * Previously a hash of the title, so two dialogs with the same title -- two
 * editors on a page, or the same prompt reopened -- shared ids and every
 * `aria-labelledby` resolved to whichever was first in the document.
 */
let idCounter = 0

function nextDialogId(kind: string): string {
  idCounter += 1
  return `ol-dlg-${kind}${idCounter}`
}

export interface PromptFormOptions {
  extraCheckbox?: { name: string; label: string; hint?: string; checked?: boolean }
  note?: string
  busyLabel?: string
  /** The editor's own `lang`, so two editors on a page do not share a language. */
  locale?: string | null
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
  existing?: { href?: string; title?: string | null; target?: string | null },
  host?: HTMLElement,
): Promise<LinkResult | null> {
  const listed = listedLinks()
  const picker = host ? filePickerFor(host) : null
  const locale = host?.getAttribute('lang') ?? null
  const fields: FieldSpec[] = [
    ...(listed.length > 0
      ? [
          {
            name: 'listed',
            label: 'Choose a page',
            options: [{ value: '', label: 'Type an address instead' }, ...listed.map((item) => ({ value: item.value, label: item.title }))],
            fills: 'href',
          },
        ]
      : []),
    {
      name: 'href',
      label: 'Address',
      type: 'text',
      value: existing?.href ?? '',
      required: true,
      hint: 'For example https://example.org, /about, or mailto:someone@example.org',
    },
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      value: existing?.title ?? '',
      hint: 'Shown as a tooltip. Optional.',
    },
  ]

  return showForm<LinkResult>(
    doc,
    existing?.href ? 'Edit link' : 'Insert link',
    fields,
    {
      locale,
      extraCheckbox: {
        name: 'newWindow',
        label: 'Open in a new window',
        checked: existing?.target === '_blank',
        hint:
          'Opening in a new window without warning can disorient people using ' +
          'screen readers or magnification. Leave this off unless you have a reason.',
      },
      ...(picker && host
        ? {
            browse: {
              label: 'Browse files',
              fill: async () => {
                const picked = await picker({ kind: 'file', host })
                if (!picked) return null
                return { href: picked.url, title: picked.title ?? '' }
              },
            },
          }
        : {}),
    },
    (values) => {
      // The address field alone: choosing from the list writes into it, so there
      // is no second place a destination can hide.
      const href = values['href'] || ''
      if (!href) return { error: t('Enter an address for the link.'), field: 'href' }
      const newWindow = values['newWindow'] === 'on'
      return {
        value: {
          href,
          title: values['title'] || null,
          target: newWindow ? '_blank' : null,
          rel: newWindow ? 'noopener noreferrer' : null,
        },
      }
    },
  )
}

export interface ImagePromptOptions {
  file?: File
  upload?: (file: File) => Promise<ImageUploadResult>
  host?: HTMLElement
  existing?: {
    src?: string
    alt?: string | null
    title?: string | null
    className?: string | null
    align?: 'left' | 'right' | 'center' | null
    caption?: string | null
  }
}

export async function promptForImage(
  doc: Document,
  options: ImagePromptOptions = {},
): Promise<ImageResult | null> {
  const { file, upload, host, existing } = options
  const listed = listedImages()
  const classes = listedImageClasses()
  const picker = host ? filePickerFor(host) : null
  const locale = host?.getAttribute('lang') ?? null
  // Interpolated strings are translated here rather than in the form builder,
  // because a template plus a value is one string the catalog has to own -- and
  // this is the only place that has the value.
  const inLocale = (source: string, values: Record<string, string> = {}): string =>
    withLocale(locale, () =>
      t(source).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole),
    )

  const describe: FieldSpec = {
    name: 'alt',
    label: 'Alternative text',
    type: 'text',
    value: existing?.alt ?? '',
    hint: 'Describe what the image shows, for people who cannot see it.',
  }

  const extras: FieldSpec[] = [
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      value: existing?.title ?? '',
      hint: 'Shown as a tooltip. Optional.',
    },
    {
      name: 'align',
      label: 'Alignment',
      options: [
        { value: '', label: 'None' },
        { value: 'left', label: 'Float left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Float right' },
      ],
      value: existing?.align ?? '',
    },
    {
      name: 'className',
      label: 'CSS classes',
      type: 'text',
      value: existing?.className ?? '',
      hint:
        classes.length > 0
          ? inLocale('Suggested: {classes}', { classes: classes.join(', ') })
          : 'Optional class names, separated by spaces.',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'text',
      value: existing?.caption ?? '',
      hint: 'Wraps the image in a figure. Leave blank for no caption.',
    },
  ]

  const fields: FieldSpec[] = file
    ? [describe, ...extras]
    : [
        ...(listed.length > 0
          ? [
              {
                name: 'listed',
                label: 'Choose an image',
                options: [{ value: '', label: 'Type an address instead' }, ...listed.map((item) => ({ value: item.value, label: item.title }))],
                fills: 'src',
              },
            ]
          : []),
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
          value: existing?.src ?? '',
          required: !upload,
        },
        describe,
        ...extras,
      ]

  const finish = (
    src: string,
    alt: string,
    width: string | null,
    height: string | null,
    values: Record<string, string>,
  ): ImageResult => ({
    src,
    alt,
    title: values['title'] || null,
    width,
    height,
    className: values['className'] || null,
    align:
      values['align'] === 'left' || values['align'] === 'right' || values['align'] === 'center'
        ? values['align']
        : null,
    caption: values['caption'] ? values['caption'] : null,
  })

  return showForm<ImageResult>(
    doc,
    file ? 'Describe this image' : 'Insert image',
    fields,
    {
      locale,
      extraCheckbox: {
        name: 'decorative',
        label: 'This image is decorative and needs no description',
      },
      ...(file ? { note: inLocale('Ready to upload: {file}', { file: file.name }) } : {}),
      busyLabel: 'Uploading…',
      ...(picker && host
        ? {
            browse: {
              label: 'Browse files',
              fill: async () => {
                const picked = await picker({ kind: 'image', host })
                if (!picked) return null
                return { src: picked.url, alt: picked.alt ?? '', title: picked.title ?? '' }
              },
            },
          }
        : {}),
    },
    (values, files) => {
      const chosen = file ?? files['file']
      const src = values['src'] || ''

      if (!chosen && !src) {
        return {
          error: upload
            ? t('Choose a file or enter an image address.')
            : t('Enter an image address.'),
          field: upload && files['file'] !== undefined ? 'file' : 'src',
        }
      }
      if (!values['alt'] && values['decorative'] !== 'on') {
        return { error: t('Add alternative text, or tick the decorative box.'), field: 'alt' }
      }

      const alt = values['decorative'] === 'on' ? '' : (values['alt'] ?? '')

      if (!chosen || !upload) {
        return { value: finish(src, alt, null, null, values) }
      }

      return upload(chosen).then((result) => ({
        value: finish(result.src, alt, dimension(result.width), dimension(result.height), values),
      }))
    },
  )
}
