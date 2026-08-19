import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness-session.html'
const CORE_ONLY = '/packages/element/test/e2e/harness.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const value = (page: Page) => page.locator('#body').inputValue()

test.describe('core bundle alone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CORE_ONLY)
    await expect(editor(page)).toBeVisible()
  })

  test('has no session controls', async ({ page }) => {
    await expect(toolbar(page).getByRole('button', { name: 'Find and replace' })).toHaveCount(0)
    await expect(toolbar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  })
})

test.describe('with the session bundle loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
    await expect(toolbar(page).getByRole('button', { name: 'Find and replace' })).toBeVisible()
  })

  test('finds and replaces across the document', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Find and replace' }).click()
    const find = page.getByRole('search', { name: 'Find and replace' })
    await expect(find).toBeVisible()
    await find.getByRole('searchbox').fill('alpha')
    await expect(find.getByRole('status')).toContainText('2 matches')
    await find.getByRole('button', { name: 'Next' }).click()
    await find.getByRole('textbox', { name: 'Replace' }).fill('uno')
    await find.getByRole('button', { name: 'Replace all' }).click()
    await expect.poll(() => value(page)).toContain('uno beta uno')
  })

  test('reports a word count', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Word count' }).click()
    const dialog = page.getByRole('dialog', { name: 'Word count' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Words:/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('save submits the bound form', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('form')?.addEventListener('submit', (event) => {
        event.preventDefault()
        ;(window as unknown as { __saved: boolean }).__saved = true
      })
    })
    await toolbar(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __saved?: boolean }).__saved)).toBe(true)
  })

  test('preview opens a read-only published view', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Preview' }).click()
    const dialog = page.getByRole('dialog', { name: 'Preview' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('iframe[title="Published preview"]')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('print builds a print frame from the document', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        ;(window.top as unknown as { __printed: boolean }).__printed = true
      }
    })
    await toolbar(page).getByRole('button', { name: 'Print' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true)
  })

  test('new document clears the editor', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'New document' }).click()
    await expect.poll(() => value(page)).toBe('<p></p>')
  })

  test('offers to restore a stored draft', async ({ page }) => {
    const key = 'openleaf:draft:v1:/packages/element/test/e2e/harness-session.html#body'
    await page.evaluate(({ key }) => {
      localStorage.setItem(key, JSON.stringify({ html: '<p>recovered draft</p>', savedAt: Date.now() }))
    }, { key })
    await page.reload()
    await expect(editor(page)).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Restore unsaved draft' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Restore draft' }).click()
    await expect.poll(() => value(page)).toContain('recovered draft')
  })
})
