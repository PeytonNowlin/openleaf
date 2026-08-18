import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

function toolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Formatting' })
}

function button(page: Page, name: string) {
  return toolbar(page).getByRole('button', { name, exact: true })
}

/** The accessible name of whatever currently holds focus. */
function focusedName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    return el.getAttribute('aria-label') ?? el.tagName.toLowerCase()
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
  await expect(toolbar(page)).toBeVisible()
})

test.describe('structure and semantics', () => {
  test('is a labelled toolbar landmark', async ({ page }) => {
    await expect(toolbar(page)).toHaveAttribute('role', 'toolbar')
    await expect(toolbar(page)).toHaveAttribute('aria-label', 'Formatting')
  })

  test('renders real buttons, not clickable divs', async ({ page }) => {
    const count = await toolbar(page).locator('button').count()
    expect(count).toBeGreaterThan(10)
    // Every control is a <button type="button"> so it never submits the host form.
    const types = await toolbar(page).locator('button').evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).type),
    )
    expect(new Set(types)).toEqual(new Set(['button']))
  })

  test('gives toggles aria-pressed and actions none', async ({ page }) => {
    await expect(button(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
    // Marking Undo as "pressed" would be meaningless and screen readers say so.
    expect(await button(page, 'Undo').getAttribute('aria-pressed')).toBeNull()
  })

  test('labels the block-type select independently of the toolbar', async ({ page }) => {
    // The toolbar's own label does not describe this control.
    await expect(page.getByRole('combobox', { name: 'Paragraph style' })).toBeVisible()
  })

  test('hides decorative icons from assistive technology', async ({ page }) => {
    const hidden = await toolbar(page).locator('svg').evaluateAll((els) =>
      els.every((el) => el.getAttribute('aria-hidden') === 'true'),
    )
    expect(hidden).toBe(true)
  })
})

test.describe('applying formatting', () => {
  test('bold button formats the selection', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await button(page, 'Bold').click()
    await expect.poll(() => page.locator('#body').inputValue()).toContain('<strong>')
  })

  test('clicking a button does not steal focus from the content', async ({ page }) => {
    // Without preventDefault on mousedown the editor blurs, the selection
    // collapses, and the command applies to nothing.
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await button(page, 'Bold').click()
    expect(await focusedName(page)).toBe('Post body')
  })

  test('aria-pressed reflects the cursor position', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await button(page, 'Bold').click()
    await expect(button(page, 'Bold')).toHaveAttribute('aria-pressed', 'true')

    // Move out of the bolded run; the button must un-press.
    await editor(page).getByRole('heading', { name: 'Existing heading' }).click()
    await expect(button(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
  })

  test('the block-type select reflects and sets the heading level', async ({ page }) => {
    const select = page.getByRole('combobox', { name: 'Paragraph style' })

    await editor(page).getByRole('heading', { name: 'Existing heading' }).click()
    await expect(select).toHaveValue('2')

    await editor(page).getByText('A stored paragraph.').click()
    await expect(select).toHaveValue('p')

    await select.selectOption('3')
    await expect.poll(() => page.locator('#body').inputValue()).toContain('<h3>')
  })

  test('list buttons show as pressed inside a list', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click()
    await button(page, 'Bulleted list').click()
    await expect(button(page, 'Bulleted list')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.locator('#body').inputValue()).toContain('<ul>')
  })

  test('disables the link button without a selection, using aria-disabled', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click()
    // aria-disabled, never the disabled attribute: a disabled button drops out
    // of the roving tabindex and becomes undiscoverable.
    await expect(button(page, 'Link')).toHaveAttribute('aria-disabled', 'true')
    expect(await button(page, 'Link').evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(
      false,
    )

    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await expect(button(page, 'Link')).toHaveAttribute('aria-disabled', 'false')
  })

  test('editing a new-window link keeps target and rel', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<p><a href="https://example.org" target="_blank" rel="noopener noreferrer">linked</a></p>'
    })

    await editor(page).getByRole('link', { name: 'linked' }).click({ clickCount: 3 })
    await button(page, 'Link').click()

    const checkbox = page.getByRole('checkbox', { name: 'Open in a new window' })
    await expect(checkbox).toBeChecked()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => page.locator('#body').inputValue()).toMatch(
      /<a href="https:\/\/example\.org" target="_blank" rel="noopener noreferrer">linked<\/a>/,
    )
  })
})

test.describe('the keyboard model', () => {
  test('the whole toolbar is a single tab stop', async ({ page }) => {
    // Without a roving tabindex, Tab from the content walks a keyboard user
    // through twenty buttons before they reach anything else.
    const tabbable = await toolbar(page).locator('button').evaluateAll((els) =>
      els.filter((el) => (el as HTMLButtonElement).tabIndex === 0).length,
    )
    expect(tabbable).toBe(1)
  })

  test('Alt+F10 moves focus into the toolbar', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('Alt+F10')
    expect(await focusedName(page)).toBe('Undo')
  })

  test('arrow keys move between buttons', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('Alt+F10')
    await page.keyboard.press('ArrowRight')
    expect(await focusedName(page)).toBe('Redo')
    await page.keyboard.press('ArrowLeft')
    expect(await focusedName(page)).toBe('Undo')
  })

  test('arrow keys wrap at the ends', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('Alt+F10')
    await page.keyboard.press('ArrowLeft')
    expect(await focusedName(page)).toBe('HTML source')
  })

  test('Home and End jump to the first and last button', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('Alt+F10')
    await page.keyboard.press('End')
    expect(await focusedName(page)).toBe('HTML source')
    await page.keyboard.press('Home')
    expect(await focusedName(page)).toBe('Undo')
  })

  test('Escape returns focus to the content', async ({ page }) => {
    // The single biggest hole in the original plan: once a screen reader user
    // enters the toolbar, without this their only way out is blind-Tabbing
    // through the rest of the host page's form.
    await editor(page).click()
    await page.keyboard.press('Alt+F10')
    expect(await focusedName(page)).toBe('Undo')
    await page.keyboard.press('Escape')
    expect(await focusedName(page)).toBe('Post body')
  })

  test('Enter activates the focused button', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await page.keyboard.press('Alt+F10')
    await button(page, 'Bold').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('#body').inputValue()).toContain('<strong>')
  })

  test('the select owns its own arrow keys rather than the roving handler', async ({ page }) => {
    // The conflict this resolves: on the select, Left/Right have two competing
    // owners. Intercepting them for roving would break value changing; not
    // intercepting them would break the toolbar contract. The select is
    // therefore its own tab stop and keeps its native key handling.
    const select = page.getByRole('combobox', { name: 'Paragraph style' })
    expect(await select.evaluate((el) => (el as HTMLSelectElement).tabIndex)).toBe(0)

    await editor(page).getByText('A stored paragraph.').click()
    await select.focus()
    await page.keyboard.press('ArrowRight')
    // Focus must still be on the select, not moved along the toolbar.
    expect(await focusedName(page)).toBe('Paragraph style')
  })
})

test.describe('announcements', () => {
  test('announces a formatting change made by keyboard shortcut', async ({ page }) => {
    // The case the original plan missed entirely: Ctrl+B typed in the content
    // happens with no cursor, real or virtual, anywhere near the Bold button.
    // Without this, nothing observes the state change.
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await page.keyboard.press('ControlOrMeta+b')

    const live = page.locator('.ol-live[role="status"]')
    await expect.poll(() => live.textContent(), { timeout: 3000 }).toContain('Bold on')
  })

  test('announces turning a mark off', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await page.keyboard.press('ControlOrMeta+b')
    const live = page.locator('.ol-live[role="status"]')
    await expect.poll(() => live.textContent(), { timeout: 3000 }).toContain('Bold on')

    await page.keyboard.press('ControlOrMeta+b')
    await expect.poll(() => live.textContent(), { timeout: 3000 }).toContain('Bold off')
  })

  test('stays silent when only the cursor moved', async ({ page }) => {
    // This gate is the whole difference between a useful announcement and a
    // chatty one: moving through already-bold text must say nothing.
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await page.keyboard.press('ControlOrMeta+b')
    const live = page.locator('.ol-live[role="status"]')
    await expect.poll(() => live.textContent(), { timeout: 3000 }).toContain('Bold on')

    await page.evaluate(() => {
      const region = document.querySelector('.ol-live[role="status"]')
      if (region) region.textContent = 'SENTINEL'
    })

    await editor(page).getByRole('heading', { name: 'Existing heading' }).click()
    await page.waitForTimeout(300)
    expect(await live.textContent()).toBe('SENTINEL')
  })

  test('tells the author how to reach the toolbar', async ({ page }) => {
    const describedBy = await editor(page).getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const hint = page.locator(`#${describedBy}`)
    await expect(hint).toHaveText(/Alt plus F10/)
  })
})

test.describe('source view', () => {
  test('shows the HTML and comes back with it applied', async ({ page }) => {
    await button(page, 'HTML source').click()

    const source = page.getByRole('textbox', { name: 'HTML source' })
    await expect(source).toBeVisible()
    await expect(source).toHaveValue(/<h2>Existing heading<\/h2>/)
    // Focus moves into the control that is now live rather than being stranded
    // on the button that caused the switch.
    expect(await focusedName(page)).toBe('HTML source')
    await expect(button(page, 'HTML source')).toHaveAttribute('aria-pressed', 'true')

    await source.fill('<p>Replaced by hand.</p>')
    await button(page, 'HTML source').click()

    await expect(editor(page)).toContainText('Replaced by hand.')
    await expect(button(page, 'HTML source')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => page.locator('#body').inputValue()).toBe('<p>Replaced by hand.</p>')
  })
})

test.describe('integrator configuration', () => {
  test('honours a restricted toolbar attribute', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('openleaf-editor')
      host.setAttribute('aria-label', 'Comment')
      host.setAttribute('toolbar', 'bold italic | link')
      document.body.appendChild(host)
    })

    const restricted = page.getByRole('toolbar').last()
    await expect(restricted.getByRole('button', { name: 'Bold' })).toBeVisible()
    await expect(restricted.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    await expect(restricted.locator('button')).toHaveCount(3)
  })

  test('omits the toolbar entirely with toolbar="none"', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement('openleaf-editor')
      host.setAttribute('aria-label', 'Bare')
      host.setAttribute('toolbar', 'none')
      document.body.appendChild(host)
    })
    await expect(page.getByRole('textbox', { name: 'Bare' })).toBeVisible()
    // Still exactly one toolbar on the page -- the harness's own.
    await expect(page.getByRole('toolbar')).toHaveCount(1)
  })
})

test.describe('styling delivery', () => {
  test('uses the CSP-safe constructable stylesheet path', async ({ page }) => {
    // A <style> injection would be blocked by `style-src 'self'`, which is what
    // the government and enterprise integrators this project targets run.
    const adopted = await page.evaluate(() => document.adoptedStyleSheets.length)
    expect(adopted).toBeGreaterThan(0)
    const injected = await page.locator('style#ol-styles').count()
    expect(injected).toBe(0)
  })

  test('actually applies the styles', async ({ page }) => {
    const height = await button(page, 'Bold').evaluate(
      (el) => Math.round(el.getBoundingClientRect().height),
    )
    // 32px default, comfortably over the 24x24 WCAG 2.2 SC 2.5.8 minimum.
    expect(height).toBeGreaterThanOrEqual(24)
  })

  test('respects a themed custom property', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--openleaf-button-size', '48px')
    })
    const height = await button(page, 'Bold').evaluate(
      (el) => Math.round(el.getBoundingClientRect().height),
    )
    expect(height).toBe(48)
  })
})
