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

  // The count is a live region, and rebuilding the matches after a replace
  // finds none of the ones just replaced -- which reported a successful
  // Replace all as "No matches".
  test('reports how many were replaced', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Find and replace' }).click()
    const find = page.getByRole('search', { name: 'Find and replace' })
    await find.getByRole('searchbox').fill('alpha')
    await find.getByRole('textbox', { name: 'Replace' }).fill('uno')
    await find.getByRole('button', { name: 'Replace all' }).click()
    await expect(find.getByRole('status')).toHaveText('2 replaced')
  })

  // Replace acted on `matches[-1]` and gave up before dispatching, on a button
  // that stayed enabled and reported nothing back.
  test('replaces without Next having been pressed first', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Find and replace' }).click()
    const find = page.getByRole('search', { name: 'Find and replace' })
    await find.getByRole('searchbox').fill('alpha')
    await find.getByRole('textbox', { name: 'Replace' }).fill('uno')
    await expect(find.getByRole('button', { name: 'Replace', exact: true })).toBeEnabled()
    await find.getByRole('button', { name: 'Replace', exact: true }).click()
    await expect.poll(() => value(page)).toContain('uno beta alpha')
  })

  test('disables the buttons when nothing matches', async ({ page }) => {
    await toolbar(page).getByRole('button', { name: 'Find and replace' }).click()
    const find = page.getByRole('search', { name: 'Find and replace' })
    await find.getByRole('searchbox').fill('nothinghere')
    await expect(find.getByRole('status')).toHaveText('No matches')
    await expect(find.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled()
    await expect(find.getByRole('button', { name: 'Replace all' })).toBeDisabled()
    await expect(find.getByRole('button', { name: 'Next' })).toBeDisabled()
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

  // The source box is a plain textarea: typing in it dispatches no ProseMirror
  // transaction, so nothing on the plugin view's update path would ever notice.
  // Left unwatched, an author who edits the source and closes the tab loses it.
  test('autosaves edits made in the HTML source box', async ({ page }) => {
    const key = 'openleaf:draft:v1:/packages/element/test/e2e/harness-session.html#body'
    const draft = () => page.evaluate((k) => localStorage.getItem(k), key)

    // Dirty the document the ordinary way first, so there is a draft on record
    // and the autosave path is known to be working before source mode is opened.
    await editor(page).click()
    await page.keyboard.type('delta')
    await expect.poll(draft, { timeout: 5000 }).toContain('delta')

    await toolbar(page).getByRole('button', { name: 'HTML source' }).click()
    const source = page.getByRole('textbox', { name: 'HTML source' })
    await expect(source).toBeVisible()
    // Drain the debounce that opening the view armed. Typing while that timer is
    // still pending would get the edit autosaved by it -- reading the textarea
    // through host.value -- whether or not anything is watching the textarea,
    // which would make this test pass without the behaviour under test.
    await page.waitForTimeout(1500)

    await source.fill('<p>typed into the source</p>')
    await expect.poll(draft, { timeout: 5000 }).toContain('typed into the source')
  })

  // Registering another opt-in plugin reconfigures the editor state, and
  // ProseMirror destroys and recreates every plugin view when it does. The record
  // of what was last saved has to outlive that: a fresh one read off the current
  // document would adopt the author's unsaved edits as saved, then clear the
  // recovery draft written on the way out and stop warning about them.
  test('keeps unsaved changes unsaved when another plugin registers', async ({ page }) => {
    const key = 'openleaf:draft:v1:/packages/element/test/e2e/harness-session.html#body'
    const draft = () => page.evaluate((k) => localStorage.getItem(k), key)

    await editor(page).click()
    await page.keyboard.type('delta')
    await expect.poll(draft, { timeout: 5000 }).toContain('delta')

    await page.evaluate(() => {
      const host = globalThis as unknown as {
        OpenLeaf: { __runtime: Record<string, { registerEditorPlugin: (f: () => []) => void }> }
      }
      host.OpenLeaf.__runtime['@openleaf-editor/core']!.registerEditorPlugin(() => [])
    })

    // A debounce later, so the recreated view has had its chance to decide the
    // document matches what was saved and throw the draft away.
    await page.waitForTimeout(1500)
    expect(await draft()).toContain('delta')
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
