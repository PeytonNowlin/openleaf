/**
 * Telling the author what happened.
 *
 * An import that quietly drops images is the same failure as an editor that
 * quietly drops markup -- the author finds out weeks later, with the original
 * long closed. So conversion warnings are shown, not logged.
 *
 * A polite live region rather than an alert: the insertion already happened and
 * the author should not have to dismiss anything to carry on typing.
 */

const REGION_CLASS = 'ol-import-status'

function region(host: HTMLElement): HTMLElement {
  const existing = host.querySelector<HTMLElement>(`.${REGION_CLASS}`)
  if (existing) return existing

  const el = host.ownerDocument.createElement('div')
  el.className = `${REGION_CLASS} ol-live`
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  host.appendChild(el)
  return el
}

export function announce(host: HTMLElement, message: string): void {
  const el = region(host)
  el.textContent = ''
  // Cleared first so an identical message is announced again rather than
  // being treated as unchanged.
  setTimeout(() => {
    el.textContent = message
  }, 50)
}

export function describeOutcome(
  fileCount: number,
  warnings: readonly string[],
  error: string | undefined,
): string {
  if (error) return error
  const imported = fileCount === 1 ? 'File imported.' : `${fileCount} files imported.`
  if (warnings.length === 0) return imported
  return `${imported} ${warnings.length} thing${warnings.length === 1 ? '' : 's'} did not come across: ${warnings.join('; ')}`
}
