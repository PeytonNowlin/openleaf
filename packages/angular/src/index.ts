/**
 * Angular binding for `<openleaf-editor>`.
 *
 * Standalone component. Import `@openleaf-editor/element` once in the app
 * (this module does that) and use `<openleaf>` in templates. The custom
 * element remains the editor; this class forwards inputs and `valueChange`.
 *
 * `value` and `valueChange` are the pair Angular's two-way syntax expects, so
 * `[(value)]="html"` works, and match what the React and Vue wrappers do.
 */

import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  type AfterViewInit,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core'
import '@openleaf-editor/element'

type Host = HTMLElement & { value: string }

@Component({
  selector: 'openleaf',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<openleaf-editor
    #editor
    [attr.for]="for"
    [attr.toolbar]="toolbar"
    [attr.toolbar2]="toolbar2"
    [attr.menubar]="menubar"
    [attr.formats]="formats"
    [attr.lang]="lang"
  ></openleaf-editor>`,
})
export class OpenLeafComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('editor', { static: true }) editor: ElementRef<Host> | undefined

  @Input() for: string | undefined
  @Input() toolbar: string | undefined
  @Input() toolbar2: string | undefined
  @Input() menubar: string | undefined
  @Input() formats: string | undefined
  @Input() lang: string | undefined
  @Input() value: string | undefined
  @Output() readonly valueChange = new EventEmitter<string>()

  private readonly onEditorChange = (): void => {
    const host = this.editor?.nativeElement
    if (host) this.valueChange.emit(host.value)
  }

  ngAfterViewInit(): void {
    const host = this.editor?.nativeElement
    if (!host) return
    this.push(host)
    // Attached here rather than in the template: Angular's parser reads the
    // colon in `openleaf:change` as a namespace separator, so the event cannot
    // be bound declaratively. React and Vue attach it imperatively too.
    host.addEventListener('openleaf:change', this.onEditorChange)
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!('value' in changes)) return
    const host = this.editor?.nativeElement
    if (host) this.push(host)
  }

  ngOnDestroy(): void {
    this.editor?.nativeElement.removeEventListener('openleaf:change', this.onEditorChange)
  }

  /**
   * Write an incoming `value` onto the element, but only when it differs.
   *
   * Assigning unconditionally would replace the document on every change
   * detection pass, which costs the author their selection and their undo
   * history for no change at all.
   */
  private push(host: Host): void {
    if (this.value === undefined) return
    if (host.value !== this.value) host.value = this.value
  }
}
