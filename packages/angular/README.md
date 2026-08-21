# @openleaf-editor/angular — withdrawn

**This package is no longer published, and the versions already on npm
(`0.1.0-beta.1` and `0.1.0-beta.2`) never worked in a production Angular build.**
Use the custom element directly. It is a better integration than the wrapper
was, and the whole recipe is below.

## What was wrong

The package shipped a standalone `@Component` built with plain `tsc` rather than
`ng-packagr`/ngtsc. The emitted `dist/index.js` was legacy `__decorate` output
with **zero Ivy declarations** — no `ɵɵngDeclareComponent`, no AOT `ɵcmp` —
so Angular's linker had nothing to consume and the component could only be
compiled by the JIT compiler. `@angular/compiler` is excluded from production
builds by default, and it was not a declared peer dependency, so every
production build failed with:

```
Error: The component 'OpenLeafComponent' needs to be compiled using the JIT
compiler, but '@angular/compiler' is not available.
```

That is not a bug with a small fix. It means the package had no working users,
which is also why withdrawing it breaks nobody.

Underneath the build problem the wrapper was thin in ways that mattered. It
hard-coded six `@Input`s and offered no passthrough, so eleven of the element's
seventeen attributes — `skin`, `theme`, `contextmenu`, `selection-toolbar`,
`insert-toolbar`, `content-css`, `inline`, `autoresize`, `toolbar-overflow`,
`readonly` and `aria-label` — could not be reached at all. `aria-label` was the
sharp edge: written on the `<openleaf>` host, it never reached the editable
region, so every Angular integrator shipped an unlabelled editor to screen
reader users.

## Why it was withdrawn rather than rebuilt

Building with `ng-packagr` works — it was tried, and it compiles in partial-Ivy
mode. It was not adopted because of what it costs a project this size:

- **+120 packages**, a 69% increase on a dependency tree of 174, for one 91-line
  wrapper. The lockfile grew by 1,336 lines, and the tree pulls in
  `@parcel/watcher`, a native binary needing an explicit build-script decision.
- **TypeScript becomes Angular's to choose.** `ng-packagr` peer-depends on a
  0.1-wide TypeScript window — `>=5.8 <5.9` for v20, `>=5.9 <6.0` for v21,
  `>=6.0 <6.1` for v22. Every TypeScript upgrade in this monorepo would wait on
  Angular's release train.
- **The publish shape changes for one package.** Angular Package Format requires
  publishing `ng-packagr`'s generated `dist/package.json` as the package root,
  which the repository's single `pnpm -r ... publish` release step cannot do.
- **The `>=17` peer range stops being honest.** A library built by v21's
  compiler is tested against v21.

Set against a wrapper whose only genuine value-add is `[(value)]` sugar, and
which Angular does not need in the first place. Angular consumes custom elements
natively.

## The supported Angular integration

Add `CUSTOM_ELEMENTS_SCHEMA` and use the element. Every attribute works, because
they land on the element itself rather than on a wrapper host:

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
import '@openleaf-editor/element'

@Component({
  selector: 'app-post-editor',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <openleaf-editor
      toolbar="bold italic | link"
      skin="midnight"
      aria-label="Post body"
      autoresize
    ></openleaf-editor>
  `,
})
export class PostEditorComponent {}
```

### Two-way binding

Angular's template parser reads the colon in `openleaf:change` as a namespace
separator, so the event cannot be bound declaratively. A directive in **your**
app — compiled by your own ngtsc, so none of the problems above apply — covers
it in thirty lines:

```ts
import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  type OnChanges,
  type OnDestroy,
  type OnInit,
} from '@angular/core'
import '@openleaf-editor/element'
import type { OpenLeafEditor } from '@openleaf-editor/element'

@Directive({ selector: 'openleaf-editor', standalone: true })
export class OpenLeafValueDirective implements OnInit, OnChanges, OnDestroy {
  @Input() value?: string
  @Output() readonly valueChange = new EventEmitter<string>()

  constructor(private readonly host: ElementRef<OpenLeafEditor>) {}

  private readonly onChange = (event: HTMLElementEventMap['openleaf:change']): void => {
    this.valueChange.emit(event.detail.value)
  }

  ngOnInit(): void {
    this.push()
    this.host.nativeElement.addEventListener('openleaf:change', this.onChange)
  }

  ngOnChanges(): void {
    this.push()
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('openleaf:change', this.onChange)
  }

  /** The element compares before replacing, so this cannot cost an undo step. */
  private push(): void {
    if (this.value !== undefined) this.host.nativeElement.value = this.value
  }
}
```

Then `[(value)]` works, and so does everything else:

```html
<openleaf-editor [(value)]="html" toolbar="bold italic | link" aria-label="Post body">
</openleaf-editor>
```

`@openleaf-editor/element` augments `HTMLElementTagNameMap` and
`HTMLElementEventMap`, so `ElementRef<OpenLeafEditor>` and `event.detail.value`
are both fully typed with no casts.

### Reactive forms

Wrap the same directive in a `ControlValueAccessor` if you want
`formControlName`. The wrapper never had one, so nothing is lost here either.

## License

Apache-2.0.
