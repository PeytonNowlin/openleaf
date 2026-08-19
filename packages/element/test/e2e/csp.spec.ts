import { expect, test, type Page } from '@playwright/test'

/**
 * Alignment and colour under a strict `style-src`.
 *
 * A claim about CSP that has never been run under CSP is not worth making, and
 * running these found a real one: alignment and colour degrade DIFFERENTLY here,
 * for a reason worth understanding.
 *
 * Alignment is read from the raw `style` attribute by the node's own `getAttrs`,
 * so the policy cannot hide it. Colour is matched by ProseMirror's style rules,
 * which go through the CSSOM -- and under this policy the browser leaves the
 * attribute in the DOM and refuses to parse it, so the CSSOM reports nothing.
 *
 *   Alignment  modelled as usual, and it renders: the schema notices its style
 *              attribute was not honoured and writes through the CSSOM instead,
 *              which CSP does not gate. The cost is that the stored spelling is
 *              then the CSSOM's rather than the author's.
 *
 *   Colour     engine-dependent, and both outcomes are fine. Chromium empties the
 *              CSSOM for a style attribute under this policy, so the colour cannot
 *              be read: the span falls to the preservation layer and comes back
 *              byte-identical and uneditable, which is exactly what happened before
 *              colour was modelled at all. Firefox and WebKit populate the CSSOM
 *              anyway, so there the colour becomes a mark and is rewritten in the
 *              CSSOM's spelling like alignment.
 *
 * What must hold in every engine is that the colour survives in some form. The
 * first version of this feature unwrapped that span instead and dropped it
 * entirely: degrading to preservation is acceptable, losing content is not, and
 * that is what this file is here to keep true.
 */

const HARNESS = '/packages/element/test/e2e/harness-csp.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test('the toolbar still styles itself', async ({ page }) => {
  // The existing claim, re-checked here because this is the only harness that
  // actually runs under the policy it is claimed for.
  const padding = await page
    .getByRole('toolbar', { name: 'Formatting' })
    .evaluate((el) => getComputedStyle(el).padding)
  expect(padding).not.toBe('0px')
})

test('aligned content still renders', async ({ page }) => {
  const align = await editor(page)
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign)
  expect(align).toBe('center')
})

test('existing colour survives, whichever route the engine takes', async ({ page }) => {
  // The case that dropped the colour outright in the first version of this
  // feature. Either spelling is acceptable -- verbatim where the span was
  // preserved, the CSSOM's where it became a mark -- and nothing is not.
  const style = await editor(page).locator('span').first().getAttribute('style')
  expect(style).toMatch(/#cc0000|rgb\(204, 0, 0\)/)
})

test('alignment applied from the toolbar renders', async ({ page }) => {
  await editor(page).locator('p').first().click()
  await page
    .getByRole('toolbar', { name: 'Formatting' })
    .getByRole('button', { name: 'Align right', exact: true })
    .click()

  const align = await editor(page)
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign)
  expect(align).toBe('right')
})

test('the stored HTML keeps the formatting, in the CSSOM spelling', async ({ page }) => {
  const html = await page.evaluate(() => {
    new FormData(document.querySelector('#post-form') as HTMLFormElement)
    return (document.querySelector('#body') as HTMLTextAreaElement).value
  })
  // Not `text-align:center`. The fallback wrote through the CSSOM, which
  // reserializes -- the documented cost of rendering at all under this policy.
  expect(html).toContain('style="text-align: center;"')
  // And the colour, in whichever of the two forms this engine produced.
  expect(html).toMatch(/<span style="color:\s*(#cc0000|rgb\(204, 0, 0\));?">Red\.<\/span>/)
})
