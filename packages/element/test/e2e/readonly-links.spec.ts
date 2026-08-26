/**
 * Read-only link clicks in a real engine (#181).
 *
 * jsdom will not follow `href` or change `location`. The billed failure is
 * a CMS preview navigating away; that is a browser behaviour.
 */

import { expect, test } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

test.describe('readonly link clicks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible()
  })

  test('does not navigate on https://example.org/a;b=1', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<p><a href="https://example.org/a;b=1">follow me</a></p>'
      el.setAttribute('readonly', '')
    })

    const before = page.url()
    await page.getByRole('textbox', { name: 'Post body' }).locator('a').click()
    expect(page.url()).toBe(before)
    expect(errors).toEqual([])
    await expect(page.getByRole('textbox', { name: 'Post body' }).locator('a')).toHaveAttribute(
      'href',
      'https://example.org/a;b=1',
    )
  })

  test('does not navigate on #section.2', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<p><a href="#section.2">follow me</a></p>'
      el.setAttribute('readonly', '')
    })

    const before = page.url()
    await page.getByRole('textbox', { name: 'Post body' }).locator('a').click()
    expect(page.url()).toBe(before)
    expect(page.url()).not.toContain('#section.2')
    expect(errors).toEqual([])
  })
})
