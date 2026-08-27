/**
 * Placeholder prompt in a real engine (#175).
 *
 * The class and `data-placeholder` are asserted in jsdom. Whether the
 * `::before` actually paints is a stylesheet question, and the prompt is
 * delivered through `registerStyles` / adoptedStyleSheets.
 */

import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

test.describe('placeholder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('is visible on an empty document and gone after one character', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.setAttribute('placeholder', 'Write the article…')
      el.value = '<p></p>'
    })

    await expect.poll(() =>
      editor(page).evaluate((el) => getComputedStyle(el, '::before').content),
    ).toContain('Write the article')

    const valueWhileEmpty = await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      return el.value
    })
    expect(valueWhileEmpty).toBe('<p></p>')
    expect(valueWhileEmpty).not.toContain('Write the article')

    await editor(page).click()
    await page.keyboard.type('H')

    await expect.poll(() =>
      editor(page).evaluate((el) => getComputedStyle(el, '::before').content),
    ).toBe('none')
  })
})
