/**
 * Ambient types so this package typechecks without installing Angular in the
 * monorepo. Consumers resolve `@angular/core` from their own application.
 */
declare module '@angular/core' {
  export const CUSTOM_ELEMENTS_SCHEMA: unknown
  export function Component(config: Record<string, unknown>): ClassDecorator
  export function Input(): PropertyDecorator
  export function Output(): PropertyDecorator
  export class EventEmitter<T> {
    emit(_value: T): void
  }
  export interface AfterViewInit {
    ngAfterViewInit(): void
  }
  export interface OnDestroy {
    ngOnDestroy(): void
  }
  export class ElementRef<T> {
    nativeElement: T
  }
}
