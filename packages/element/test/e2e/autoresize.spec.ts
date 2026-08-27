/**
 * Autoresize in a real engine (#180).
 *
 * The logic bug is leaving `.ProseMirror` at `height: auto` after an
 * unchanged observer pass. jsdom cannot see a reflow; a pixel height that
 * is never written is the CSS-only fix, and this file is the proof the
 * canvas no longer collapses under the caret.
 */

import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

test.describe('autoresize', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('does not leave the canvas at height: auto after it settles', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.setAttribute('autoresize', '')
      el.value = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i}.</p>`).join('')
    })
    // Two frames: the old apply() wrote pixels on the first and left `auto`
    // on the second, unchanged, pass.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const height = await editor(page).evaluate((el) => (el as HTMLElement).style.height)
    expect(height).not.toBe('auto')
  })

  test('keeps the caret in the viewport after typing at the end of a long document', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.setAttribute('autoresize', '')
      el.value = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i}.</p>`).join('')
    })
    await editor(page).locator('p').last().click()
    await page.keyboard.press('End')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.keyboard.press('Enter')
    await page.keyboard.type('tail')

    const box = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, vh: window.innerHeight }
    })
    expect(box).not.toBeNull()
    expect(box!.top).toBeGreaterThanOrEqual(0)
    expect(box!.bottom).toBeLessThanOrEqual(box!.vh)
  })
})
