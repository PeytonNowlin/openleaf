import { expect, test } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness-chrome.html'

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible()
})

test('shows a menubar above the toolbar', async ({ page }) => {
  await expect(page.getByRole('menubar', { name: 'Editor menu' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
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
