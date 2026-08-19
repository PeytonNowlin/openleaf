/**
 * Angular binding for `<openleaf-editor>`.
 *
 * Standalone component. Import `@openleaf-editor/element` once in the app
 * (this module does that) and use `<openleaf>` in templates. The custom
 * element remains the editor; this class forwards inputs and `valueChange`.
 */

import { Component, EventEmitter, Input, Output, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
import '@openleaf-editor/element'

@Component({
  selector: 'openleaf',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<openleaf-editor
    [attr.for]="for"
    [attr.toolbar]="toolbar"
    [attr.toolbar2]="toolbar2"
    [attr.menubar]="menubar"
    [attr.formats]="formats"
    [attr.lang]="lang"
  ></openleaf-editor>`,
})
export class OpenLeafComponent {
  @Input() for: string | undefined
  @Input() toolbar: string | undefined
  @Input() toolbar2: string | undefined
  @Input() menubar: string | undefined
  @Input() formats: string | undefined
  @Input() lang: string | undefined
  @Output() readonly valueChange = new EventEmitter<string>()
}
