/**
 * How long a document change may sit unwritten before the textarea catches up.
 *
 * Nothing reads the textarea between edits -- `submit` and `formdata` both
 * force a write first, and so does teardown -- so this exists only for a host
 * that watches the textarea itself, with a MutationObserver or a polling
 * autosave. Writing on every keystroke instead cost a full re-serialization of
 * the document per character: 12 ms on a plain 100-page document, 74 ms with
 * tables, against a 16.7 ms frame.
 */
const SYNC_DELAY_MS = 300

/** Owns the custom element's textarea and form-submission contract. */
export class FormBridge {
  #textarea: HTMLTextAreaElement | null = null
  #form: HTMLFormElement | null = null
  #dirty = false
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly host: HTMLElement,
    private readonly readValue: () => string,
    private readonly writeValue: (html: string) => void,
  ) {}

  get textarea(): HTMLTextAreaElement | null {
    return this.#textarea
  }

  bind(): HTMLTextAreaElement | null {
    const id = this.host.getAttribute('for')
    if (id) {
      const root = this.host.getRootNode() as Document | ShadowRoot
      const element = root.getElementById?.(id)
      if (element instanceof HTMLTextAreaElement) this.#textarea = element
      else {
        this.#textarea = null
        console.error(
          `<openleaf-editor for="${id}">: no <textarea id="${id}"> found. ` +
            'Content will not be submitted with the form.',
        )
      }
      return this.#textarea
    }
    this.#textarea = this.host.querySelector('textarea')
    return this.#textarea
  }

  attach(): void {
    this.detach()
    this.#form = this.#textarea?.form ?? this.host.closest('form')
    this.#form?.addEventListener('submit', this.#onSubmit)
    this.#form?.addEventListener('formdata', this.#onFormData)
    this.#form?.addEventListener('reset', this.#onReset)
    this.sync()
  }

  detach(): void {
    // Flush first. A host that removes the editor and then reads the textarea
    // -- a framework unmounting a component, a wizard swapping a step -- must
    // not get the value as of the last debounce tick.
    this.flush()
    this.#form?.removeEventListener('submit', this.#onSubmit)
    this.#form?.removeEventListener('formdata', this.#onFormData)
    this.#form?.removeEventListener('reset', this.#onReset)
    this.#form = null
  }

  rebind(): void {
    this.detach()
    this.bind()
    this.attach()
  }

  /** Write the document to the textarea now, whether or not it has changed. */
  sync(): void {
    this.#cancel()
    this.#dirty = false
    if (this.#textarea) this.#textarea.value = this.readValue()
  }

  /**
   * Record that the document changed, without serializing it.
   *
   * The serialization is what costs -- a `DOMSerializer` pass over the whole
   * document and a ~0.33 MB string per keystroke on a 100-page document -- and
   * nothing reads the result until one of the flush points below. So the change
   * is only noted here, and the trailing timer exists for hosts that watch the
   * textarea rather than the element.
   */
  markDirty(): void {
    if (!this.#textarea) return
    this.#dirty = true
    if (this.#timer !== null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.flush()
    }, SYNC_DELAY_MS)
  }

  /** Write the document to the textarea if, and only if, it has changed. */
  flush(): void {
    if (this.#dirty) this.sync()
    else this.#cancel()
  }

  #cancel(): void {
    if (this.#timer === null) return
    clearTimeout(this.#timer)
    this.#timer = null
  }

  #onSubmit = (): void => this.flush()

  #onFormData = (event: FormDataEvent): void => {
    this.flush()
    if (this.#textarea?.name) event.formData.set(this.#textarea.name, this.#textarea.value)
  }

  #onReset = (): void => {
    // Reset fires before controls restore their defaults.
    queueMicrotask(() => {
      if (this.#textarea) this.writeValue(this.#textarea.value)
    })
  }
}
