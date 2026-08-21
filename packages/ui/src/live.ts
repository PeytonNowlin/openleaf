/**
 * The one live region an editor speaks through.
 *
 * Every announcement in the editor -- a formatting toggle, an import warning, a
 * colour applied, a find result -- has to land in a node that is IN the document
 * before the text changes. A region built and left detached is not a quiet
 * region; it is a silent one, and nothing about the markup says so.
 *
 * That is exactly how the toolbar failed: each `Toolbar` built its own region and
 * relied on the host to mount one of them, so a secondary or floating bar spoke
 * into a detached `<div>` -- and `toolbar="none" toolbar2="bold italic"` mounted
 * no region at all, leaving Ctrl+B completely silent.
 *
 * So the region belongs to the HOST, not to any one control. One per editor:
 * two polite regions on one host race each other, and a screen reader reads
 * whichever it noticed, in whichever order.
 */

/** Marks the host's own region, so a second call finds it rather than adding one. */
const REGION_CLASS = 'ol-live-region'

/**
 * Pending announcements, keyed by host.
 *
 * Per host rather than per caller: two controls announcing in the same tick are
 * two utterances a screen reader will queue and read one after the other, over
 * the top of the author's typing. The last one is the one that matters.
 */
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** The host's live region, created and mounted on first use. */
export function liveRegion(host: HTMLElement): HTMLDivElement {
  const existing = host.querySelector<HTMLDivElement>(`:scope > .${REGION_CLASS}`)
  if (existing) return existing

  const el = host.ownerDocument.createElement('div')
  // `ol-live` is the visually-hidden rule; the second class is the marker.
  el.className = `ol-live ${REGION_CLASS}`
  // Polite and atomic: an assertive region would interrupt the author mid-word,
  // and a non-atomic one can read partial updates.
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  host.appendChild(el)
  return el
}

/**
 * Say something to a screen reader.
 *
 * Cleared and then set on a timer, for two reasons that both matter: replacing a
 * region's text with the identical string is not a change and is not announced,
 * and the delay coalesces a held shortcut into one utterance instead of thirty.
 */
export function announce(host: HTMLElement, message: string): void {
  const el = liveRegion(host)
  el.textContent = ''
  const pending = timers.get(host)
  if (pending !== undefined) clearTimeout(pending)
  timers.set(
    host,
    setTimeout(() => {
      timers.delete(host)
      el.textContent = message
    }, 60),
  )
}

/**
 * Remove a host's live region and cancel anything queued for it.
 *
 * The region is the host's, not any one toolbar's -- several bars share it --
 * so no `Toolbar.destroy()` may take it away while another bar is still using
 * it. It goes when the editor itself goes, and it has to go then: the element
 * reads its own `innerHTML` back as document content when it rebuilds, so a
 * region left behind becomes the author's document and is posted to the server.
 *
 * The pending timer is cleared as well. It holds a reference to the detached
 * node and would write into it after teardown -- harmless, but it is a timer
 * outliving the thing it was announcing for.
 */
export function disposeLiveRegion(host: HTMLElement): void {
  const pending = timers.get(host)
  if (pending !== undefined) {
    clearTimeout(pending)
    timers.delete(host)
  }
  host.querySelector(`:scope > .${REGION_CLASS}`)?.remove()
}
