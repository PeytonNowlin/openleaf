import { expect, test, type Page } from '@playwright/test'

const PLAIN = '/packages/element/test/e2e/harness.html'
const HIGHLIGHTED = '/packages/element/test/e2e/harness-highlight.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const value = (page: Page) => page.locator('#body').inputValue()

test.describe('without the highlighting bundle', () => {
  test('code blocks still round-trip their language', async ({ page }) => {
    await page.goto(PLAIN)
    await expect(editor(page)).toBeVisible()
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<pre><code class="language-js">const x = 1</code></pre>'
    })
    // The language attribute is core, not the plugin: it is content, and losing
    // it on save would be an attribute-loss bug regardless of highlighting.
    await expect.poll(() => value(page)).toContain('class="language-js"')
  })
})

test.describe('code block highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HIGHLIGHTED)
    await expect(editor(page)).toBeVisible()
  })

  test('colours a JavaScript block', async ({ page }) => {
    const block = editor(page).locator('pre').first()
    await expect(block.locator('.ol-t-keyword').first()).toBeVisible()
    await expect(block.locator('.ol-t-string').first()).toBeVisible()
    await expect(block.locator('.ol-t-comment').first()).toBeVisible()
  })

  test('colours a CSS block with CSS rules, not JavaScript ones', async ({ page }) => {
    const css = editor(page).locator('pre').nth(1)
    await expect(css.locator('.ol-t-property').first()).toBeVisible()
    await expect(css.locator('.ol-t-selector').first()).toBeVisible()
  })

  test('leaves a block with no language alone', async ({ page }) => {
    const plain = editor(page).locator('pre').nth(2)
    await expect(plain.locator('[class*="ol-t-"]')).toHaveCount(0)
  })

  test('does not change the stored document', async ({ page }) => {
    // Decorations, not node views: highlighting is rendering and must never
    // reach what is saved.
    const stored = await value(page)
    expect(stored).not.toContain('ol-t-')
    expect(stored).not.toContain('<span')
    expect(stored).toContain('class="language-js"')
  })

  test('keeps highlighting as the author types', async ({ page }) => {
    const block = editor(page).locator('pre').first()
    await block.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' const added = 2')
    await expect.poll(() => block.locator('.ol-t-keyword').count()).toBeGreaterThan(1)
    await expect.poll(() => value(page)).toContain('const added = 2')
  })
})

test.describe('the source view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HIGHLIGHTED)
    await expect(editor(page)).toBeVisible()
    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()
  })

  test('formats the HTML onto multiple lines', async ({ page }) => {
    // The editor serializes to one long line, which is correct output and
    // unreadable source.
    const source = await page.getByRole('textbox', { name: 'HTML source' }).inputValue()
    expect(source.split('\n').length).toBeGreaterThan(4)
    expect(source).toMatch(/^<h2>Report<\/h2>$/m)
  })

  test('highlights it behind the textarea', async ({ page }) => {
    const backdrop = page.locator('.ol-src-view')
    await expect(backdrop).toHaveCount(1)
    await expect(backdrop.locator('.ol-t-tag').first()).toBeVisible()
    await expect(backdrop.locator('.ol-t-attr-name').first()).toBeVisible()
  })

  test('hides the backdrop from assistive technology', async ({ page }) => {
    // The textarea already carries the content and the accessible name; a second
    // copy would be read out twice.
    await expect(page.locator('.ol-src-view')).toHaveAttribute('aria-hidden', 'true')
  })

  test('keeps the backdrop in step as the author types', async ({ page }) => {
    const source = page.getByRole('textbox', { name: 'HTML source' })
    await source.click()
    await source.press('End')
    await source.pressSequentially('<p>typed</p>')
    await expect.poll(() => page.locator('.ol-src-view').textContent()).toContain('typed')
  })

  test('formatting does not change the document', async ({ page }) => {
    // The whole safety property: indenting for display must parse identically.
    const before = await page.evaluate(
      () => (document.querySelector('openleaf-editor') as HTMLElement & { value: string }).value,
    )
    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect.poll(() => value(page)).toBe(before)
  })

  test('an edit made in source view is applied', async ({ page }) => {
    const source = page.getByRole('textbox', { name: 'HTML source' })
    await source.fill('<p>replaced by hand</p>')
    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(editor(page)).toContainText('replaced by hand')
    await expect.poll(() => value(page)).toBe('<p>replaced by hand</p>')
  })

  test('removes its overlay when the source view closes', async ({ page }) => {
    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.locator('.ol-src-view')).toHaveCount(0)
    await expect(page.locator('.ol-src')).toHaveCount(0)
  })
})
