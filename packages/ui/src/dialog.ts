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

import { embedSrcFor, isSafeUrl } from '@openleaf-editor/core'
import { t, withLocale } from './i18n.js'
import { ensureStyles, registerStyles } from './styles.js'
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

/**
 * Shown when an address fails `isSafeUrl` -- `javascript:`, `data:`, `vbscript:`
 * and anything else outside the scheme allowlist.
 *
 * It names the editor's own limit rather than accusing the author, because the
 * common case is a pasted tracking link or an intranet scheme, not an attack.
 */
const UNSTORABLE_ADDRESS = 'That address is not one the editor can store.'

/*
 * Every colour reads the internal `--ol-*` token first and the public
 * `--openleaf-*` name only as a fallback.
 *
 * That order matters because of where the dialog now lives. It used to be
 * appended to `document.body`, outside `.ol-editor`, where none of the editor's
 * tokens are in scope -- so `var(--openleaf-color-surface, #fff)` always took
 * the hardcoded light fallback and `<openleaf-editor skin="midnight">` plus the
 * Link button produced a white dialog with #1f2328 text sitting on a #0d1117
 * editor. Mounted inside the host (see `showForm`), the skin's public tokens
 * reach it directly.
 *
 * The public names alone would still not be enough, because the dark palette
 * that `theme="dark"` installs is written in the *internal* names -- it is a set
 * of `--ol-*` declarations whose values are `var(--openleaf-*, <dark>)`. Reading
 * `--ol-surface` therefore resolves all four cases (light default, system dark,
 * `theme="dark"`, and any skin) through one variable, and the `--openleaf-*`
 * fallback still covers a dialog rendered outside a host.
 *
 * `.ol-error` was the one colour here that was not a token, and the one colour
 * that has to be read: #cf222e is 5.36:1 on white but 3.53:1 on the dark
 * surface. It is `--ol-danger` now, which resolves to #ff8182 (7.85:1) there.
 */
const DIALOG_CSS = `
.ol-dialog {
  box-sizing: border-box;
  max-width: min(28rem, calc(100vw - 2rem));
  padding: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 6px));
  background: var(--ol-surface, var(--openleaf-color-surface, #fff));
  color: var(--ol-text, var(--openleaf-color-text, #1f2328));
  font-family: var(--ol-font, var(--openleaf-font, system-ui, -apple-system, sans-serif));
  font-size: var(--ol-font-size, var(--openleaf-font-size, 14px));
}
.ol-dialog::backdrop { background: rgb(0 0 0 / 40%); }
.ol-dialog form { display: grid; gap: 12px; padding: 16px; margin: 0; }
.ol-dialog h2 { margin: 0; font-size: 1.1em; }
/* The field, not the label, is the grid: the hint sits between the two as the
   control's DESCRIPTION rather than folding into its accessible name. */
.ol-dialog .ol-field { display: grid; gap: 4px; }
.ol-dialog label { font-weight: 500; }
.ol-dialog .ol-hint { font-weight: 400; font-size: .9em; opacity: .8; }
.ol-dialog input[type="text"], .ol-dialog input[type="url"], .ol-dialog input[type="file"],
.ol-dialog input[type="color"], .ol-dialog input[type="number"], .ol-dialog select {
  box-sizing: border-box; width: 100%; padding: 6px 8px;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: var(--ol-surface, var(--openleaf-color-surface, #fff));
  color: inherit; font: inherit;
}
.ol-dialog input[type="color"] { height: 2.25rem; padding: 2px; }
.ol-dialog .ol-check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.ol-dialog .ol-check input { margin: 0; }
.ol-dialog .ol-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ol-dialog button {
  box-sizing: border-box; padding: 6px 12px; margin: 0;
  border: 1px solid var(--ol-border-strong, var(--openleaf-color-border-strong, #6e7781));
  border-radius: var(--ol-radius, var(--openleaf-radius, 4px));
  background: transparent; color: inherit; font: inherit; cursor: pointer;
  appearance: none; -webkit-appearance: none;
}
.ol-dialog button[value="ok"] {
  border-color: var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  background: var(--ol-accent, var(--openleaf-color-accent, #0550ae));
  color: var(--ol-surface, var(--openleaf-color-surface, #fff));
}
.ol-dialog button:focus-visible {
  outline: var(--ol-focus-width, 2px) solid var(--ol-focus, var(--openleaf-color-focus, #0969da));
  outline-offset: 1px;
}
.ol-dialog button[aria-disabled="true"] { opacity: .55; cursor: default; }
.ol-dialog .ol-error { color: var(--ol-danger, #cf222e); font-size: .9em; min-height: 1.2em; }
.ol-dialog .ol-progress { font-size: .9em; opacity: .8; min-height: 1.2em; }
`

/**
 * Install the dialog sheet.
 *
 * Delegates to `registerStyles` rather than repeating the constructable-sheet
 * dance, which also removes this file's `<style>`-element fallback. That
 * fallback contradicted the invariant argued at the top of `styles.ts`: a
 * `<style>` element is blocked by exactly the `style-src 'self'` policies that
 * would need it, and it fails silently. `registerStyles` warns instead, once,
 * naming the stylesheet to link.
 *
 * It also deduplicates per *document* by the CSS text, where the flag this used
 * to keep was module-global -- so a second document (an iframe, a print view)
 * previously got the dialog markup with none of its styles.
 */
export function ensureDialogStyles(doc: Document): void {
  ensureStyles(doc)
  registerStyles(DIALOG_CSS, doc)
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
    /** The editor to mount inside. See `dialogParent`. */
    host?: HTMLElement
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
    host?: HTMLElement
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
      void options.browse
        ?.fill()
        .then((filled) => {
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
        // A picker is integrator code, so it can reject -- and it does when it
        // hands back an address the editor will not store. Without this the
        // failure was an unhandled rejection and the author saw nothing happen.
        .catch((thrown: unknown) => {
          error.textContent = messageFrom(thrown)
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
  dialogParent(doc, options.host).appendChild(dialog)

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
      // And stop it propagating, which `preventDefault` alone does not. Mounted
      // inside the editor the dialog is usually inside the page's own <form>,
      // and `submit` bubbles: without this, saving a link would reach the host
      // page's submit listeners. In this repo that is the session plugin's,
      // which treats a submit as "the document has been saved" and deletes the
      // autosave draft -- from a dialog that saved nothing to the server.
      event.stopPropagation()
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

/**
 * Where a modal should be mounted.
 *
 * Inside the editor host, so the skin's tokens reach it -- `showModal()` puts
 * the element in the top layer regardless of where it sits in the tree, so
 * nesting costs nothing in stacking or clipping and buys the whole palette.
 * `document.body` remains the fallback for a caller with no host (the unit
 * tests, and any integrator calling `promptFields` directly).
 *
 * The host is verified to be in the same document, because a dialog appended
 * across documents would be adopted out of the one whose stylesheet was just
 * installed.
 */
function dialogParent(doc: Document, host?: HTMLElement): HTMLElement {
  return host && host.ownerDocument === doc ? host : doc.body
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
  /**
   * The editor the dialog belongs to. Pass it: the dialog is mounted inside
   * this element so the skin's tokens reach it, and without it the dialog is
   * painted in the default light palette whatever the editor looks like.
   */
  host?: HTMLElement
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
      ...(host ? { host } : {}),
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
                if (!isSafeUrl(picked.url)) {
                  throw new Error('The file picker returned an address the editor will not store.')
                }
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
      // `setLink` declines this too, but a command that declines closes the
      // dialog and does nothing visible. Reporting here keeps the dialog open
      // with the address still in the field, so the author can see and fix it.
      if (!isSafeUrl(href)) return { error: t(UNSTORABLE_ADDRESS), field: 'href' }
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
      ...(host ? { host } : {}),
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
                if (!isSafeUrl(picked.url)) {
                  throw new Error('The image picker returned an address the editor will not store.')
                }
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
      // Only a typed or picked address needs checking here; a file goes through
      // `runUploader`, which already refuses what the editor will not store.
      if (src !== '' && !isSafeUrl(src)) return { error: UNSTORABLE_ADDRESS }
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

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

/** One alternative address the author gave the player. */
export interface MediaSourceResult {
  src: string
  type: string | null
}

export interface MediaResult {
  /** Empty when the player carries all its addresses in `sources`. */
  src: string
  title: string | null
  poster: string | null
  width: string | null
  height: string | null
  sources: MediaSourceResult[]
}

export interface MediaPromptOptions {
  host?: HTMLElement
  /** Prefilled state, when editing a player already in the document. */
  existing?: {
    /**
     * What the selected node is. An `<iframe>` accepts only the addresses the
     * embed allowlist permits, and the form has to say so itself: the update
     * command declines anything else, and by then this dialog has closed, so a
     * rejected address looked like a save that did nothing.
     */
    kind?: 'video' | 'audio' | 'iframe'
    src?: string | null
    title?: string | null
    poster?: string | null
    width?: string | null
    height?: string | null
    sources?: readonly MediaSourceResult[]
  }
}

/** How many empty `<source>` rows the dialog offers for adding new encodings. */
const SPARE_SOURCE_ROWS = 2

/**
 * The insert-media dialog.
 *
 * Two spare alternative-source rows, because that is the shape the format is
 * actually used in: a `<video>` with a `.webm` and an `.mp4` covers every
 * current browser, and offering a single alternative makes the common case the
 * one the author has to work around. Not a growable list with add and remove
 * controls, which would owe keyboard semantics and a reordering story.
 *
 * But the rows are spare capacity *on top of* what the player already has, never
 * a cap on it. A fixed two rows silently deleted the third and later encodings
 * of any player that had them, on a save the author made to change the title --
 * because what this form returns is what replaces the stored sources. Every
 * existing source gets a row, so the form cannot lose one it was never shown.
 *
 * The type hints are separate fields rather than guessed from the extension. A
 * guess is wrong for exactly the addresses that need it -- a signed URL, or a
 * stream with no extension at all -- and being wrong here means the browser
 * downloads a format it cannot play before finding out.
 */
export async function promptForMedia(
  doc: Document,
  options: MediaPromptOptions = {},
): Promise<MediaResult | null> {
  const { host, existing } = options
  const locale = host?.getAttribute('lang') ?? null
  const existingSources = existing?.sources ?? []
  const editing = existing !== undefined

  const fields: FieldSpec[] = [
    {
      name: 'src',
      label: 'Address',
      type: 'text',
      value: existing?.src ?? '',
      hint: 'The video or audio file to play. Leave blank if you only give alternatives below.',
    },
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      value: existing?.title ?? '',
      hint: 'Shown as a tooltip. Optional.',
    },
    {
      name: 'poster',
      label: 'Poster image',
      type: 'text',
      value: existing?.poster ?? '',
      hint: 'Shown before the video plays. Ignored for audio.',
    },
    {
      name: 'width',
      label: 'Width',
      type: 'text',
      value: existing?.width ?? '',
      hint: 'Pixels, or a percentage. Leave blank to use the file’s own size.',
    },
    {
      name: 'height',
      label: 'Height',
      type: 'text',
      value: existing?.height ?? '',
    },
  ]

  const sourceRows = existingSources.length + SPARE_SOURCE_ROWS
  for (let index = 0; index < sourceRows; index += 1) {
    const source = existingSources[index]
    fields.push(
      {
        name: `alt${index}`,
        label: index === 0 ? 'Alternative address' : `Alternative address ${index + 1}`,
        type: 'text',
        value: source?.src ?? '',
        ...(index === 0
          ? { hint: 'Another encoding of the same media, for browsers that cannot play the first.' }
          : {}),
      },
      {
        name: `altType${index}`,
        label: index === 0 ? 'Alternative type' : `Alternative type ${index + 1}`,
        type: 'text',
        value: source?.type ?? '',
        ...(index === 0 ? { hint: 'For example video/webm. Optional, but saves a wasted download.' } : {}),
      },
    )
  }

  return showForm<MediaResult>(
    doc,
    editing ? 'Edit media' : 'Insert media',
    fields,
    {
      locale,
      ...(host ? { host } : {}),
    },
    (values) => {
      const src = (values['src'] ?? '').trim()
      const sources: MediaSourceResult[] = []
      for (let index = 0; index < sourceRows; index += 1) {
        const address = (values[`alt${index}`] ?? '').trim()
        if (address === '') continue
        if (!isSafeUrl(address)) {
          return { error: t(UNSTORABLE_ADDRESS), field: `alt${index}` }
        }
        const type = (values[`altType${index}`] ?? '').trim()
        sources.push({ src: address, type: type === '' ? null : type })
      }

      // One or the other, which is the schema's own rule: a player with neither
      // an address nor a source has nothing to play, and core declines it. Said
      // here so the author reads it in the dialog instead of watching the
      // insertion silently do nothing.
      if (src === '' && sources.length === 0) {
        return { error: t('Enter an address, or at least one alternative.'), field: 'src' }
      }
      if (src !== '' && !isSafeUrl(src)) return { error: t(UNSTORABLE_ADDRESS), field: 'src' }

      // An embed is held to the allowlist here rather than after the dialog has
      // gone. `embedSrcFor` accepts a watch page and converts it, so this
      // rejects only what genuinely cannot be embedded.
      if (existing?.kind === 'iframe' && embedSrcFor(src) === null) {
        return {
          error: t('That is not an address this editor can embed.'),
          field: 'src',
        }
      }

      const poster = (values['poster'] ?? '').trim()
      if (poster !== '' && !isSafeUrl(poster)) {
        return { error: t(UNSTORABLE_ADDRESS), field: 'poster' }
      }

      return {
        value: {
          src,
          title: values['title'] ? values['title'] : null,
          poster: poster === '' ? null : poster,
          width: values['width'] ? values['width'] : null,
          height: values['height'] ? values['height'] : null,
          sources,
        },
      }
    },
  )
}
