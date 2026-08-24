/**
 * Autolink after IME composition.
 *
 * Space and Enter are the usual commit keys, but an IME accept is neither.
 * These tests synthesise `compositionstart` / `compositionend` rather than
 * driving a real IME, because Playwright has no portable IME API. If the
 * events do not flush the document the way a keyboard would, the assertions
 * fail instead of passing vacuously.
 *
 * One trap, and the reason the two tests insert text differently.
 * `keyboard.insertText` is not engine-neutral: Firefox's implementation is a
 * real IME commit, so it fires its own `compositionstart`,
 * `compositionupdate` AND `compositionend` around the text. That is fine for a
 * test that wants a composition to end, and fatal for one that needs a
 * composition to stay open -- the insertion closes it, autolink correctly
 * fires, and the test fails on Firefox alone. Chromium and WebKit fire only
 * `beforeinput`/`input`, which is why this went unseen until a run that
 * included Firefox. Anything that must happen *inside* an open composition
 * therefore uses `keyboard.type`, which is composition-free on all three.
 */

import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test('autolinks a URL when composition ends without Space or Enter', async ({ page }) => {
  await editor(page).click()
  await page.keyboard.press('End')

  await editor(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  })
  await page.keyboard.insertText('https://example.org')
  await editor(page).evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'https://example.org' }),
    )
  })

  await expect.poll(() => stored(page)).toContain('href="https://example.org"')
})

test('does not autolink while composition is still open, even past a commit key', async ({
  page,
}) => {
  await editor(page).click()
  await page.keyboard.press('End')

  await editor(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  })

  // A space is a commit key, so this types straight through the point that
  // autolinks in normal editing. Without the trailing space the assertion
  // would hold whether or not the composing guard exists -- a partial URL with
  // no commit key never autolinks -- and the test would prove nothing.
  await page.keyboard.type('https://example.co ')

  // The composition is still open, so the text is in the document and the mark
  // is not.
  const html = await stored(page)
  expect(html).toContain('https://example.co')
  expect(html).not.toContain('href="https://example.co"')
})

test('autolinks the composed URL once that composition ends', async ({ page }) => {
  await editor(page).click()
  await page.keyboard.press('End')

  await editor(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  })
  await page.keyboard.type('https://example.co ')
  await editor(page).evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'https://example.co ' }),
    )
  })

  // The guard defers the mark, it does not drop it: the commit point the open
  // composition suppressed is honoured as soon as the IME lets go.
  await expect.poll(() => stored(page)).toContain('href="https://example.co"')
})
