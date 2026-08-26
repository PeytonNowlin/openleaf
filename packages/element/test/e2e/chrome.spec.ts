import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness-chrome.html'

const main = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
// First, because the harness editor also carries a floating selection toolbar
// that is a direct child with the same class, role and name. The main toolbar is
// appended before it.
const mainToolbar = (page: Page) =>
  page.locator('openleaf-editor[for="body"] > .ol-toolbar').first()
const value = (page: Page) => stored(page)

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(main(page)).toBeVisible()
})

test('shows a menubar above the toolbar', async ({ page }) => {
  const bar = page.locator('openleaf-editor[for="body"]').getByRole('menubar', { name: 'Editor menu' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
})

test('opens help from F1', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Post body' }).click()
  await page.keyboard.press('F1')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('turns a typed URL into a link', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Post body' })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' https://example.org ')
  await expect.poll(() => page.locator('#body').inputValue()).toContain('href="https://example.org"')
})


test.describe('the menubar list', () => {
  // The attribute was read as a flag and its contents discarded, so
  // menubar="edit help" rendered Insert, Format and View as well.
  test('renders only the menus named', async ({ page }) => {
    const bar = page.locator('openleaf-editor[for="body-menus"]').getByRole('menubar')
    await expect(bar.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(bar.getByRole('menuitem', { name: 'Help' })).toBeVisible()
    await expect(bar.getByRole('menuitem', { name: 'Insert' })).toHaveCount(0)
    await expect(bar.getByRole('menuitem', { name: 'Format' })).toHaveCount(0)
    await expect(bar.getByRole('menuitem', { name: 'View' })).toHaveCount(0)
  })
})

test.describe('per-editor language', () => {
  // The locale was process-wide, so whichever editor built last relabelled every
  // toolbar on the page.
  test('labels each editor in its own language', async ({ page }) => {
    const french = page.locator('openleaf-editor[for="body-fr"] > .ol-toolbar').first()
    await expect(french.getByRole('button', { name: 'Gras' })).toBeVisible()
    // The English editor keeps its own labels.
    await expect(mainToolbar(page).getByRole('button', { name: 'Bold' })).toBeVisible()
    await expect(mainToolbar(page).getByRole('button', { name: 'Gras' })).toHaveCount(0)
  })
})

test.describe('the formats dropdown', () => {
  // The element half of a selector token was parsed and thrown away, so `h2`
  // applied class="h2" to a paragraph instead of making it a heading.
  test('applies the element a token names', async ({ page }) => {
    await main(page).click()
    await mainToolbar(page).getByRole('combobox').selectOption({ label: 'Section' })
    await expect.poll(() => value(page)).toContain('<h2>')
    expect(await value(page)).not.toContain('class="h2"')
  })

  test('applies both halves of a token', async ({ page }) => {
    await main(page).click()
    await mainToolbar(page).getByRole('combobox').selectOption({ label: 'Lead' })
    await expect.poll(() => value(page)).toContain('<p class="lead">')
  })

  test('applies a class-only token without changing the element', async ({ page }) => {
    await main(page).click()
    await mainToolbar(page).getByRole('combobox').selectOption({ label: 'Note' })
    await expect.poll(() => value(page)).toContain('<p class="note">')
  })
})

test.describe('fullscreen', () => {
  // Escape leaves fullscreen without going through the toolbar, and the class
  // carries the fixed-position fallback -- so the editor kept covering the page
  // and the next press only cleared stale state.
  test('reconciles when fullscreen is left by Escape', async ({ page }) => {
    const host = page.locator('openleaf-editor[for="body"]')
    await mainToolbar(page).getByRole('button', { name: 'Fullscreen' }).click()
    await expect(host).toHaveClass(/ol-fullscreen/)
    // Settled first: exitFullscreen throws "Document not active" if it is called
    // while the browser is still transitioning into fullscreen.
    await page.waitForTimeout(200)
    await page.evaluate(() => document.exitFullscreen())
    await expect(host).not.toHaveClass(/ol-fullscreen/)
    // And the button works again rather than only clearing stale state.
    await mainToolbar(page).getByRole('button', { name: 'Fullscreen' }).click()
    await expect(host).toHaveClass(/ol-fullscreen/)
  })
})

test.describe('the toolbar overflow menu', () => {
  // The clone is a listener-free <select>. A forwarded click never carried the
  // chosen value, so headings could not be applied from the overflow menu.
  test('applies a block type chosen from the overflow menu', async ({ page }) => {
    const host = page.locator('openleaf-editor[for="body-narrow"]')
    const editor = host.getByRole('textbox', { name: 'Narrow body' })
    await editor.click()
    const more = host.getByRole('button', { name: 'More' })
    await expect(more).toBeVisible()
    await more.click()
    const menu = host.locator('.ol-overflow-menu')
    const select = menu.getByRole('combobox')
    await expect(select).toBeVisible()
    await select.selectOption('2')
    await expect.poll(() => page.locator('#body-narrow').inputValue()).toContain('<h2>')
  })
})

test.describe('sticky main toolbar', () => {
  // jsdom will report `position: sticky` and still let the bar scroll away.
  // The page-scroll + tall canvas case is the one that actually lost the
  // formatting controls; fullscreen is a column flex and is not this.
  test('stays in the viewport after the page scrolls a long canvas', async ({ page }) => {
    const host = page.locator('openleaf-editor[for="body"]')
    await host.locator('.ProseMirror').evaluate((el) => {
      ;(el as HTMLElement).style.minHeight = '3000px'
    })
    const toolbar = mainToolbar(page)
    await expect(toolbar).toBeVisible()
    expect(await toolbar.evaluate((el) => getComputedStyle(el).position)).toBe('sticky')

    await page.evaluate(() => window.scrollTo(0, 900))
    const box = await toolbar.boundingBox()
    expect(box).not.toBeNull()
    // Stuck at the top of the scrolling viewport, not 900px above it.
    expect(box!.y).toBeGreaterThanOrEqual(-1)
    expect(box!.y).toBeLessThan(80)
    const hostBox = await host.boundingBox()
    expect(hostBox).not.toBeNull()
    expect(hostBox!.y + hostBox!.height).toBeGreaterThan(0)
  })

  test('does not stick a lone toolbar2 when the primary bar is omitted', async ({ page }) => {
    await page.evaluate(() => {
      const wrap = document.createElement('div')
      wrap.id = 't2-only-wrap'
      wrap.innerHTML =
        '<openleaf-editor id="t2-only" toolbar="none" toolbar2="bold italic" aria-label="Secondary only"></openleaf-editor>'
      document.body.prepend(wrap)
    })
    const host = page.locator('#t2-only')
    const bar = host.locator('> .ol-toolbar').first()
    await expect(bar).toBeVisible()
    expect(await bar.evaluate((el) => el.classList.contains('ol-toolbar--secondary'))).toBe(true)
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('relative')

    await host.locator('.ProseMirror').evaluate((el) => {
      ;(el as HTMLElement).style.minHeight = '3000px'
    })
    await bar.scrollIntoViewIfNeeded()
    const before = await bar.boundingBox()
    expect(before).not.toBeNull()
    await page.evaluate(() => window.scrollBy(0, 900))
    const after = await bar.boundingBox()
    // In flow: the bar travels with the page. Sticky would pin it near y=0.
    expect(after).not.toBeNull()
    expect(after!.y).toBeLessThan(before!.y - 400)
  })
})

test.describe('floating selection toolbar guards', () => {
  const floating = (page: Page) =>
    page.locator('openleaf-editor[for="body"] > .ol-toolbar.ol-floating').first()

  test('shows after a drag-select, and hides when the editor blurs', async ({ page }) => {
    const bar = floating(page)
    await expect(bar).toBeHidden()

    const text = main(page).getByText('A stored paragraph.')
    const box = await text.boundingBox()
    expect(box).not.toBeNull()
    // A real pointer sequence, not Shift+Arrow: `hasFocus()` is false in some
    // engines while the drag is establishing the range, and a naive focus
    // guard hides the bar for exactly this gesture.
    await page.mouse.move(box!.x + 4, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2)
    await page.mouse.up()
    await expect(bar).toBeVisible()

    await page.mouse.click(5, 5)
    await expect(bar).toBeHidden()
  })
})
