import type { Page } from '@playwright/test'

/**
 * The value the server would actually receive for a bound textarea.
 *
 * The element no longer writes the textarea on every keystroke -- that was a
 * full re-serialization of the document per character, 12 ms on a plain
 * 100-page document and 74 ms with tables, read by nothing until the form was
 * posted. It marks the document dirty instead and writes at the points that
 * matter: `submit`, `formdata`, teardown, and a short trailing timer for hosts
 * that watch the textarea themselves.
 *
 * So a test that types and then reads `textarea.value` is racing the timer.
 * Rather than sleeping for it -- which is slow and still a race -- this asks
 * the question the assertions actually mean: what would a POST carry? Building
 * a `FormData` from the form fires the `formdata` event, which is exactly the
 * hook the editor uses to write the textarea before a submission. No timing
 * assumption, and it exercises the real flush path rather than working around
 * it.
 */
export function stored(page: Page, id = 'body'): Promise<string> {
  return page.evaluate((textareaId: string) => {
    const area = document.getElementById(textareaId)
    if (!(area instanceof HTMLTextAreaElement)) return ''
    if (area.form) {
      // Fires `formdata` on the form, which the editor listens for.
      new FormData(area.form)
      return area.value
    }
    // No form to post to, so there is no flush to trigger -- the demo page
    // binds several editors to bare textareas. The element's own `value` is
    // the same string the textarea is going to receive, taken from the same
    // document, so it answers "what would be stored" without waiting on the
    // trailing timer.
    const editor = document.querySelector(`openleaf-editor[for="${textareaId}"]`)
    const live = (editor as (HTMLElement & { value?: string }) | null)?.value
    return typeof live === 'string' ? live : area.value
  }, id)
}
