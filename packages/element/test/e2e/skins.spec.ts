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
      }).OpenLeaf.__runtime['@openleaf-editor/ui']!
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

test.describe('the scheme a skin declares', () => {
  /*
   * A skin replaces the palette outright, so it is unmoved by the system
   * setting -- but the things a custom property cannot reach kept following the
   * system anyway: the syntax palette in the highlighting bundle, and every
   * native widget the browser paints from `color-scheme` rather than from CSS.
   * `data-ol-scheme` is how a skin says which world those belong to.
   */
  const scheme = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.querySelector('.ol-editor')!).colorScheme)

  test('a colour skin publishes it as an attribute stylesheets can branch on', async ({ page }) => {
    await host(page).evaluate((el) => el.setAttribute('skin', 'paper'))
    await expect(host(page)).toHaveAttribute('data-ol-scheme', 'light')
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await expect(host(page)).toHaveAttribute('data-ol-scheme', 'dark')
  })

  test('a density skin declares none and leaves the scheme alone', async ({ page }) => {
    await host(page).evaluate((el) => el.setAttribute('skin', 'compact'))
    await expect(host(page)).not.toHaveAttribute('data-ol-scheme', /.*/)
  })

  test('removing the skin removes it too', async ({ page }) => {
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await host(page).evaluate((el) => el.removeAttribute('skin'))
    await expect(host(page)).not.toHaveAttribute('data-ol-scheme', /.*/)
  })

  test('native widgets follow the skin, not the system', async ({ page }) => {
    // The block-type control is a real <select>; its popup is painted by the OS
    // from color-scheme, and nothing an integrator can set in a token reaches it.
    await page.emulateMedia({ colorScheme: 'dark' })
    await host(page).evaluate((el) => el.setAttribute('skin', 'paper'))
    expect(await scheme(page)).toBe('light')

    await page.emulateMedia({ colorScheme: 'light' })
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    expect(await scheme(page)).toBe('dark')
  })

  test('it outranks theme, which cannot move the skin\'s surface anyway', async ({ page }) => {
    await host(page).evaluate((el) => {
      el.setAttribute('skin', 'paper')
      el.setAttribute('theme', 'dark')
    })
    expect(await scheme(page)).toBe('light')
    // The surface is the skin's either way -- the token wins on its own. What
    // this stops is the theme moving only the parts a token cannot reach.
    const surface = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ol-content')!).backgroundColor,
    )
    expect(surface).toBe('rgb(251, 247, 240)')
  })

  test('a light skin does not take dark fallbacks for what it left unset', async ({ page }) => {
    // A partial skin -- surface only. Under a dark system the remaining tokens
    // used to fall back to the dark palette: dark-mode muted text on cream.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => {
      const ui = (window as never as {
        OpenLeaf: { __runtime: Record<string, { registerSkin: (s: unknown) => void }> }
      }).OpenLeaf.__runtime['@openleaf-editor/ui']!
      ui.registerSkin({
        name: 'partial',
        label: 'Partial',
        scheme: 'light',
        tokens: '--openleaf-color-surface: #fbf7f0;',
      })
    })
    await host(page).evaluate((el) => el.setAttribute('skin', 'partial'))
    expect(await buttonColour(page)).toBe('rgb(31, 35, 40)')
  })

  test('a surface skin with no scheme is warned about, not silently accepted', async ({ page }) => {
    // It only looks wrong on a machine set to the opposite mode, which is rarely
    // the machine the skin was written on.
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text())
    })
    await page.evaluate(() => {
      const ui = (window as never as {
        OpenLeaf: { __runtime: Record<string, { registerSkin: (s: unknown) => void }> }
      }).OpenLeaf.__runtime['@openleaf-editor/ui']!
      ui.registerSkin({
        name: 'forgetful',
        label: 'Forgetful',
        tokens: '--openleaf-color-surface: #101418; --openleaf-color-text: #e8eef4;',
      })
      // An accent-only brand skin is not the same thing and must stay quiet.
      ui.registerSkin({
        name: 'brand-only',
        label: 'Brand only',
        tokens: '--openleaf-color-accent: #c2185b;',
      })
    })
    await expect.poll(() => warnings.join('\n')).toContain('"forgetful"')
    expect(warnings.join('\n')).not.toContain('brand-only')
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
