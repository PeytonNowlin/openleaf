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

/**
 * The painted width of the prompt, in pixels, or 0 when nothing is generated.
 *
 * Reading the prompt's TEXT back out of `::before` is not portable. CSS Values
 * 4 substitutes `attr()` at used-value time, so Gecko's getComputedStyle hands
 * back the literal `attr(data-placeholder)` while painting the string
 * perfectly well; Blink and WebKit resolve it early and return the quoted
 * text. Asserting on that string passed on two engines and failed on the third
 * for a difference no reader would ever see.
 *
 * The box is the same everywhere: a `::before` carrying text has a measured
 * width, and one that was never generated reports `auto`. That is also the
 * stronger claim -- `content` naming a string does not prove the engine laid
 * anything out.
 */
async function promptWidth(page: Page): Promise<number> {
  return editor(page).evaluate((el) => {
    const width = Number.parseFloat(getComputedStyle(el, '::before').width)
    return Number.isFinite(width) ? width : 0
  })
}

function promptContent(page: Page): Promise<string> {
  return editor(page).evaluate((el) => getComputedStyle(el, '::before').content)
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

    await expect.poll(() => promptWidth(page)).toBeGreaterThan(0)
    const oneLine = await promptWidth(page)

    const valueWhileEmpty = await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      return el.value
    })
    expect(valueWhileEmpty).toBe('<p></p>')
    expect(valueWhileEmpty).not.toContain('Write the article')

    // The glyphs come from `data-placeholder` rather than from some other rule
    // that happens to generate a box: a longer prompt, same font, paints wider.
    await page.evaluate(() => {
      document
        .querySelector('openleaf-editor')
        ?.setAttribute('placeholder', 'Write the article, and then write a good deal more of it…')
    })
    await expect.poll(() => promptWidth(page)).toBeGreaterThan(oneLine)

    await editor(page).click()
    await page.keyboard.type('H')

    await expect.poll(() => promptContent(page)).toBe('none')
    expect(await promptWidth(page)).toBe(0)
  })
})
