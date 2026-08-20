/**
 * How much a single import gesture is allowed to be.
 *
 * Import is the one place in this editor where a file the author did not write
 * -- and may not have looked at -- is read into memory and converted. Everything
 * downstream of that is careful about *content*: the paste normalizer, the
 * sanitizer, the schema. Nothing was careful about *size*, and a converter is
 * exactly where size bites, because a compressed format expands.
 *
 * These are deliberately generous. The point is not to police what an author may
 * import; it is that "the tab died" is a worse answer than "that file is too
 * big", and that a folder dropped by accident should not become a thousand
 * conversions with no way to stop them.
 *
 * ```js
 * import { setImportLimits } from '@openleaf-editor/plugins-import'
 * setImportLimits({ maxFileBytes: 100 * 1024 * 1024 })
 * ```
 */

export interface ImportLimits {
  /** Largest single file `convertFile` will read. */
  maxFileBytes: number
  /** Most files one drop or one picker selection may carry. */
  maxFiles: number
}

/**
 * 32 MB and 20 files.
 *
 * 32 MB is well past any hand-written document -- a 300-page Word file with
 * photographs is a few megabytes -- while still being a size a browser tab can
 * hold without trouble. 20 files is more than anyone drops on purpose and far
 * fewer than a mis-dropped folder.
 */
export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = {
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 20,
}

let limits: ImportLimits = { ...DEFAULT_IMPORT_LIMITS }

/** Raise or lower the limits for this page. Unspecified fields keep their value. */
export function setImportLimits(next: Partial<ImportLimits>): void {
  limits = { ...limits, ...next }
}

/** The limits in force. Also the testing seam. */
export function importLimits(): Readonly<ImportLimits> {
  return limits
}

/** Restore the defaults. Testing seam; not public API. */
export function resetImportLimits(): void {
  limits = { ...DEFAULT_IMPORT_LIMITS }
}

/** Sizes in a unit an author reads, not a number of bytes. */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
