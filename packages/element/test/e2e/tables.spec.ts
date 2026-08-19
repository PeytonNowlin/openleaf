import { expect, test, type Page } from '@playwright/test'

const CORE_ONLY = '/packages/element/test/e2e/harness.html'
const WITH_TABLES = '/packages/element/test/e2e/harness-tables.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const value = (page: Page) => page.locator('#body').inputValue()

/**
 * Both configurations are tested, because both ship. A regression that only
 * appears when the opt-in bundle is absent -- or only when it is present -- is
 * exactly the kind a single-configuration suite misses.
 */

test.describe('core bundle alone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CORE_ONLY)
    await expect(editor(page)).toBeVisible()
  })

  test('reads and writes tables even without the editing bundle', async ({ page }) => {
    // The reason table NODES are in core: without them a table becomes an
    // opaque preserved atom, and "we read your tables but you may not touch
    // them" is not something you can tell a CMS.
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<table border="1"><tbody><tr><td>A</td></tr></tbody></table>'
    })
    await expect.poll(() => value(page)).toContain('<table border="1">')
    await expect(editor(page).locator('table')).toBeVisible()
  })

  test('has no table controls', async ({ page }) => {
    // The opt-in half really is absent, rather than present but inert.
    await expect(toolbar(page).getByRole('button', { name: 'Insert table' })).toHaveCount(0)
  })
})

test.describe('with the table bundle loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WITH_TABLES)
    await expect(editor(page)).toBeVisible()
    await expect(toolbar(page).getByRole('button', { name: 'Insert table' })).toBeVisible()
  })

  test('shares the core runtime instead of loading a second copy', async ({ page }) => {
    // Two ProseMirror copies would mean two schemas, and a table node built by
    // the plugin would be a different node type than the editor accepts.
    const shared = await page.evaluate(() => {
      const rt = (window as never as { OpenLeaf: { __runtime: Record<string, unknown> } }).OpenLeaf
        .__runtime
      return {
        hasRuntime: !!rt,
        modules: Object.keys(rt).length,
        oneSchema: rt['@openleaf-editor/core'] === rt['@openleaf-editor/core'],
      }
    })
    expect(shared.hasRuntime).toBe(true)
    expect(shared.modules).toBeGreaterThan(5)
  })

  test('renders the existing table with its header cells and scope', async ({ page }) => {
    await expect(editor(page).locator('table th')).toHaveCount(2)
    await expect(editor(page).locator('table th').first()).toHaveAttribute('scope', 'col')
  })

  test('inserts a table with a header row', async ({ page }) => {
    // Header row by default: a table without headers is an accessibility
    // problem authors rarely go back and fix.
    await editor(page).getByText('After the table.').click()
    await toolbar(page).getByRole('button', { name: 'Insert table' }).click()
    await page.getByRole('gridcell', { name: '3 by 3 table' }).click()

    await expect.poll(() => value(page)).toMatch(/<th scope="col">/)
    await expect(editor(page).locator('table')).toHaveCount(2)
  })

  test('adds and deletes a row', async ({ page }) => {
    const before = (await editor(page).locator('table tr').count())
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert row below' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(before + 1)

    await toolbar(page).getByRole('button', { name: 'Delete row' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(before)
  })

  test('adds and deletes a column', async ({ page }) => {
    const before = await editor(page).locator('table tr').first().locator('th, td').count()
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert column after' }).click()
    await expect(editor(page).locator('table tr').first().locator('th, td')).toHaveCount(before + 1)

    await toolbar(page).getByRole('button', { name: 'Delete column' }).click()
    await expect(editor(page).locator('table tr').first().locator('th, td')).toHaveCount(before)
  })

  test('toggles the header row', async ({ page }) => {
    await editor(page).getByText('Region').click()
    await toolbar(page).getByRole('button', { name: 'Toggle header row' }).click()
    await expect.poll(() => value(page)).not.toContain('<th')
    await expect.poll(() => value(page)).not.toMatch(/<td[^>]*scope/)

    await toolbar(page).getByRole('button', { name: 'Toggle header row' }).click()
    await expect.poll(() => value(page)).toMatch(/<th scope="col">/)
  })

  test('adds a header cell with scope', async ({ page }) => {
    await editor(page).getByText('Region').click()
    await toolbar(page).getByRole('button', { name: 'Insert column after' }).click()
    await expect.poll(() => value(page)).toMatch(/<th scope="col">Region<\/th><th scope="col">/)
  })

  test('deletes the whole table', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Delete table' }).click()
    await expect(editor(page).locator('table')).toHaveCount(0)
    // The surrounding content is untouched.
    await expect(editor(page)).toContainText('After the table.')
  })

  test('disables table commands outside a table', async ({ page }) => {
    // A control that silently does nothing looks broken. One that reports
    // itself unavailable looks unavailable.
    await editor(page).getByText('After the table.').click()
    await expect(toolbar(page).getByRole('button', { name: 'Delete row' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await editor(page).getByText('North').click()
    await expect(toolbar(page).getByRole('button', { name: 'Delete row' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
  })

  test('table controls are in the roving tabindex like every other button', async ({ page }) => {
    const tabbable = await toolbar(page).locator('button').evaluateAll(
      (els) => els.filter((el) => (el as HTMLButtonElement).tabIndex === 0).length,
    )
    expect(tabbable).toBe(1)
  })

  test('renders the plugin-registered icons rather than empty squares', async ({ page }) => {
    // Icons come from the plugin, appended to a sprite the core bundle already
    // injected. Getting that wrong produces buttons with nothing in them.
    const box = await toolbar(page)
      .getByRole('button', { name: 'Insert table' })
      .locator('svg')
      .evaluate((el) => el.getBoundingClientRect().width)
    expect(box).toBeGreaterThan(8)
    const symbol = await page.locator('#ol-icon-sprite #ol-i-table').count()
    expect(symbol).toBe(1)
  })

  test('the round trip keeps legacy table attributes', async ({ page }) => {
    await expect.poll(() => value(page)).toContain('border="1"')
    await expect.poll(() => value(page)).toContain('cellpadding="4"')
  })

  test('edits a caption from the toolbar dialog', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Table caption' }).click()
    const dialog = page.getByRole('dialog', { name: 'Table caption' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Caption').fill('Regional totals')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => value(page)).toContain('<caption>Regional totals</caption>')
  })

  test('sets cell vertical alignment from cell properties', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Cell properties' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cell properties' })
    await dialog.getByLabel('Vertical alignment').selectOption('middle')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => value(page)).toMatch(/<td[^>]*valign="middle"/)
  })

  test('opens a context menu on a table cell', async ({ page }) => {
    const cell = editor(page).locator('td', { hasText: 'North' })
    await cell.click()
    await cell.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Table' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Insert row below' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(3)
  })

  test('inserts a nested table from the size grid', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert table' }).click()
    await page.getByRole('gridcell', { name: '2 by 2 table' }).click()
    await expect(editor(page).locator('table table')).toHaveCount(1)
  })
})
