/** Owns the custom element's textarea and form-submission contract. */
export class FormBridge {
  #textarea: HTMLTextAreaElement | null = null
  #form: HTMLFormElement | null = null

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

  sync(): void {
    if (this.#textarea) this.#textarea.value = this.readValue()
  }

  #onSubmit = (): void => this.sync()

  #onFormData = (event: FormDataEvent): void => {
    this.sync()
    if (this.#textarea?.name) event.formData.set(this.#textarea.name, this.#textarea.value)
  }

  #onReset = (): void => {
    // Reset fires before controls restore their defaults.
    queueMicrotask(() => {
      if (this.#textarea) this.writeValue(this.#textarea.value)
    })
  }
}
