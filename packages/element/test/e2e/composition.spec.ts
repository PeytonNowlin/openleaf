/**
 * Autolink after IME composition.
 *
 * Space and Enter are the usual commit keys, but an IME accept is neither.
 * These tests synthesise `compositionstart` / `compositionend` rather than
 * driving a real IME, because Playwright has no portable IME API. If the
 * events do not flush the document the way a keyboard would, the assertions
 * fail instead of passing vacuously.
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

test('does not autolink a partial URL while composition is still open', async ({ page }) => {
  await editor(page).click()
  await page.keyboard.press('End')

  await editor(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  })
  await page.keyboard.insertText('https://example.co')

  expect(await stored(page)).not.toContain('href="https://example.co"')
})
