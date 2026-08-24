import { expect, test, type Page } from '@playwright/test'

/**
 * Alignment, colour and image upload, in real browsers.
 *
 * Three things are worth testing here rather than in jsdom:
 *
 *  1. **The stored bytes, in engines that matter.** The schema writes CSS with
 *     `setAttribute` precisely so the CSSOM cannot rewrite `#cc0000` into
 *     `rgb(204, 0, 0)`; that measurement was taken in Chromium and WebKit, so the
 *     guard against it regressing belongs where those engines run.
 *
 *  2. **The colour picker's keyboard model.** Focus, roving tabindex, arrow keys
 *     in a grid and Escape returning focus are precisely what jsdom does not
 *     model.
 *
 *  3. **The upload flow end to end**, including a real `File`, a real
 *     `DataTransfer` on a drop, and the modal dialog's async commit.
 */

const HARNESS = '/packages/element/test/e2e/harness-format.html'

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Post body' })
}

function toolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Formatting' })
}

function button(page: Page, name: string) {
  return toolbar(page).getByRole('button', { name, exact: true })
}

/**
 * What the host form would submit: the stored HTML, exactly.
 *
 * Goes through the documented contract rather than the element's internals.
 * Constructing a `FormData` from the form fires the `formdata` event, which is
 * one of the two hooks the element uses to write the textarea before a post -- so
 * this is the same code path a fetch-based save takes, with no navigation.
 *
 * Clicking the submit button would work too and is what other specs do, but it
 * navigates, and reading the page afterwards is a race that Firefox loses.
 */
function stored(page: Page): Promise<string> {
  return page.evaluate(() => {
    const form = document.querySelector('#post-form') as HTMLFormElement
    new FormData(form)
    return (document.querySelector('#body') as HTMLTextAreaElement).value
  })
}

/** Put the caret inside the paragraph whose text contains `text`. */
async function caretIn(page: Page, text: string): Promise<void> {
  await editor(page).getByText(text, { exact: false }).first().click()
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
  await expect(toolbar(page)).toBeVisible()
})

test.describe('inherited content survives being opened and saved', () => {
  test('keeps a hex colour as hex rather than expanding it to rgb()', async ({ page }) => {
    // The measurement this guards: ProseMirror's serializer writes `style` with
    // `element.style.cssText`, and the CSSOM rewrites as it parses. Left alone it
    // turns every hex colour in an archive into a longer functional form on the
    // first save. See applyStyleAttribute in core/src/css.ts.
    expect(await stored(page)).toContain('color:#cc0000')
  })

  test('normalizes only the spacing of a declaration it models', async ({ page }) => {
    // `text-align: center;` as TinyMCE writes it comes back as
    // `text-align:center`: same value, same rendering, one space and one
    // semicolon fewer. That is the whole normalization.
    const html = await stored(page)
    expect(html).toContain('<p style="text-align:center">Centred already.</p>')
  })

  test('normalizes a legacy align attribute into the modern declaration', async ({ page }) => {
    const html = await stored(page)
    expect(html).toContain('text-align:right')
    expect(html).not.toContain('align="right"')
  })

  test('keeps a declaration it does not model beside one it does', async ({ page }) => {
    const html = await stored(page)
    expect(html).toContain('line-height:1.8')
    expect(html).toContain('text-align:center')
  })

  test('converts a font element into a colour mark', async ({ page }) => {
    const html = await stored(page)
    expect(html).not.toContain('<font')
    expect(html).toContain('color:green')
  })

  test('leaves coloured text editable rather than as an opaque atom', async ({ page }) => {
    // The whole justification for modelling colour in core rather than leaving it
    // to the preservation layer. An atom round-trips perfectly and cannot be typed
    // into, spellchecked, or partially selected.
    await editor(page).getByText('Red run').dblclick()
    await page.keyboard.type('Blue')
    const html = await stored(page)
    // Still one coloured span, now containing the edit.
    expect(html).toMatch(/<span style="color:#cc0000">[^<]*Blue[^<]*<\/span>/)
  })
})

test.describe('alignment', () => {
  test('centres the paragraph the caret is in', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')
    await button(page, 'Align centre').click()
    expect(await stored(page)).toContain('<p style="text-align:center">Plain paragraph.</p>')
  })

  test('reflects the alignment in force as pressed', async ({ page }) => {
    await caretIn(page, 'Centred already')
    await expect(button(page, 'Align centre')).toHaveAttribute('aria-pressed', 'true')
    await expect(button(page, 'Align left')).toHaveAttribute('aria-pressed', 'false')
  })

  test('reports no alignment pressed for an unaligned paragraph', async ({ page }) => {
    // "No explicit alignment" follows the reading direction and is a different
    // state from "aligned left"; claiming left would be a lie in Arabic.
    await caretIn(page, 'Plain paragraph')
    for (const name of ['Align left', 'Align centre', 'Align right', 'Justify']) {
      await expect(button(page, name)).toHaveAttribute('aria-pressed', 'false')
    }
  })

  test('clears the alignment when the active one is pressed again', async ({ page }) => {
    await caretIn(page, 'Centred already')
    await button(page, 'Align centre').click()
    expect(await stored(page)).toContain('<p>Centred already.</p>')
  })

  test('applies through the keyboard shortcut', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+Shift+KeyR`)
    expect(await stored(page)).toContain('text-align:right')
  })

  test('aligns every block in a multi-paragraph selection', async ({ page }) => {
    await editor(page).click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)
    await button(page, 'Justify').click()
    const html = await stored(page)
    expect([...html.matchAll(/text-align:\s*justify/g)]).toHaveLength(5)
  })
})

test.describe('the colour picker', () => {
  function popover(page: Page) {
    return page.getByRole('dialog', { name: 'Text colour' })
  }

  test('is a closed popover until the trigger is pressed', async ({ page }) => {
    await expect(button(page, 'Text colour')).toHaveAttribute('aria-expanded', 'false')
    await expect(popover(page)).toBeHidden()
  })

  test('opens, applies a named colour, and closes', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)

    await button(page, 'Text colour').click()
    await expect(popover(page)).toBeVisible()
    await popover(page).getByRole('gridcell', { name: 'Red', exact: true }).click()

    await expect(popover(page)).toBeHidden()
    expect(await stored(page)).toContain('color:#dc2626')
  })

  test('names every swatch, so the grid works without seeing colour', async ({ page }) => {
    await button(page, 'Text colour').click()
    // The swatches are gridcells now, so the grid can say which row and column
    // the author is in -- the remove-colour control is the only plain button.
    await expect(popover(page).getByRole('gridcell')).toHaveCount(32)
    await expect(popover(page).getByRole('button')).toHaveCount(1)
    const unnamed = await popover(page)
      .locator('button')
      .evaluateAll((els) => els.filter((el) => !el.getAttribute('aria-label') && !el.textContent?.trim()).length)
    expect(unnamed).toBe(0)
  })

  test('moves focus into the grid and navigates it with the arrow keys', async ({ page }) => {
    const swatch = (name: string) => popover(page).getByRole('gridcell', { name, exact: true })

    await button(page, 'Text colour').click()
    await expect(swatch('Black')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(swatch('Charcoal')).toBeFocused()
    // Down moves one row, which is eight swatches.
    await page.keyboard.press('ArrowDown')
    await expect(swatch('Orange')).toBeFocused()
    // Home goes to the start of the row it is on, not the start of the grid.
    await page.keyboard.press('Home')
    await expect(swatch('Red')).toBeFocused()
  })

  test('closes on Escape and returns focus to the trigger', async ({ page }) => {
    await button(page, 'Text colour').click()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(button(page, 'Text colour')).toBeFocused()
  })

  test('shows the colour in force as the pressed swatch', async ({ page }) => {
    await caretIn(page, 'Red run')
    await button(page, 'Text colour').click()
    // #cc0000 is not in the palette, so nothing is pressed -- but the custom
    // input carries it, which is how an author sees what they have.
    const value = await popover(page).locator('input[type="color"]').inputValue()
    expect(value).toBe('#cc0000')
  })

  test('removes a colour', async ({ page }) => {
    // Select-all rather than Home/Shift+End or a triple click. On macOS those two
    // keys scroll the document in WebKit and Firefox instead of extending a
    // selection, and a triple click does not reliably select the block in WebKit --
    // in both cases the command is handed an empty cursor, where clearing a colour
    // correctly affects only what is typed next, and the test would be asserting
    // the wrong thing about working code.
    await editor(page).click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)

    await button(page, 'Text colour').click()
    await popover(page).getByRole('button', { name: 'Remove colour' }).click()

    const html = await stored(page)
    expect(html).not.toContain('color:#cc0000')
    // The text is still there; only the mark went.
    expect(html).toContain('Red run')
  })

  test('keeps the toolbar one tab stop', async ({ page }) => {
    // The grid lives outside the toolbar element precisely so its 32 buttons
    // never join the roving tabindex.
    const tabbable = await toolbar(page)
      .locator('button')
      .evaluateAll((els) => els.filter((el) => (el as HTMLButtonElement).tabIndex === 0).length)
    expect(tabbable).toBe(1)
  })

  test('highlights with a background colour independently of text colour', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)

    await button(page, 'Text colour').click()
    await page.getByRole('dialog', { name: 'Text colour' })
      .getByRole('gridcell', { name: 'Blue', exact: true }).click()
    await button(page, 'Highlight colour').click()
    await page.getByRole('dialog', { name: 'Highlight colour' })
      .getByRole('gridcell', { name: 'Yellow', exact: true }).click()

    const html = await stored(page)
    expect(html).toContain('color:#2563eb')
    expect(html).toContain('background-color:#fde047')
  })
})

test.describe('image upload', () => {
  const PNG = {
    name: 'photo.png',
    mimeType: 'image/png',
    // A 1x1 transparent PNG.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  }

  test('offers a file picker when an uploader is registered', async ({ page }) => {
    await editor(page).click()
    await button(page, 'Insert image').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('input[type="file"]')).toBeVisible()
    // And still accepts a plain URL, because not every image needs uploading.
    await expect(dialog.getByLabel('Or paste an image address')).toBeVisible()
  })

  test('uploads a chosen file, asks for a description, and inserts it', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')
    await page.keyboard.press('End')
    await button(page, 'Insert image').click()

    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles(PNG)
    await dialog.getByLabel('Alternative text').fill('A photograph of a leaf')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog).toBeHidden()
    const html = await stored(page)
    expect(html).toContain('src="/uploads/photo.png"')
    expect(html).toContain('alt="A photograph of a leaf"')
    // The uploader reported dimensions, which prevent the page reflowing as the
    // image loads.
    expect(html).toContain('width="320"')

    const received = await page.evaluate(() => (window as unknown as { uploaded: unknown[] }).uploaded)
    expect(received).toEqual([{ name: 'photo.png', type: 'image/png', size: PNG.buffer.length }])
  })

  test('refuses to insert an image nobody described', async ({ page }) => {
    await editor(page).click()
    await button(page, 'Insert image').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles(PNG)
    await dialog.getByRole('button', { name: 'Save' }).click()

    // Still open, with the reason stated where a screen reader will read it.
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('alternative text')
  })

  test('accepts the honest answer that an image is decorative', async ({ page }) => {
    await editor(page).click()
    await button(page, 'Insert image').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles(PNG)
    await dialog.getByLabel('This image is decorative and needs no description').check()
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog).toBeHidden()
    // alt="" and a missing alt mean different things to a screen reader.
    expect(await stored(page)).toContain('alt=""')
  })

  test('keeps the dialog and its typed alt text when the upload fails', async ({ page }) => {
    await editor(page).click()
    await button(page, 'Insert image').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({ ...PNG, name: 'broken.png' })
    await dialog.getByLabel('Alternative text').fill('Worth keeping')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog.getByRole('alert')).toContainText('The server rejected the upload.')
    await expect(dialog.getByLabel('Alternative text')).toHaveValue('Worth keeping')
  })

  test('uploads an image dropped onto the editor', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')

    // A real DataTransfer carrying a real File, so the element's own handler runs
    // rather than a synthesised shortcut through it.
    const handle = await page.evaluateHandle(async () => {
      const transfer = new DataTransfer()
      const response = await fetch(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      )
      transfer.items.add(new File([await response.blob()], 'dropped.png', { type: 'image/png' }))
      return transfer
    })

    // Coordinates are not optional here, and the reason is worth recording:
    // ProseMirror resolves a document position from the pointer BEFORE consulting
    // handleDrop, and returns early when that resolves to nothing. A drop event at
    // (0, 0) therefore never reaches the editor's own handler at all -- which looks
    // exactly like the handler being broken.
    const box = await editor(page).boundingBox()
    await editor(page).dispatchEvent('drop', {
      dataTransfer: handle,
      clientX: Math.round((box?.x ?? 0) + 20),
      clientY: Math.round((box?.y ?? 0) + 20),
    })

    const dialog = page.getByRole('dialog', { name: 'Describe this image' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('dropped.png')
    await dialog.getByLabel('Alternative text').fill('Dropped in')
    await dialog.getByRole('button', { name: 'Save' }).click()

    expect(await stored(page)).toContain('src="/uploads/dropped.png"')
  })

  test('refuses a dropped HEIC and announces why', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')

    const handle = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([new Uint8Array([1, 2, 3])], 'IMG_1234.HEIC', { type: 'image/heic' }),
      )
      return transfer
    })

    const box = await editor(page).boundingBox()
    await editor(page).dispatchEvent('drop', {
      dataTransfer: handle,
      clientX: Math.round((box?.x ?? 0) + 20),
      clientY: Math.round((box?.y ?? 0) + 20),
    })

    await expect(page.locator('.ol-live-region')).toContainText(
      'HEIC images are not supported. Use JPEG, PNG, or WebP.',
    )
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const received = await page.evaluate(() => (window as unknown as { uploaded: unknown[] }).uploaded)
    expect(received).toEqual([])
  })

  test('uploads a PNG dropped with a HEIC, and still announces the refusal', async ({ page }) => {
    await caretIn(page, 'Plain paragraph')

    const handle = await page.evaluateHandle(async () => {
      const transfer = new DataTransfer()
      const response = await fetch(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      )
      transfer.items.add(new File([await response.blob()], 'kept.png', { type: 'image/png' }))
      transfer.items.add(
        new File([new Uint8Array([1, 2, 3])], 'IMG_1234.HEIC', { type: 'image/heic' }),
      )
      return transfer
    })

    const box = await editor(page).boundingBox()
    await editor(page).dispatchEvent('drop', {
      dataTransfer: handle,
      clientX: Math.round((box?.x ?? 0) + 20),
      clientY: Math.round((box?.y ?? 0) + 20),
    })

    await expect(page.locator('.ol-live-region')).toContainText(
      'HEIC images are not supported. Use JPEG, PNG, or WebP.',
    )
    const dialog = page.getByRole('dialog', { name: 'Describe this image' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('kept.png')
    await dialog.getByLabel('Alternative text').fill('Kept')
    await dialog.getByRole('button', { name: 'Save' }).click()

    expect(await stored(page)).toContain('src="/uploads/kept.png"')
  })
})
