import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness-insert.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const value = (page: Page) => stored(page)
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
    await emojiGrid(page).getByRole('gridcell', { name: 'Fire' }).click()
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

  test('are a grid a reader can navigate with the arrow keys', async ({ page }) => {
    // role="menu" with button children was invalid ARIA, and the only keydown
    // handler swallowed Tab and ignored the arrows, so only the first glyph
    // was reachable from the keyboard. Same model as the colour picker.
    await toolbar(page).getByRole('button', { name: 'Character map' }).click()
    await expect(charmapGrid(page)).toBeVisible()
    await expect(charmapGrid(page)).toHaveAttribute('role', 'grid')
    await expect(charmapGrid(page).getByRole('gridcell')).toHaveCount(40)

    const cell = (name: string) => charmapGrid(page).getByRole('gridcell', { name })
    await expect(cell('Copyright')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(cell('Registered')).toBeFocused()
    await expect(charmapGrid(page)).toBeVisible()
    await page.keyboard.press('End')
    await expect(cell('Bullet')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(cell('Copyright')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(cell('Ellipsis')).toBeFocused()
  })

  test('let Tab leave the grid instead of closing it from the first glyph', async ({ page }) => {
    const button = toolbar(page).getByRole('button', { name: 'Character map' })
    await button.click()
    await expect(charmapGrid(page).getByRole('gridcell', { name: 'Copyright' })).toBeFocused()
    await page.keyboard.press('Tab')
    // By attribute, not by role -- the same reason the grid locators above are
    // by class. Tab moves focus out, and `focusout` then closes the panel on
    // purpose ("leaving by any route closes"), which takes the cell out of the
    // accessibility tree. A role query raced that close and reported
    // "element(s) not found" on the runs where the close landed first, which is
    // what made this test flake rather than anything about Tab.
    await expect(charmapGrid(page).locator('[aria-label="Copyright"]')).not.toBeFocused()
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
