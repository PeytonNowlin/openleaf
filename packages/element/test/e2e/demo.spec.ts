/**
 * The demo page itself.
 *
 * It is the project's shop window and had no coverage, which is how a character
 * map and emoji grid shipped visible-on-load, floating over the middle of the
 * page. Every harness test passed throughout, because no harness loaded the
 * demo's combination of bundles.
 *
 * Deliberately shallow: this asserts the page builds, stays quiet, and that each
 * documented editor is really there. The behaviour of each feature is tested
 * against its own harness.
 */

import { expect, test, type Page } from '@playwright/test'

const DEMO = '/demo/index.html'

/** Every editor the page documents, by its bound textarea id. */
const EDITORS = ['body', 'typo', 'insert-body', 'chrome-body', 'narrow-body', 'fr-body', 'comment']

const host = (page: Page, id: string) => page.locator(`openleaf-editor[for="${id}"]`)

test.describe('the demo page', () => {
  test('builds every editor without a console error or a failed request', async ({ page }) => {
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`)
    })
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`))
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`)
    })

    await page.goto(DEMO)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible({ timeout: 15000 })

    for (const id of EDITORS) {
      // A built editor has a toolbar; an editor that threw while building does not.
      await expect(host(page, id).locator('> .ol-toolbar').first()).toBeVisible()
    }
    expect(problems).toEqual([])
  })

  // The bug this file exists for: both grids are popovers appended to <body>, and
  // a closed popover that is nonetheless laid out sits in the middle of the page.
  test('opens with no glyph picker showing, and keeps them shut while scrolling', async ({ page }) => {
    await page.goto(DEMO)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible({ timeout: 15000 })
    const grids = page.locator('.ol-insert-grid')
    await expect(grids).not.toHaveCount(0)
    expect(await grids.evaluateAll((els) => els.every((e) => getComputedStyle(e).display === 'none'))).toBe(true)
    await page.mouse.wheel(0, 1500)
    expect(await grids.evaluateAll((els) => els.every((e) => getComputedStyle(e).display === 'none'))).toBe(true)
  })

  test('shows the menubar the chrome section documents', async ({ page }) => {
    await page.goto(DEMO)
    const bar = host(page, 'chrome-body').getByRole('menubar')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  })

  test('collapses the narrow toolbar into a More menu', async ({ page }) => {
    await page.goto(DEMO)
    await expect(host(page, 'narrow-body').getByRole('button', { name: 'More' })).toBeVisible()
  })

  // Two editors, two languages, one page. The locale used to be process-wide, so
  // whichever built last relabelled the other.
  test('labels each editor in its own language', async ({ page }) => {
    await page.goto(DEMO)
    await expect(host(page, 'fr-body').getByRole('button', { name: 'Gras' })).toBeVisible()
    await expect(host(page, 'body').getByRole('button', { name: 'Bold' }).first()).toBeVisible()
  })

  // The typography section's whole claim: inherited font markup stays editable
  // text rather than becoming an atom, and converts to the modelled spelling.
  test('keeps the typography sample editable and modelled', async ({ page }) => {
    await page.goto(DEMO)
    const stored = await page.locator('#typo').inputValue()
    expect(stored).toContain('font-family:Verdana')
    expect(stored).not.toContain('<font')
    const content = host(page, 'typo').getByRole('textbox')
    await content.click()
    // No trailing space in the typed text: a space at the end of a text run is
    // stored as a non-breaking one in some engines, which is a whitespace
    // question and not what this test is asking.
    await page.keyboard.type('typed')
    await expect.poll(() => page.locator('#typo').inputValue()).toContain('typed')
  })
})
