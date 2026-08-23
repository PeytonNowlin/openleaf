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

  // Mounted on the editor host when opened, not parked on document.body from
  // construction. A closed popover used to sit in the middle of the page
  // because `display: grid` overrode the UA's `[popover]` hiding rule, and UA
  // popover styles are `position: fixed; inset: 0; margin: auto`.
  test('are closed on load', async ({ page }) => {
    await expect(emojiGrid(page)).toHaveCount(0)
    await expect(charmapGrid(page)).toHaveCount(0)
  })

  test('stay closed while the page scrolls', async ({ page }) => {
    await page.mouse.wheel(0, 600)
    await expect(emojiGrid(page)).toHaveCount(0)
    await expect(charmapGrid(page)).toHaveCount(0)
  })

  test('open as a child of the editor, not of document.body', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Emoji' }).click()
    await expect(emojiGrid(page)).toBeVisible()
    const placement = await emojiGrid(page).evaluate((el) => ({
      parentIsBody: el.parentElement === document.body,
      insideEditor: Boolean(el.closest('openleaf-editor')),
    }))
    expect(placement.parentIsBody).toBe(false)
    expect(placement.insideEditor).toBe(true)
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

  /*
   * Tab must get out, and it must get out the same way in every engine.
   *
   * This asserted only that the first cell was no longer focused, which two
   * quite different behaviours satisfied: Chromium walked focus off the end of
   * the document (the popover is the last thing in <body>), while Firefox moved
   * focus nowhere at all and left the panel open -- a keyboard trap, WCAG 2.1.2,
   * with Escape the only way out. Neither was the intent, and the weaker
   * assertion could not tell them apart.
   *
   * So the destination is named. The grid now handles Tab itself: close, return
   * focus to the trigger, let the browser's own Tab run from there. All three
   * engines land on the editor, which is also better than Chromium's old
   * behaviour of dumping focus into the browser chrome.
   */
  test('Tab leaves the grid for the editor, and closes it, in every engine', async ({ page }) => {
    const button = toolbar(page).getByRole('button', { name: 'Character map' })
    await button.click()
    await expect(charmapGrid(page).getByRole('gridcell', { name: 'Copyright' })).toBeFocused()

    await page.keyboard.press('Tab')

    // By attribute, not by role: a closed popover is out of the accessibility
    // tree, so a role query here races the close and reports "element(s) not
    // found" rather than a focus verdict.
    await expect(charmapGrid(page).locator('[aria-label="Copyright"]')).not.toBeFocused()
    await expect(charmapGrid(page)).toBeHidden()
    await expect(editor(page)).toBeFocused()
  })

  test('Shift+Tab also leaves, backwards', async ({ page }) => {
    const button = toolbar(page).getByRole('button', { name: 'Character map' })
    await button.click()
    await expect(charmapGrid(page).getByRole('gridcell', { name: 'Copyright' })).toBeFocused()

    await page.keyboard.press('Shift+Tab')

    // Where backwards lands is toolbar order, which this file does not own; that
    // it lands outside a closed panel is the contract. Tab is not intercepted
    // with preventDefault precisely so this direction needs no separate
    // implementation.
    await expect(charmapGrid(page).locator('[aria-label="Copyright"]')).not.toBeFocused()
    await expect(charmapGrid(page)).toBeHidden()
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
