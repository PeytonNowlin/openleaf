import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

/** A realistic Word clipboard payload: a bullet list with a nested level. */
const WORD_LIST =
  '<p class="MsoListParagraphCxSpFirst" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Symbol">·' +
  '<span style="font:7.0pt &quot;Times New Roman&quot;">&nbsp;&nbsp; </span></span>' +
  '<!--[endif]-->Revenue up 12%<o:p></o:p></p>' +
  '<p class="MsoListParagraphCxSpMiddle" style="text-indent:-.25in;mso-list:l0 level2 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Courier New">o' +
  '<span style="font:7.0pt">&nbsp;&nbsp; </span></span>' +
  '<!--[endif]-->North region<o:p></o:p></p>' +
  '<p class="MsoListParagraphCxSpLast" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Symbol">·' +
  '<span style="font:7.0pt">&nbsp;&nbsp; </span></span>' +
  '<!--[endif]-->Churn down to 3.1%<o:p></o:p></p>'

const GDOCS_BOLD =
  '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-abc">' +
  '<p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;white-space:pre-wrap">' +
  'Plain and </span><span style="font-weight:700;white-space:pre-wrap">bold</span></p></b>'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

/**
 * Paste HTML by dispatching a synthetic clipboard event.
 *
 * Real clipboard access is permission-gated and differs per browser; a
 * constructed `ClipboardEvent` carrying a `DataTransfer` is the portable way to
 * exercise the same code path ProseMirror uses for a genuine paste. If a
 * browser refuses to honour the constructed clipboardData, this returns false
 * and the test reports that honestly rather than passing vacuously.
 *
 * Known: Firefox returns a null `clipboardData` from the constructor, so these
 * tests SKIP there rather than pretending to pass. Chromium and WebKit both
 * honour it. The normalizers themselves are covered by 56 unit tests against a
 * DOM; what these browser tests add is proof that `transformPastedHTML` is
 * actually wired into the live view, and two of three engines confirm that.
 */
async function pasteHtml(page: Page, html: string): Promise<boolean> {
  return page.evaluate((payload) => {
    const region = document.querySelector<HTMLElement>('.ProseMirror')
    if (!region) return false
    region.focus()
    let data: DataTransfer
    try {
      data = new DataTransfer()
      data.setData('text/html', payload)
    } catch {
      return false
    }
    if (data.getData('text/html') !== payload) return false
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    })
    if (!event.clipboardData || event.clipboardData.getData('text/html') !== payload) return false
    region.dispatchEvent(event)
    return true
  }, html)
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
  // Start from an empty document so assertions are about the paste alone.
  await page.evaluate(() => {
    const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
    el.value = '<p></p>'
  })
})

test.describe('pasting from Microsoft Word', () => {
  test('reconstructs a nested list instead of a wall of paragraphs', async ({ page }) => {
    const ok = await pasteHtml(page, WORD_LIST)
    test.skip(!ok, 'this browser does not honour constructed clipboardData')

    const value = await page.locator('#body').inputValue()

    expect(value).toContain('<ul>')
    expect(value).toContain('Revenue up 12%')
    expect(value).toContain('North region')
    expect(value).toContain('Churn down to 3.1%')
    // The nested level must be inside the preceding item.
    expect(value).toMatch(/<li><p>Revenue up 12%<\/p><ul><li><p>North region<\/p><\/li><\/ul><\/li>/)
  })

  test('strips the bullet glyphs and the vendor styling', async ({ page }) => {
    const ok = await pasteHtml(page, WORD_LIST)
    test.skip(!ok, 'this browser does not honour constructed clipboardData')

    const value = await page.locator('#body').inputValue()
    expect(value).not.toContain('·')
    expect(value).not.toMatch(/mso-|Mso|Symbol|Courier|o:p/i)
    expect(value).not.toContain('style=')
  })

  test('creates no opaque preserved cards for the author to puzzle over', async ({ page }) => {
    const ok = await pasteHtml(page, WORD_LIST)
    test.skip(!ok, 'this browser does not honour constructed clipboardData')

    // A preserved atom is correct for a customer's stored document and wrong
    // for a paste: the author would see an inert card where their list should be.
    const cards = await page
      .locator('.ProseMirror [data-openleaf-unparsable]')
      .count()
    expect(cards).toBe(0)

    // Two lists, not one: the outer bullet list and the nested level inside it.
    await expect(editor(page).locator('ul')).toHaveCount(2)
    await expect(editor(page).locator('ul').first()).toBeVisible()
  })
})

test.describe('pasting from Google Docs', () => {
  test('does not bold the whole paste, but keeps the real bold run', async ({ page }) => {
    const ok = await pasteHtml(page, GDOCS_BOLD)
    test.skip(!ok, 'this browser does not honour constructed clipboardData')

    const value = await page.locator('#body').inputValue()
    expect(value).toContain('<strong>bold</strong>')
    expect(value).not.toContain('<strong>Plain and ')
    expect(value).not.toContain('docs-internal-guid')
    expect(value).not.toContain('line-height')
  })
})

/**
 * Pasting is how attacker-controlled markup reaches the editor: the author
 * copies from a page someone else wrote. Normalization removes the dangerous
 * parts, but that is only worth anything if it happens before the browser acts
 * on them, and the browser acts the moment a node acquires a document with a
 * browsing context.
 *
 * This has to run in a real browser. jsdom does not load images and does not
 * compile `on*` attributes into handlers, so a payload "not firing" there is
 * true of vulnerable code as well -- the jsdom suites in `packages/paste` and
 * `packages/sanitize` prove the boundary crossing instead, and this proves the
 * consequence. Against the code before this test existed, `PASTE_XSS` executed
 * in Chromium and a request went out for the image.
 *
 * Firefox and WebKit skip along with the rest of the file, since they do not
 * honour constructed clipboardData.
 */
test.describe('pasting attacker-controlled markup', () => {
  /**
   * Three payloads for three different ways out of the inert fragment.
   *
   * 1. a top-level image -- the fragment being appended to a live host
   * 2. an image under `font-weight:700` -- `wrapChildren` builds a `<strong>`
   *    and moves the image into it
   * 3. an image in a Word list paragraph -- list reconstruction builds
   *    `<ul>`/`<li>`/`<p>` and moves the paragraph's children into them
   *
   * Each records into `window.__pasteXss`, which survives the paste, so the
   * assertion catches a handler that ran even for a node discarded straight
   * afterwards.
   */
  const probe = (n: number) =>
    `<img src="/paste-xss-probe-${n}.png" ` +
    `onerror="(window.__pasteXss=window.__pasteXss||[]).push(${n})">`

  const PASTE_XSS: Array<[string, string]> = [
    ['a plain paste', `<p>Report</p>${probe(1)}`],
    [
      'a Google Docs paste',
      '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-abc">' +
        '<p dir="ltr" style="line-height:1.38">' +
        `<span style="font-weight:700">${probe(2)}</span></p></b>`,
    ],
    [
      'a Word paste',
      '<p class="MsoListParagraphCxSpFirst" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
        '<!--[if !supportLists]--><span style="font-family:Symbol">·</span><!--[endif]-->' +
        `Revenue up 12%${probe(3)}<o:p></o:p></p>`,
    ],
  ]

  for (const [name, payload] of PASTE_XSS) {
    test(`runs no handler from ${name}`, async ({ page }) => {
      const ok = await pasteHtml(page, payload)
      test.skip(!ok, 'this browser does not honour constructed clipboardData')

      // The image itself is legitimate content and the editor renders it, so
      // its request going out proves nothing either way. What must never happen
      // is the handler running, and it would have run by now: the vulnerable
      // path compiled it synchronously during normalization.
      await page.waitForTimeout(1000)
      const fired = await page.evaluate(
        () => (window as unknown as { __pasteXss?: number[] }).__pasteXss ?? [],
      )
      expect(fired).toEqual([])

      // And the attribute must not have survived into the stored value or the
      // editor's own DOM, where it would fire on every subsequent load.
      const value = await page.locator('#body').inputValue()
      expect(value).not.toContain('onerror')
      expect(await editor(page).locator('[onerror]').count()).toBe(0)
    })
  }
})
