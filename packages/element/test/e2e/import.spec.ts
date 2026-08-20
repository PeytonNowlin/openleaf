import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness-import.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const value = (page: Page) => stored(page)

/** A Word "Save as Web Page" export, which is where the real value is. */
const WORD_EXPORT = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><title>Should not be imported</title><style>p { color: red }</style></head>
<body>
<p class="MsoNormal"><span style='font-family:"Calibri"'>Imported intro.<o:p></o:p></span></p>
<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1"><!--[if !supportLists]--><span style='font-family:Symbol'>&#183;<span style='font:7.0pt'>&nbsp;&nbsp; </span></span><!--[endif]-->First bullet<o:p></o:p></p>
<p class="MsoListParagraphCxSpLast" style="mso-list:l0 level1 lfo1"><!--[if !supportLists]--><span style='font-family:Symbol'>&#183;<span style='font:7.0pt'>&nbsp;&nbsp; </span></span><!--[endif]-->Second bullet<o:p></o:p></p>
</body></html>`

/** Drop a file onto the editor the way a person would. */
async function dropFile(page: Page, name: string, type: string, contents: string): Promise<void> {
  await page.evaluate(
    async ({ name, type, contents }) => {
      const data = new DataTransfer()
      data.items.add(new File([contents], name, { type }))
      const target = document.querySelector('.ProseMirror')!
      for (const kind of ['dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(kind, { dataTransfer: data, bubbles: true, cancelable: true }),
        )
      }
    },
    { name, type, contents },
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test.describe('the import control', () => {
  test('is in the toolbar', async ({ page }) => {
    await expect(
      page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Import a file' }),
    ).toBeVisible()
  })

  test('opens a file picker offering the formats it can read', async ({ page }) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Import a file' }).click(),
    ])
    expect(chooser.isMultiple()).toBe(true)
    await chooser.setFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('one\n\ntwo') },
    ])
    await expect.poll(() => value(page)).toContain('<p>one</p><p>two</p>')
  })
})

test.describe('dropping a file', () => {
  test('imports a Word HTML export as real lists', async ({ page }) => {
    await dropFile(page, 'report.htm', 'text/html', WORD_EXPORT)

    const stored = await value(page)
    expect(stored).toContain('<ul>')
    expect(stored).toContain('First bullet')
    expect(stored).toContain('Second bullet')
    // The bullet glyphs and vendor styling do not come with it.
    expect(stored).not.toContain('·')
    expect(stored).not.toMatch(/mso-|Mso|o:p|Calibri/i)
  })

  test('inserts rather than replacing what was already there', async ({ page }) => {
    // Replacing is something an author can do by selecting all first. Silently
    // discarding their work is not recoverable by any care afterwards.
    await dropFile(page, 'notes.txt', 'text/plain', 'Imported line')
    const stored = await value(page)
    expect(stored).toContain('Existing content.')
    expect(stored).toContain('Imported line')
  })

  test('does not import the head of a full document', async ({ page }) => {
    await dropFile(page, 'report.htm', 'text/html', WORD_EXPORT)
    await expect.poll(() => value(page)).not.toContain('Should not be imported')
  })

  test('drops executable content from an imported file', async ({ page }) => {
    await dropFile(
      page,
      'evil.html',
      'text/html',
      '<body><p>safe text</p><script>window.__pwned = 1</script></body>',
    )
    const stored = await value(page)
    expect(stored).toContain('safe text')
    expect(stored).not.toContain('script')
    expect(await page.evaluate(() => (window as never as { __pwned?: number }).__pwned)).toBeUndefined()
  })

  test('tells the author what happened', async ({ page }) => {
    await dropFile(page, 'notes.txt', 'text/plain', 'Imported line')
    await expect
      .poll(() => page.locator('.ol-import-status').textContent(), { timeout: 3000 })
      .toContain('imported')
  })

  test('says so when it cannot read the format', async ({ page }) => {
    // Declining loudly beats inserting nothing and leaving the author guessing.
    await dropFile(page, 'sheet.xlsx', 'application/octet-stream', 'binary-ish')
    await expect
      .poll(() => page.locator('.ol-import-status').textContent(), { timeout: 3000 })
      .toContain('not a format')
  })

  test('leaves dragging within the document to the editor', async ({ page }) => {
    // Only file drops are intercepted. Taking over text drags would break
    // moving a paragraph, which an author would notice immediately.
    const before = await value(page)
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'dragged text')
      document.querySelector('.ProseMirror')!.dispatchEvent(
        new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
      )
    })
    await page.waitForTimeout(200)
    expect(await value(page)).toBe(before)
  })
})

test.describe('without the import bundle', () => {
  test('there is no import control', async ({ page }) => {
    await page.goto('/packages/element/test/e2e/harness.html')
    await expect(editor(page)).toBeVisible()
    await expect(
      page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Import a file' }),
    ).toHaveCount(0)
  })
})
