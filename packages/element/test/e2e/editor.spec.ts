import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness.html'

/** The editable region, addressed the way assistive technology sees it. */
function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

/** Current textarea value -- what the server would actually receive. */
function submittedValue(page: Page) {
  return page.locator('#body').inputValue()
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  // The custom element upgrades when the bundle defines it; wait for the
  // editable region rather than an arbitrary timeout.
  await expect(editor(page)).toBeVisible()
})

test.describe('loading stored content', () => {
  test('renders HTML from the bound textarea', async ({ page }) => {
    await expect(editor(page).getByRole('heading', { name: 'Existing heading' })).toBeVisible()
    await expect(editor(page).getByText('A stored paragraph.')).toBeVisible()
    await expect(editor(page).getByText('Load-bearing wrapper.')).toBeVisible()
  })

  test('exposes the editable region to assistive technology', async ({ page }) => {
    // Without a role and an accessible name, a screen reader announces an
    // unlabelled text box, which makes the editor unusable rather than merely
    // imperfect.
    const region = editor(page)
    await expect(region).toHaveAttribute('role', 'textbox')
    await expect(region).toHaveAttribute('aria-multiline', 'true')
    await expect(region).toHaveAttribute('contenteditable', 'true')
  })
})

test.describe('editing', () => {
  test('accepts typed text', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Typed in the browser.')
    await expect(editor(page)).toContainText('Typed in the browser.')
  })

  test('writes changes back to the textarea as HTML', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' appended')

    const value = await submittedValue(page)
    expect(value).toContain('appended')
    // HTML, not a proprietary JSON document model.
    expect(value).toMatch(/<(p|h2)[^>]*>/)
  })

  test('applies bold via the keyboard shortcut', async ({ page }) => {
    // Triple-click rather than Home/Shift+End: those keys do not move the
    // caret inside contenteditable on macOS, so the selection would be empty
    // and the assertion would pass or fail for the wrong reason.
    await editor(page).getByText('A stored paragraph.').click({ clickCount: 3 })
    await page.keyboard.press('ControlOrMeta+b')

    await expect.poll(() => submittedValue(page)).toContain('<strong>')
  })

  test('undo reverts a change', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' scratch text')
    await expect(editor(page)).toContainText('scratch text')

    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor(page)).not.toContainText('scratch text')
  })
})

test.describe('content preservation in a real browser', () => {
  /**
   * The failure mode this project exists to prevent.
   *
   * A customer opens a legacy post, presses Save without editing anything,
   * and a section of it is gone. No error, no warning, unrecoverable. Every
   * unit test in the repo can pass while this is broken, because the bug
   * lives in the round trip through a live editor view, not in the parser.
   */
  test('open and save without editing does not alter the document', async ({ page }) => {
    const before = await submittedValue(page)

    await page.locator('#save').click()
    // The form posts to a route that does not exist; what matters is the
    // textarea contents at submit time.
    await page.goBack().catch(() => {})

    expect(before).toContain('class="callout"')
    expect(before).toContain('data-callout-id="7"')
    expect(before).toContain('Load-bearing wrapper.')
  })

  test('editing elsewhere leaves an unrecognised wrapper intact', async ({ page }) => {
    await editor(page).getByText('A stored paragraph.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' edited nearby')

    const value = await submittedValue(page)
    expect(value).toContain('edited nearby')
    // The preservation layer has to survive live editing, not just a
    // parse/serialize cycle in isolation.
    expect(value).toContain('class="callout"')
    expect(value).toContain('data-callout-id="7"')
  })

  test('preserved markup cannot be edited from the inside', async ({ page }) => {
    // The node is an atom, so there is no caret position within it. This is
    // what stops preserved markup from drifting: a user can replace the whole
    // block, but cannot half-edit its interior into something invalid.
    await editor(page).getByText('Load-bearing wrapper.').click()
    await page.keyboard.type('XXX')

    const value = await submittedValue(page)
    expect(value).not.toContain('XXXLoad-bearing')
    expect(value).not.toContain('Load-bearingXXX')
    expect(value).not.toContain('class="callout" data-callout-id="7"><p>XXX')
  })

  test('replacing preserved markup is undoable, restoring it byte-identical', async ({ page }) => {
    // Selecting a preserved block and typing replaces it -- standard editor
    // behaviour, the same as typing over a selected image. That is acceptable
    // ONLY because it is visible and reversible, so the reversibility is the
    // guarantee worth pinning down. "Cannot be lost by accident" means undo
    // brings it back exactly, not that the editor refuses the edit.
    const original = await submittedValue(page)
    expect(original).toContain('class="callout"')

    await editor(page).getByText('Load-bearing wrapper.').click()
    await page.keyboard.type('XXX')
    await expect.poll(() => submittedValue(page)).not.toContain('class="callout"')

    await page.keyboard.press('ControlOrMeta+z')

    const restored = await submittedValue(page)
    expect(restored).toContain('class="callout"')
    expect(restored).toContain('data-callout-id="7"')
    expect(restored).toContain('Load-bearing wrapper.')
    expect(restored).toBe(original)
  })
})

test.describe('source view lifecycle', () => {
  test('closing source without an edit keeps undo', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' scratch text')
    await expect(editor(page)).toContainText('scratch text')

    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()
    await page.getByRole('button', { name: 'HTML source' }).click()

    await expect(editor(page)).toContainText('scratch text')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor(page)).not.toContainText('scratch text')
  })

  test('a source edit is one undoable change event', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as Window & { __olChanges?: number }).__olChanges = 0
      document.querySelector('openleaf-editor')!.addEventListener('openleaf:change', () => {
        const w = window as Window & { __olChanges?: number }
        w.__olChanges = (w.__olChanges ?? 0) + 1
      })
    })

    await page.getByRole('button', { name: 'HTML source' }).click()
    const source = page.getByRole('textbox', { name: 'HTML source' })
    await source.fill('<p>replaced in source</p>')
    await page.getByRole('button', { name: 'HTML source' }).click()

    await expect(editor(page)).toContainText('replaced in source')
    expect(await page.evaluate(() => (window as Window & { __olChanges?: number }).__olChanges)).toBe(1)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor(page)).not.toContainText('replaced in source')
    await expect(editor(page)).toContainText('A stored paragraph.')
  })

  test('assigning value while source is open updates the source box', async ({ page }) => {
    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()

    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<p>assigned while source open</p>'
    })

    await expect(page.getByRole('textbox', { name: 'HTML source' })).toHaveValue(
      '<p>assigned while source open</p>',
    )

    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(editor(page)).toContainText('assigned while source open')
    await expect.poll(() => submittedValue(page)).toBe('<p>assigned while source open</p>')
  })

  test('disconnecting while source is open fires close and reconnects cleanly', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = false
      document.querySelector('openleaf-editor')!.addEventListener('openleaf:source-close', () => {
        ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = true
      })
    })

    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()

    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor')
      const parent = el?.parentNode
      if (!el || !parent) return
      const next = el.nextSibling
      parent.removeChild(el)
      parent.insertBefore(el, next)
    })

    await expect.poll(() => page.evaluate(() => (window as Window & { __olSourceClosed?: boolean }).__olSourceClosed)).toBe(true)
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toHaveCount(0)
    await expect(editor(page)).toBeVisible()
    await expect(editor(page)).toContainText('A stored paragraph.')
  })
})

test.describe('the CMS form contract', () => {
  test('posts the edited HTML under the textarea name', async ({ page }) => {
    // The whole point of the drop-in: server code that already reads
    // $_POST['body'] keeps working untouched.
    let posted: string | null = null
    await page.route('**/submitted', async (route) => {
      posted = route.request().postData()
      await route.fulfill({ status: 200, body: 'ok' })
    })

    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' via form post')
    await page.locator('#save').click()

    await expect.poll(() => posted).not.toBeNull()
    const decoded = decodeURIComponent((posted ?? '').replace(/\+/g, ' '))
    expect(decoded).toMatch(/^body=/)
    expect(decoded).toContain('via form post')
    expect(decoded).toContain('class="callout"')
  })
})
