/**
 * Keyboard operability of the chrome the existing suite never drove.
 *
 * The main toolbar has had real key-event tests since it shipped, and it is the
 * one part of the editor that works. The overflow panel, the menubar, the popup
 * menus, the context menus and the dialogs did not, and every defect fixed here
 * shipped through a green suite because nothing ever pressed a key at them.
 *
 * Everything below drives actual key events at actual browsers, and asserts on
 * where focus ended up -- which is the thing a keyboard user experiences and the
 * thing an ARIA attribute assertion cannot see.
 */

import { expect, test, type Page } from '@playwright/test'

const CHROME = '/packages/element/test/e2e/harness-chrome.html'
const MAIN = '/packages/element/test/e2e/harness.html'

/** The accessible name of whatever currently holds focus. */
function focusedName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName.toLowerCase()
  })
}

/** The tag of whatever holds focus, for "is it stranded on body" questions. */
function focusedTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'null')
}

test.describe('the toolbar overflow panel', () => {
  const host = (page: Page) => page.locator('openleaf-editor[for="body-narrow"]')
  const more = (page: Page) => host(page).getByRole('button', { name: 'More' })
  const panel = (page: Page) => host(page).locator('.ol-overflow-menu')

  test.beforeEach(async ({ page }) => {
    await page.goto(CHROME)
    await expect(host(page).getByRole('textbox', { name: 'Narrow body' })).toBeVisible()
    await expect(more(page)).toBeVisible()
  })

  /*
   * It was appended to the HOST, after the editable region, so it was the last
   * child of the editor: Tab from More went into the content and the panel could
   * only be reached by tabbing backwards past everything.
   */
  test('sits immediately after the bar it belongs to', async ({ page }) => {
    const ordered = await host(page).evaluate((el) => {
      const bar = el.querySelector('.ol-toolbar')
      return bar?.nextElementSibling?.classList.contains('ol-overflow-menu') ?? false
    })
    expect(ordered).toBe(true)
  })

  test('opens with the keyboard and moves focus into itself', async ({ page }) => {
    await more(page).focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true')

    const inside = await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor[for="body-narrow"] .ol-overflow-menu')
      return !!el && el.contains(document.activeElement)
    })
    expect(inside).toBe(true)
  })

  test('moves between its controls on the arrow keys', async ({ page }) => {
    await more(page).click()
    const first = await focusedName(page)
    await page.keyboard.press('ArrowDown')
    expect(await focusedName(page)).not.toBe(first)
    await page.keyboard.press('ArrowUp')
    expect(await focusedName(page)).toBe(first)
  })

  test('Escape closes it and puts focus back on More', async ({ page }) => {
    await more(page).click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    expect(await focusedName(page)).toBe('More')
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('is one tab stop while it is open', async ({ page }) => {
    await more(page).click()
    const tabbable = await panel(page)
      .locator('button, select')
      .evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length)
    expect(tabbable).toBe(1)
  })

  test('holds the controls themselves, not a second copy of them', async ({ page }) => {
    await more(page).click()
    // The clones duplicated `data-ol-id`, `aria-label` and `aria-pressed`, so
    // the accessibility tree carried two "Bold, toggle button" entries and the
    // forwarding had to guess which of them owned the command.
    const duplicated = await host(page).evaluate((el) => {
      const seen = new Map<string, number>()
      for (const node of el.querySelectorAll<HTMLElement>('[data-ol-id]')) {
        const id = node.dataset['olId'] ?? ''
        seen.set(id, (seen.get(id) ?? 0) + 1)
      }
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    })
    expect(duplicated).toEqual([])
  })
})

test.describe('the menubar and its menus', () => {
  const bar = (page: Page) =>
    page.locator('openleaf-editor[for="body"]').getByRole('menubar', { name: 'Editor menu' })

  test.beforeEach(async ({ page }) => {
    await page.goto(CHROME)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible()
  })

  test('is one tab stop, not one per menu', async ({ page }) => {
    const tabbable = await bar(page)
      .getByRole('menuitem')
      .evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length)
    expect(tabbable).toBe(1)
  })

  test('names the open menu after the trigger that opened it', async ({ page }) => {
    const edit = bar(page).getByRole('menuitem', { name: 'Edit' })
    await edit.click()
    // Without this a screen reader announces "menu", with nothing to say which.
    await expect(page.getByRole('menu', { name: 'Edit' })).toBeVisible()
    await expect(edit).toHaveAttribute('aria-controls', /ol-menu-/)
  })

  test('Escape in a menu returns focus to its trigger, not the document', async ({ page }) => {
    await bar(page).getByRole('menuitem', { name: 'Edit' }).click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    expect(await focusedName(page)).toBe('Edit')
  })

  test('Tab closes the menu rather than walking through it', async ({ page }) => {
    await bar(page).getByRole('menuitem', { name: 'Edit' }).click()
    await expect(page.getByRole('menu', { name: 'Edit' })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('menu', { name: 'Edit' })).toBeHidden()
    expect(await focusedName(page)).toBe('Edit')
  })

  test('jumps to an item by its first letter', async ({ page }) => {
    await bar(page).getByRole('menuitem', { name: 'Edit' }).click()
    await page.keyboard.press('i')
    expect(await focusedName(page)).toBe('Italic')
  })

  test('Home and End reach the ends of the menu', async ({ page }) => {
    await bar(page).getByRole('menuitem', { name: 'Edit' }).click()
    await page.keyboard.press('End')
    expect(await focusedName(page)).toBe('Inline code')
    await page.keyboard.press('Home')
    expect(await focusedName(page)).toBe('Undo')
  })

  /*
   * `close()` replaces the menu's children, which removes the element that has
   * focus -- and a browser whose focused node disappears falls back to <body>.
   * Choosing Bold from the Edit menu therefore left the author at the top of the
   * page with no way back except Tab.
   */
  test('leaves focus somewhere real after an item is chosen', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Post body' }).click()
    await bar(page).getByRole('menuitem', { name: 'Edit' }).click()
    await page
      .getByRole('menu', { name: 'Edit' })
      .getByRole('menuitem', { name: 'Bold', exact: true })
      .click()
    expect(await focusedTag(page)).not.toBe('body')
  })
})

test.describe('the link context menu', () => {
  /**
   * Put a COLLAPSED caret inside the link, by keyboard.
   *
   * Clicking the link is not a way to do it: Chromium does not move the caret
   * for a click on an `<a>` inside contenteditable. Ten presses of ArrowRight
   * from the start of the line lands between the "i" and the "n" of "linked",
   * which is the exact state -- caret in a link, nothing selected -- that the
   * context menu exists for and that the Link item used to refuse.
   */
  async function caretInLink(page: Page): Promise<void> {
    // The assignment above is asynchronous as far as this page is concerned: the
    // link has to exist before the caret can be walked into it.
    await expect(page.getByRole('link', { name: 'linked' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Post body' }).click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight')
    // The precondition, asserted rather than assumed: the toolbar's Link button
    // reads pressed exactly when the caret is inside a link.
    await expect(page.locator('.ol-toolbar [data-ol-id="link"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }

  test.beforeEach(async ({ page }) => {
    await page.goto(MAIN)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible()
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<p>before <a href="https://example.org">linked</a> after</p>'
    })
  })

  /*
   * Shift+F10 did fire `contextmenu`, but its target is the FOCUSED element --
   * the ProseMirror div -- and `closest()` walks up from there, so it never
   * found the <a> at the caret and the handler returned in silence.
   */
  test('Shift+F10 with the caret in a link opens the link menu', async ({ page }) => {
    await caretInLink(page)
    await page.keyboard.press('Shift+F10')
    const menu = page.getByRole('menu', { name: 'Editor menu' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Remove link', exact: true })).toBeVisible()
  })

  test('positions itself at the caret, not at the top-left corner', async ({ page }) => {
    await caretInLink(page)
    await page.keyboard.press('Shift+F10')
    const box = await page.getByRole('menu', { name: 'Editor menu' }).boundingBox()
    expect(box).not.toBeNull()
    // `clientX`/`clientY` on a synthesized event are meaningless; 0,0 is what
    // they produced, which puts the menu in the corner of the page.
    expect(box!.x).toBeGreaterThan(4)
    expect(box!.y).toBeGreaterThan(4)
  })

  test('Escape closes it and returns focus to the editor', async ({ page }) => {
    await caretInLink(page)
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu', { name: 'Editor menu' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Editor menu' })).toBeHidden()
    expect(await focusedName(page)).toBe('Post body')
  })

  /*
   * `isEnabled: !selection.empty` and `isActive: activeLink(state) !== null`
   * contradicted each other for the one gesture the menu exists for: a
   * right-click on a link places a COLLAPSED caret, so the item rendered
   * aria-pressed AND aria-disabled and refused every click. An existing link
   * could not be edited from the context menu at all.
   */
  test('can actually edit the link it was opened on', async ({ page }) => {
    await caretInLink(page)
    await page.keyboard.press('Shift+F10')
    const item = page
      .getByRole('menu', { name: 'Editor menu' })
      .getByRole('menuitem', { name: 'Link', exact: true })
    await expect(item).toHaveAttribute('aria-disabled', 'false')
    await item.click()
    await expect(page.getByRole('dialog', { name: 'Edit link' })).toBeVisible()
  })

  test('Remove link works from a caret inside the link', async ({ page }) => {
    await caretInLink(page)
    await page.keyboard.press('Shift+F10')
    await page
      .getByRole('menu', { name: 'Editor menu' })
      .getByRole('menuitem', { name: 'Remove link', exact: true })
      .click()
    await expect.poll(() => page.locator('#body').inputValue()).not.toContain('<a href')
  })
})

test.describe('focus restoration', () => {
  /*
   * Nothing in the suite asserted this before, in any widget: that focus comes
   * back to where the author left it. It is the difference between a dialog a
   * keyboard user can use twice and one they can use once.
   */
  // A regression guard rather than a fix: the dialog already did this, and
  // nothing in the suite held it there.
  test('a dialog returns focus to the control that opened it', async ({ page }) => {
    await page.goto(MAIN)
    const editor = page.getByRole('textbox', { name: 'Post body' })
    await expect(editor).toBeVisible()
    await editor.getByText('A stored paragraph.').click({ clickCount: 3 })

    const link = page
      .locator('openleaf-editor .ol-toolbar')
      .getByRole('button', { name: 'Link', exact: true })
    await link.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // Not <body>, and not nowhere.
    expect(await focusedTag(page)).not.toBe('body')
  })
})
