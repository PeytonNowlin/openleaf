import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

/**
 * A third-party plugin must not be able to stop the editor persisting content.
 *
 * These tests exist because a review found that a toolbar predicate throwing on
 * one keystroke would throw on every keystroke thereafter, and the textarea sync
 * plus the `openleaf:change` event sat *after* the toolbar update in the same
 * unguarded function. An autosave wired to that event -- which is on the roadmap
 * -- would stop silently and the author would lose work with no visible error.
 *
 * GOVERNANCE.md ranks silent content loss above crashes. A plugin causing it is
 * the same defect with a longer causal chain.
 */

/** Install a toolbar item whose predicate always throws, then a fresh editor using it. */
async function installBrokenPlugin(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtime = (window as never as {
      OpenLeaf: { __runtime: Record<string, { registerToolbarItem: (s: unknown) => void }> }
    }).OpenLeaf.__runtime
    const ui = runtime['@openleaf/ui']!

    ui.registerToolbarItem({
      id: 'brokenItem',
      type: 'button',
      kind: 'toggle',
      label: 'Broken',
      icon: 'bold',
      command: () => true,
      isEnabled: () => {
        throw new Error('third-party predicate exploded')
      },
      isActive: () => {
        throw new Error('third-party predicate exploded')
      },
    })

    const form = document.createElement('form')
    const host = document.createElement('openleaf-editor')
    host.setAttribute('aria-label', 'Guarded')
    host.setAttribute('for', 'guarded-body')
    host.setAttribute('toolbar', 'bold brokenItem')
    const area = document.createElement('textarea')
    area.id = 'guarded-body'
    area.hidden = true
    area.value = '<p>seed</p>'
    form.append(host, area)
    document.body.appendChild(form)
  })
  await expect(page.getByRole('textbox', { name: 'Guarded' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(page.getByRole('textbox', { name: 'Post body' })).toBeVisible()
})

test.describe('a plugin that throws', () => {
  test('does not stop the document reaching the textarea', async ({ page }) => {
    await installBrokenPlugin(page)

    const editor = page.getByRole('textbox', { name: 'Guarded' })
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' typed after the plugin broke')

    // The whole point: persistence must not depend on chrome rendering.
    await expect
      .poll(() => page.locator('#guarded-body').inputValue())
      .toContain('typed after the plugin broke')
  })

  test('does not stop the change event firing', async ({ page }) => {
    await installBrokenPlugin(page)
    await page.evaluate(() => {
      ;(window as never as { __changes: number }).__changes = 0
      document
        .querySelector('openleaf-editor[aria-label="Guarded"]')!
        .addEventListener('openleaf:change', () => {
          ;(window as never as { __changes: number }).__changes += 1
        })
    })

    await page.getByRole('textbox', { name: 'Guarded' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('abc')

    // An autosave listening here must keep receiving events.
    await expect
      .poll(() => page.evaluate(() => (window as never as { __changes: number }).__changes))
      .toBeGreaterThan(0)
  })

  test('does not take down the editor it is installed in', async ({ page }) => {
    await installBrokenPlugin(page)
    const editor = page.getByRole('textbox', { name: 'Guarded' })
    await editor.click()
    await page.keyboard.type('still editable')
    await expect(editor).toContainText('still editable')
  })

  test('does not affect a different editor on the same page', async ({ page }) => {
    await installBrokenPlugin(page)

    const untouched = page.getByRole('textbox', { name: 'Post body' })
    await untouched.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' unaffected')
    await expect.poll(() => page.locator('#body').inputValue()).toContain('unaffected')
  })

  test('reports the failing control as unavailable rather than inviting a click', async ({
    page,
  }) => {
    await installBrokenPlugin(page)
    // A predicate that cannot be computed should read as unavailable. Defaulting
    // to enabled would invite a click straight into the code path that threw.
    const broken = page
      .getByRole('toolbar', { name: 'Formatting' })
      .last()
      .getByRole('button', { name: 'Broken' })
    await expect(broken).toHaveAttribute('aria-disabled', 'true')
  })

  test('leaves the other controls in that toolbar working', async ({ page }) => {
    await installBrokenPlugin(page)
    const editor = page.getByRole('textbox', { name: 'Guarded' })
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')

    const toolbar = page.getByRole('toolbar', { name: 'Formatting' }).last()
    await toolbar.getByRole('button', { name: 'Bold' }).click()
    await expect.poll(() => page.locator('#guarded-body').inputValue()).toContain('<strong>')
  })
})
