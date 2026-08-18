import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const host = (page: Page) => page.locator('openleaf-editor')

/** Resolved value of a token on the editor element. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.querySelector('openleaf-editor')!).getPropertyValue(n).trim(),
    name,
  )
}

/** Rendered colour of the first toolbar button, which reads the tokens. */
function buttonColour(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('.ol-btn')!).color,
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test.describe('the token API', () => {
  test('an inline custom property changes the rendered control', async ({ page }) => {
    const before = await page.locator('.ol-btn').first().evaluate(
      (el) => Math.round(el.getBoundingClientRect().height),
    )
    await host(page).evaluate((el) => el.style.setProperty('--openleaf-button-size', '44px'))
    const after = await page.locator('.ol-btn').first().evaluate(
      (el) => Math.round(el.getBoundingClientRect().height),
    )
    expect(before).not.toBe(44)
    expect(after).toBe(44)
  })

  test('the content area still inherits the host page typography', async ({ page }) => {
    // The reason this project does not use Shadow DOM: editing should look like
    // the site it will be published on.
    await page.evaluate(() => {
      document.body.style.fontFamily = 'Georgia, serif'
    })
    const family = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ProseMirror')!).fontFamily,
    )
    expect(family).toContain('Georgia')
  })
})

test.describe('skins', () => {
  test('applying one changes the palette', async ({ page }) => {
    const before = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await expect(host(page)).toHaveAttribute('data-ol-skin', 'midnight')
    expect(await buttonColour(page)).not.toBe(before)
  })

  test('switching at runtime does not rebuild the editor', async ({ page }) => {
    // A colour change must not cost the author their undo history.
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' typed before the skin change')

    await host(page).evaluate((el) => el.setAttribute('skin', 'paper'))
    await page.keyboard.press('ControlOrMeta+z')

    await expect(editor(page)).not.toContainText('typed before the skin change')
  })

  test('a density skin changes size without touching colour', async ({ page }) => {
    const colour = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('skin', 'compact'))
    expect(await token(page, '--openleaf-button-size')).toBe('28px')
    expect(await buttonColour(page)).toBe(colour)
  })

  test('the compact skin still clears the WCAG minimum target size', async ({ page }) => {
    // SC 2.5.8 asks for 24 CSS px. "Compact" is not a licence to go under it.
    await host(page).evaluate((el) => el.setAttribute('skin', 'compact'))
    const size = await page.locator('.ol-btn').first().evaluate(
      (el) => Math.round(el.getBoundingClientRect().height),
    )
    expect(size).toBeGreaterThanOrEqual(24)
  })

  test('the high-contrast skin thickens the focus ring, not just its colour', async ({ page }) => {
    // Colour alone is what fails first for somebody who needs this skin.
    await host(page).evaluate((el) => el.setAttribute('skin', 'contrast'))
    expect(await token(page, '--openleaf-focus-width')).toBe('3px')
  })

  test('removing the attribute restores the default appearance', async ({ page }) => {
    const before = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await host(page).evaluate((el) => el.removeAttribute('skin'))
    expect(await buttonColour(page)).toBe(before)
  })

  test('an unknown skin warns and leaves the editor alone', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text())
    })
    const before = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('skin', 'nonexistent'))
    await expect.poll(() => warnings.join('\n')).toContain('no skin named')
    expect(await buttonColour(page)).toBe(before)
  })

  test('a custom skin can be registered at runtime', async ({ page }) => {
    await page.evaluate(() => {
      const ui = (window as never as {
        OpenLeaf: { __runtime: Record<string, { registerSkin: (s: unknown) => void }> }
      }).OpenLeaf.__runtime['@openleaf/ui']!
      ui.registerSkin({
        name: 'acme',
        label: 'Acme',
        tokens: '--openleaf-color-text: rgb(1, 2, 3);',
      })
    })
    await host(page).evaluate((el) => el.setAttribute('skin', 'acme'))
    expect(await buttonColour(page)).toBe('rgb(1, 2, 3)')
  })
})

test.describe('colour scheme', () => {
  test('theme="dark" forces dark regardless of the system setting', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('theme', 'dark'))
    await expect(host(page)).toHaveAttribute('data-ol-theme', 'dark')
    expect(await buttonColour(page)).not.toBe(light)
  })

  test('theme="light" holds under a dark system setting', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('theme', 'light'))
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await buttonColour(page)).toBe(light)
  })

  test('theme="auto" follows the system again', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    const light = await buttonColour(page)
    await host(page).evaluate((el) => el.setAttribute('theme', 'auto'))
    await expect(host(page)).not.toHaveAttribute('data-ol-theme', /.*/)
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await buttonColour(page)).not.toBe(light)
  })
})
