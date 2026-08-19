import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness-insert.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const value = (page: Page) => page.locator('#body').inputValue()
// Located by class rather than by role on purpose. A closed popover is not in
// the accessibility tree at all, so a role query cannot find it -- and
// `toBeHidden()` against a locator that matches nothing passes whether the panel
// is hidden or plastered across the page, which is the bug this file exists for.
const emojiGrid = (page: Page) => page.locator('.ol-insert-grid[aria-label="Emoji"]')
const charmapGrid = (page: Page) => page.locator('.ol-insert-grid[aria-label="Character map"]')

test.describe('the glyph pickers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
    await expect(toolbar(page).getByRole('button', { name: 'Emoji' })).toBeVisible()
  })

  // The grids are appended to document.body as popovers. `display: grid` in the
  // plugin's own stylesheet is an author declaration, so it overrode the UA rule
  // that keeps a closed popover hidden -- and UA popover styles are
  // `position: fixed; inset: 0; margin: auto`, so both panels sat in the middle
  // of the page from page load and followed the scroll.
  test('are closed on load', async ({ page }) => {
    await expect(emojiGrid(page)).toHaveCount(1)
    await expect(charmapGrid(page)).toHaveCount(1)
    await expect(emojiGrid(page)).toBeHidden()
    await expect(charmapGrid(page)).toBeHidden()
  })

  test('stay closed while the page scrolls', async ({ page }) => {
    await page.mouse.wheel(0, 600)
    await expect(emojiGrid(page)).toBeHidden()
    await expect(charmapGrid(page)).toBeHidden()
  })

  test('open from the toolbar and insert a character', async ({ page }) => {
    await editor(page).click()
    await toolbar(page).getByRole('button', { name: 'Emoji' }).click()
    await expect(emojiGrid(page)).toBeVisible()
    await emojiGrid(page).getByRole('button', { name: 'Fire' }).click()
    await expect.poll(() => value(page)).toContain('🔥')
    await expect(emojiGrid(page)).toBeHidden()
  })

  // UA styles would centre the panel in the viewport rather than putting it
  // under the control that opened it.
  test('open anchored to the button that opened them', async ({ page }) => {
    const button = toolbar(page).getByRole('button', { name: 'Emoji' })
    await button.click()
    await expect(emojiGrid(page)).toBeVisible()
    const trigger = await button.boundingBox()
    const panel = await emojiGrid(page).boundingBox()
    expect(trigger).not.toBeNull()
    expect(panel).not.toBeNull()
    // Below the trigger, and starting near its left edge rather than centred.
    expect(panel!.y).toBeGreaterThanOrEqual(trigger!.y)
    // Clamped to the viewport, so allow slack rather than demanding exactness.
    expect(Math.abs(panel!.x - trigger!.x)).toBeLessThan(240)
  })

  test('close on Escape and return focus to the trigger', async ({ page }) => {
    const button = toolbar(page).getByRole('button', { name: 'Emoji' })
    await button.click()
    await expect(emojiGrid(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(emojiGrid(page)).toBeHidden()
    await expect(button).toBeFocused()
  })

  test('only one picker is open at a time from the toolbar', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Emoji' }).click()
    await expect(emojiGrid(page)).toBeVisible()
    await expect(charmapGrid(page)).toBeHidden()
  })
})
