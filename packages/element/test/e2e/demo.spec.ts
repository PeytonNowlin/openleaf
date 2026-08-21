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
import { stored as storedValue } from './stored.js'

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

  /*
   * The floating bars are `hidden` at rest, and `hidden` was not enough. The
   * base `.ol-toolbar` rule sets `display: flex`, and a class selector outranks
   * the UA stylesheet's `[hidden]`, so both bars were laid out over the prose on
   * a page nobody had selected anything on. The same trap as `.ol-insert-grid`
   * above, one element over.
   */
  test('keeps the floating bars hidden until there is a selection', async ({ page }) => {
    await page.goto(DEMO)
    const pm = host(page, 'chrome-body').locator('.ProseMirror')
    await expect(pm).toBeVisible({ timeout: 15000 })
    const floating = host(page, 'chrome-body').locator('.ol-toolbar.ol-floating').first()
    await expect(floating).toBeHidden()

    await pm.locator('p').first().click()
    await page.keyboard.down('Shift')
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    // Still shows when it should: a rule that hid it always would pass the
    // assertion above and break the feature.
    await expect(floating).toBeVisible()
  })

  /*
   * The other half of the `hidden` fix, and the reason it needed a second look.
   *
   * The insert bar exists for a caret sitting in an empty block, which is the
   * state a new post opens in -- so it has to be right at MOUNT, not after the
   * first transaction. `FloatingToolbars.mount()` did not position from the
   * state it was mounted with, and nothing noticed while `hidden` did nothing:
   * the bar was painted regardless, so a missing initial position looked like a
   * working feature. Found by review, kept honest here.
   */
  test('shows the insert bar on an editor that opens on an empty block', async ({ page }) => {
    await page.goto(DEMO)
    await expect(page.locator('openleaf-editor[for="body"] .ProseMirror')).toBeVisible({ timeout: 15000 })
    const shown = await page.evaluate(async () => {
      const wrap = document.createElement('div')
      document.body.appendChild(wrap)
      wrap.innerHTML = '<openleaf-editor id="probe" insert-toolbar="image"></openleaf-editor>'
      await new Promise((r) => setTimeout(r, 400))
      const bar = document.querySelector('#probe .ol-toolbar.ol-floating') as HTMLElement | null
      const visible = !!bar && getComputedStyle(bar).display !== 'none'
      wrap.remove()
      return visible
    })
    expect(shown).toBe(true)
  })

  /*
   * `content-css` loads asynchronously and adopting the sheet dispatches no
   * transaction, so a bar positioned at mount is pointing at where the caret was
   * before the stylesheet changed the metrics. Measured on a sheet that moves the
   * first paragraph down: 215px adrift before the reposition, 55px after -- the
   * offset the placement intends.
   */
  test('realigns the insert bar once the content stylesheet settles', async ({ page }) => {
    await page.route('**/probe-shift.css', (route) =>
      route.fulfill({
        contentType: 'text/css',
        body: '.ol-content .ProseMirror p { margin-top: 260px; font-size: 34px; }',
      }),
    )
    await page.goto(DEMO)
    await expect(page.locator('openleaf-editor[for="body"] .ProseMirror')).toBeVisible({ timeout: 15000 })
    await page.evaluate(() => {
      const wrap = document.createElement('div')
      wrap.id = 'shift-wrap'
      document.body.appendChild(wrap)
      wrap.innerHTML =
        '<openleaf-editor id="shift" insert-toolbar="image" content-css="/probe-shift.css"></openleaf-editor>'
    })
    // Polled, not slept on. The stylesheet is fetched and adopted
    // asynchronously, and how long that takes is the engine's business.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bar = document.querySelector('#shift .ol-toolbar.ol-floating') as HTMLElement | null
            const para = document.querySelector('#shift .ProseMirror p') as HTMLElement | null
            if (!bar || !para) return Number.POSITIVE_INFINITY
            return Math.round(Math.abs(bar.getBoundingClientRect().top - para.getBoundingClientRect().top))
          }),
        { timeout: 10000 },
      )
      .toBeLessThan(120)
    await page.evaluate(() => document.getElementById('shift-wrap')?.remove())
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
    const typo = await storedValue(page, 'typo')
    expect(typo).toContain('font-family:Verdana')
    expect(typo).not.toContain('<font')
    const content = host(page, 'typo').getByRole('textbox')
    await content.click()
    // No trailing space in the typed text: a space at the end of a text run is
    // stored as a non-breaking one in some engines, which is a whitespace
    // question and not what this test is asking.
    await page.keyboard.type('typed')
    await expect.poll(() => storedValue(page, 'typo')).toContain('typed')
  })

  /*
   * The collapsible-section example, which was the first thing a reader tried and
   * the first thing that did not work. Clicking a summary inside a contenteditable
   * does not toggle the element -- the click places a caret instead -- so the body
   * of the section was unreachable.
   */
  test('toggles the collapsible section, and stores the state', async ({ page }) => {
    await page.goto(DEMO)
    const det = host(page, 'insert-body').locator('details').first()
    const stored = () => storedValue(page, 'insert-body')
    await expect(det).toBeVisible()

    expect(await det.evaluate((d: HTMLDetailsElement) => d.open)).toBe(false)
    await det.locator('summary').click()
    await expect.poll(() => det.evaluate((d: HTMLDetailsElement) => d.open)).toBe(true)
    await expect(det.locator('p').first()).toBeVisible()
    await expect.poll(stored).toContain('<details open')

    await det.locator('summary').click()
    await expect.poll(() => det.evaluate((d: HTMLDetailsElement) => d.open)).toBe(false)
    expect(await stored()).not.toContain('<details open')
  })

  test('keeps the section label editable', async ({ page }) => {
    await page.goto(DEMO)
    const det = host(page, 'insert-body').locator('details').first()
    await det.locator('summary').click()
    await page.keyboard.type('XX')
    await expect.poll(() => storedValue(page, 'insert-body')).toContain('XX')
  })

  // Typing on the front door. Clicked by its text rather than its centre: the
  // editor is taller than the viewport, and its centre lands on the preserved
  // callout atom, which takes no caret.
  test('accepts typing in the main editor and mirrors it to the textarea', async ({ page }) => {
    await page.goto(DEMO)
    const content = page.getByRole('textbox', { name: 'Post body' })
    await expect(content).toBeVisible({ timeout: 15000 })
    await content.getByText('Try editing this').click()
    await page.keyboard.type('AUDIT')
    await expect.poll(() => storedValue(page)).toContain('AUDIT')
    await expect.poll(() => page.locator('#output').textContent()).toContain('AUDIT')
  })

  // The typography section now claims a picker as well as editability. Located
  // by id rather than by role: the label is the same word as the section heading
  // and a role query picks up the prose.
  test('applies a font and an indent from the typography section', async ({ page }) => {
    await page.goto(DEMO)
    const editor = host(page, 'typo')
    const content = editor.getByRole('textbox').first()
    await expect(content).toBeVisible({ timeout: 15000 })
    await content.click()
    await page.keyboard.press('ControlOrMeta+a')
    await editor.locator('[data-ol-id="fontFamily"]').selectOption('Georgia')
    await expect.poll(() => storedValue(page, 'typo')).toContain('font-family:Georgia')
    await editor.locator('[data-ol-id="indent"]').click()
    await expect.poll(() => storedValue(page, 'typo')).toContain('padding-inline-start')
  })

  test('switches every skin the page offers', async ({ page }) => {
    await page.goto(DEMO)
    const editor = page.locator('openleaf-editor[for="body"]')
    for (const skin of ['midnight', 'paper', 'contrast', 'compact']) {
      await page.locator(`[data-skin="${skin}"]`).click()
      await expect(editor).toHaveAttribute('skin', skin)
    }
  })

  test('opens and closes the source view', async ({ page }) => {
    await page.goto(DEMO)
    const bar = page.locator('openleaf-editor[for="body"] > .ol-toolbar').first()
    await bar.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()
    await bar.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toHaveCount(0)
  })

  test('opens every menu in the menubar', async ({ page }) => {
    await page.goto(DEMO)
    const bar = host(page, 'chrome-body').getByRole('menubar')
    for (const name of ['Edit', 'Insert', 'Format', 'View', 'Help']) {
      await bar.getByRole('menuitem', { name }).click()
      await expect(page.locator('.ol-menu:visible').first()).toBeVisible()
    }
    await page.keyboard.press('Escape')
  })

  test('opens the overflow menu on the narrow editor', async ({ page }) => {
    await page.goto(DEMO)
    const narrow = host(page, 'narrow-body')
    await narrow.getByRole('textbox').first().click()
    await narrow.getByRole('button', { name: 'More' }).click()
    await expect(narrow.locator('.ol-overflow-menu')).toBeVisible()
  })

  test('imports both sample files', async ({ page }) => {
    await page.goto(DEMO)
    await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible({ timeout: 15000 })
    for (const id of ['#import-sample', '#import-docx']) {
      await page.locator(id).click()
      await expect.poll(() => page.locator(id).textContent(), { timeout: 30000 }).not.toContain('Importing')
    }
  })
})
