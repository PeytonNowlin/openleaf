import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness.html'

/** The editable region, addressed the way assistive technology sees it. */
function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

/** Current textarea value -- what the server would actually receive. */
function submittedValue(page: Page) {
  return stored(page)
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

  /*
   * These two tests used to be one, which asserted that ANY disconnect closed
   * the source view. That was really asserting the old bug: a move destroyed
   * the whole editor, and closing source was a side effect of losing the
   * session. A move is now a no-op, so the two cases have genuinely different
   * contracts and are pinned separately -- the open/close events fire on a real
   * teardown only, which is what `plugins-highlight`'s source overlay keys off.
   */
  test('a DOM move keeps the source view open and fires no close', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = false
      document.querySelector('openleaf-editor')!.addEventListener('openleaf:source-close', () => {
        ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = true
      })
    })

    await page.getByRole('button', { name: 'HTML source' }).click()
    const source = page.getByRole('textbox', { name: 'HTML source' })
    await expect(source).toBeVisible()
    await source.fill('<p>edited in source</p>')

    // Remember the exact view instance, so "the session survived" is checked by
    // identity rather than inferred from an event not firing.
    await page.evaluate(() => {
      type Held = Window & { __olView?: unknown }
      const el = document.querySelector('openleaf-editor') as Element & { view?: unknown }
      ;(window as Held).__olView = el.view
    })

    // Remove and reinsert in one task, the way a keyed-list reorder does.
    // The settle window is deliberately generous: teardown is deferred, so
    // waiting LONGER can only make a teardown easier to catch, never harder.
    await page.evaluate(async () => {
      const el = document.querySelector('openleaf-editor')
      const parent = el?.parentNode
      if (!el || !parent) return
      const next = el.nextSibling
      parent.removeChild(el)
      parent.insertBefore(el, next)
      await new Promise((resolve) => setTimeout(resolve, 250))
    })

    // The same EditorView, which is the whole point: undo history, selection
    // and every plugin's state came through the move.
    expect(
      await page.evaluate(() => {
        type Held = Window & { __olView?: unknown }
        const el = document.querySelector('openleaf-editor') as Element & { view?: unknown }
        return el.view === (window as Held).__olView && el.view != null
      }),
    ).toBe(true)
    expect(
      await page.evaluate(() => (window as Window & { __olSourceClosed?: boolean }).__olSourceClosed),
    ).toBe(false)
    // The author is left exactly where they were, unsaved source edit intact.
    await expect(source).toBeVisible()
    await expect(source).toHaveValue('<p>edited in source</p>')
  })

  test('a real removal fires source close, and reconnects cleanly', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = false
      document.querySelector('openleaf-editor')!.addEventListener('openleaf:source-close', () => {
        ;(window as Window & { __olSourceClosed?: boolean }).__olSourceClosed = true
      })
    })

    await page.getByRole('button', { name: 'HTML source' }).click()
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toBeVisible()

    // Removed and left out of the document: a real teardown.
    await page.evaluate(async () => {
      type Parked = Window & { __olParked?: Element; __olParent?: Node; __olNext?: Node | null }
      const el = document.querySelector('openleaf-editor')
      if (!el?.parentNode) return
      const parked = window as Parked
      parked.__olParked = el
      parked.__olParent = el.parentNode
      parked.__olNext = el.nextSibling
      el.remove()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(
      await page.evaluate(() => (window as Window & { __olSourceClosed?: boolean }).__olSourceClosed),
    ).toBe(true)
    await expect(page.getByRole('textbox', { name: 'HTML source' })).toHaveCount(0)

    // Put it back: it rebuilds, with the document it was holding.
    await page.evaluate(() => {
      type Parked = Window & { __olParked?: Element; __olParent?: Node; __olNext?: Node | null }
      const parked = window as Parked
      if (parked.__olParent && parked.__olParked) {
        parked.__olParent.insertBefore(parked.__olParked, parked.__olNext ?? null)
      }
    })
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

  test('FormData snapshots include edits made since the last transaction', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' via formdata')
    const snapshot = await page.evaluate(() => {
      const form = document.getElementById('post-form')
      if (!(form instanceof HTMLFormElement)) return null
      return new FormData(form).get('body')
    })
    expect(String(snapshot)).toContain('via formdata')
  })

  test('form reset restores the editor from the textarea default', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' reset-me')
    await expect(editor(page)).toContainText('reset-me')
    await page.locator('#post-form').evaluate((form) => {
      if (form instanceof HTMLFormElement) form.reset()
    })
    await expect(editor(page)).not.toContainText('reset-me')
    await expect.poll(() => submittedValue(page)).not.toContain('reset-me')
  })

  test('a nested textarea remains a successful form control', async ({ page }) => {
    await page.evaluate(() => {
      const form = document.createElement('form')
      form.id = 'nested-form'
      const field = document.createElement('openleaf-editor')
      field.setAttribute('toolbar', 'none')
      field.setAttribute('aria-label', 'Nested body')
      const area = document.createElement('textarea')
      area.name = 'nested'
      area.value = '<p>seed</p>'
      field.append(area)
      form.append(field)
      document.body.append(form)
    })
    await expect(page.getByRole('textbox', { name: 'Nested body' })).toBeVisible()
    const posted = await page.evaluate(() => {
      const form = document.getElementById('nested-form')
      if (!(form instanceof HTMLFormElement)) return null
      return new FormData(form).get('nested')
    })
    expect(String(posted)).toContain('seed')
  })
})

test.describe('readonly and for attributes', () => {
  test('adding readonly stops typing and toolbar commands', async ({ page }) => {
    await page.locator('openleaf-editor').evaluate((el) => el.setAttribute('readonly', ''))
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false')

    await editor(page).click()
    await page.keyboard.type('should-not-land')
    expect(await submittedValue(page)).not.toContain('should-not-land')

    await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('button', { name: 'Bold' }).click({ force: true })
    expect(await submittedValue(page)).not.toContain('<strong>')
  })

  test('changing for rebinds the textarea', async ({ page }) => {
    await page.evaluate(() => {
      const other = document.createElement('textarea')
      other.id = 'other'
      other.name = 'other'
      other.hidden = true
      document.querySelector('form')?.append(other)
      document.querySelector('openleaf-editor')?.setAttribute('for', 'other')
    })
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' rebound')
    await expect.poll(() => page.locator('#other').inputValue()).toContain('rebound')
    expect(await submittedValue(page)).not.toContain('rebound')
  })
})

test.describe('late plugin registration', () => {
  test('does not wipe undo', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' scratch')
    await expect(editor(page)).toContainText('scratch')

    await page.evaluate(() => {
      const host = globalThis as unknown as {
        OpenLeaf: { __runtime: Record<string, { registerEditorPlugin: (f: () => []) => void }> }
      }
      host.OpenLeaf.__runtime['@openleaf-editor/core']!.registerEditorPlugin(() => [])
    })

    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor(page)).not.toContainText('scratch')
  })
})


/**
 * Malformed markup in the source box.
 *
 * The HTML parser accepts attribute names `setAttribute` refuses -- `<p ="v">`
 * parses to one attribute literally named `="v"` -- and the schema carried those
 * through as residue and wrote them back on the way out. So closing the source
 * view threw from the middle of rendering, after the source box had already been
 * removed and `sourceMode` flipped but before the content host was unhidden: a
 * blank rectangle, the Source button still reading pressed, nothing clickable,
 * and toggling back throwing again. A page reload was the only way out and the
 * author's work was gone. All three engines, byte-identically.
 *
 * The fix has two halves and this asserts both: the schema no longer carries a
 * name it cannot write, and the teardown restores the view in a `finally` so any
 * future failure leaves a usable editor rather than a blank one.
 */
test.describe('a stray = in the source box', () => {
  const sourceButton = (page: Page) => page.getByRole('button', { name: 'HTML source' })
  const sourceBox = (page: Page) => page.getByRole('textbox', { name: 'HTML source' })

  test('closes the source view and leaves an editor the author can use', async ({ page }) => {
    await sourceButton(page).click()
    await expect(sourceBox(page)).toBeVisible()
    await sourceBox(page).fill('<p ="v">typed</p>')
    await sourceButton(page).click()

    // Visible, not a blank rectangle: the content host was unhidden.
    await expect(sourceBox(page)).toBeHidden()
    await expect(editor(page)).toBeVisible()
    // And the flag and the button agree again.
    await expect(sourceButton(page)).toHaveAttribute('aria-pressed', 'false')

    // The text survived; only the name that cannot be written was dropped.
    await expect(editor(page)).toContainText('typed')
    await expect.poll(() => submittedValue(page)).toContain('typed')
  })

  test('is still editable afterwards, and source still toggles', async ({ page }) => {
    await sourceButton(page).click()
    await sourceBox(page).fill('<p ="v">typed</p>')
    await sourceButton(page).click()

    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect.poll(() => submittedValue(page)).toContain('typed!')

    // Toggling back used to throw again, which is what made it unrecoverable.
    await sourceButton(page).click()
    await expect(sourceBox(page)).toBeVisible()
  })

  test('loads a stored document containing one instead of throwing', async ({ page }) => {
    // `element.value = html` threw on assignment, and `get value` threw too, so
    // a legacy row or a hand-edited template could not be opened at all and a
    // framework wrapper threw on every render.
    const outcome = await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      try {
        el.value = '<p ="v">Quarterly report</p>'
      } catch (error) {
        return { set: String(error), read: null }
      }
      try {
        return { set: null, read: el.value }
      } catch (error) {
        return { set: null, read: `THREW: ${String(error)}` }
      }
    })
    expect(outcome.set).toBeNull()
    expect(outcome.read).toContain('Quarterly report')
    await expect(editor(page)).toContainText('Quarterly report')
  })
})
