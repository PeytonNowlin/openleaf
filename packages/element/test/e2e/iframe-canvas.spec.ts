import { expect, test } from '@playwright/test'
import type { OpenLeafEditor } from '../../src/index.js'

const html = '<style>html{font-size:10px}.hero{position:relative;left:50%;width:100vw;margin-left:-50vw;background:rgb(7,24,44)}.hero h1{font-size:4.8rem;color:white}@media(max-width:680px){.hero{background:rgb(8,105,202)}}</style><section class="hero"><h1>Built Right.</h1></section><p>Edit this text</p>'

test.beforeEach(async ({ page }) => {
  await page.goto('/packages/element/test/e2e/harness-session.html')
  await page.evaluate(html => {
    const field = document.createElement('textarea')
    field.id = 'isolated-field'
    field.name = 'isolated'
    field.hidden = true
    field.defaultValue = html
    const editor = document.createElement('openleaf-editor')
    editor.id = 'isolated'
    editor.setAttribute('for', field.id)
    editor.setAttribute('canvas', 'iframe')
    editor.setAttribute('preserve-styles', '')
    editor.setAttribute('aria-label', 'Module content')
    editor.setAttribute('toolbar', 'undo redo | bold link | preview source')
    editor.style.width = '600px'
    document.querySelector('form')!.append(field, editor)
  }, html)
})

test('module viewport and root font belong to the canvas, not the admin page', async ({ page }) => {
  const frame = page.frameLocator('#isolated iframe')
  await expect(frame.locator('.hero')).toHaveCSS('background-color', 'rgb(8, 105, 202)')
  await expect(frame.locator('h1')).toHaveCSS('font-size', '48px')
  const geometry = await frame.locator('.hero').evaluate(el => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, viewport: window.innerWidth }))
  expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1)
  expect(geometry.width).toBe(geometry.viewport)
  await expect(page.locator('html')).not.toHaveCSS('font-size', '10px')
  await page.locator('#isolated').evaluate(el => { (el as HTMLElement).style.width = '800px' })
  await expect(frame.locator('.hero')).toHaveCSS('background-color', 'rgb(7, 24, 44)')
})

test('typing, formatting, source, undo and form reset cross the frame boundary', async ({ page }) => {
  const host = page.locator('#isolated')
  const canvas = page.frameLocator('#isolated iframe').getByRole('textbox', { name: 'Module content', exact: true })
  await page.evaluate(() => { (document.querySelector('#isolated') as OpenLeafEditor).value = '<p>Hello world</p>' })
  await canvas.fill('Replacement')
  await canvas.press('ControlOrMeta+a')
  await expect.poll(()=>host.evaluate(el=>(el as OpenLeafEditor).view!.state.selection.empty)).toBe(false)
  await host.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(canvas.locator('strong')).toHaveText('Replacement')
  await host.getByRole('button', { name: 'HTML source', exact: true }).click()
  await host.getByRole('textbox', { name: 'HTML source', exact: true }).fill(html)
  await host.getByRole('button', { name: 'HTML source', exact: true }).click()
  await expect(canvas.locator('h1')).toHaveCSS('font-size', '48px')
  expect(await page.evaluate(() => (document.querySelector('#isolated') as OpenLeafEditor).value)).toContain('width:100vw')
  await host.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvas.locator('strong')).toHaveText('Replacement')
  await page.evaluate(() => document.querySelector('form')!.reset())
  await expect(canvas.locator('h1')).toHaveText('Built Right.')
})

test('session preview and find still use the owning editor', async ({ page }) => {
  const host = page.locator('#isolated')
  const frame = page.frameLocator('#isolated iframe')
  await expect(frame.locator('h1')).toBeVisible()
  await host.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Published preview"]').locator('h1')).toHaveText('Built Right.')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await frame.getByRole('textbox').click()
  await frame.getByRole('textbox').press('ControlOrMeta+f')
  await expect(host.getByRole('searchbox', { name: 'Find', exact: true })).toBeVisible()
})

test('toolbar rebuild keeps the iframe document and selection alive', async ({ page }) => {
  const host = page.locator('#isolated')
  const frame = page.frameLocator('#isolated iframe')
  await expect(frame.locator('h1')).toBeVisible()
  await host.evaluate(el => el.setAttribute('toolbar', 'undo redo | bold italic | source'))
  await expect(frame.locator('h1')).toHaveText('Built Right.')
  await page.evaluate(() => { (document.querySelector('#isolated') as OpenLeafEditor).value = '<p>After rebuild</p>' })
  await frame.getByRole('textbox').fill('Still editable')
  expect(await host.evaluate(el => (el as OpenLeafEditor).value)).toContain('Still editable')
})

test('external content CSS uses iframe roots and stylesheet-relative URLs', async ({ page }) => {
  await page.route('**/theme/editor.css', route => route.fulfill({ contentType: 'text/css', body: 'html{font-size:11px}body{font-family:serif}.external{font-size:2rem;background-image:url(./hero.png)}' }))
  await page.evaluate(() => {
    const editor = document.querySelector('#isolated') as OpenLeafEditor
    editor.value = '<p class="external">External CSS</p>'
    editor.setAttribute('content-css', '/theme/editor.css')
  })
  const text = page.frameLocator('#isolated iframe').locator('.external')
  await expect(text).toHaveCSS('font-size', '22px')
  await expect(text).toHaveCSS('background-image', /\/theme\/hero.png/)
})

test('moving a shared modal preserves content and undo in a new frame document', async ({ page }) => {
  const host = page.locator('#isolated')
  const frame = page.frameLocator('#isolated iframe')
  await page.evaluate(() => { (document.querySelector('#isolated') as OpenLeafEditor).value = '<p>Before move</p>' })
  await frame.getByRole('textbox').fill('After edit')
  await host.evaluate(el => document.body.appendChild(el))
  await expect(frame.getByRole('textbox')).toHaveText('After edit')
  await host.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(frame.locator('h1')).toHaveText('Built Right.')
})

test('iframe content still passes through the HTML safety policy', async ({ page }) => {
  await page.evaluate(() => {
    const host = document.querySelector('#isolated') as OpenLeafEditor
    host.value = '<script>parent.__unsafeCanvas = true</script><section onclick="parent.__unsafeCanvas = true"><img src="/missing-image" onerror="parent.__unsafeCanvas = true"><a href="javascript:parent.__unsafeCanvas=true">Unsafe link</a><p>Safe text</p></section>'
  })
  const frame = page.frameLocator('#isolated iframe')
  await expect(frame.locator('p')).toHaveText('Safe text')
  await expect(frame.locator('script, [onclick], [onerror], [href^="javascript:"]')).toHaveCount(0)
  const value = await page.locator('#isolated').evaluate(el => (el as OpenLeafEditor).value)
  expect(value).not.toContain('__unsafeCanvas')
  // The frame is populated solely through the schema's parsed DOM; authored
  // HTML is never assigned to srcdoc or written to the frame document.
  await expect(page.locator('#isolated iframe')).not.toHaveAttribute('srcdoc')
})

test('a module mounted in a hidden modal renders when the modal opens', async ({ page }) => {
  await page.evaluate(html => {
    const modal = document.createElement('div')
    modal.id = 'hidden-modal'
    modal.hidden = true
    document.body.appendChild(modal)
    const editor = document.createElement('openleaf-editor') as OpenLeafEditor
    editor.setAttribute('canvas', 'iframe')
    editor.setAttribute('preserve-styles', '')
    modal.appendChild(editor)
    editor.value = html
    modal.hidden = false
  }, html)
  await expect(page.frameLocator('#hidden-modal iframe').locator('h1')).toHaveCSS('font-size', '48px')
})

test('iframe context menu opens in the parent and link dialog retains its selection', async ({ page }) => {
  await page.evaluate(() => { (document.querySelector('#isolated') as OpenLeafEditor).value = '<p><a href="https://example.com">Existing link</a></p>' })
  const frame = page.frameLocator('#isolated iframe')
  await frame.getByRole('link').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Editor menu' })).toBeVisible()
  await page.keyboard.press('Escape')
  await frame.getByRole('link').click()
  await page.locator('#isolated').getByRole('button', { name: 'Link', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue('https://example.com')
})

test('document files dropped in the iframe reach the import plugin', async ({ page }) => {
  await page.addScriptTag({ url: '/demo/openleaf-import.min.js' })
  await page.evaluate(() => { (document.querySelector('#isolated') as OpenLeafEditor).value = '<p></p>' })
  const canvas = page.frameLocator('#isolated iframe').getByRole('textbox')
  await canvas.evaluate(el => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['Imported in frame'], 'document.txt', { type: 'text/plain' }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(canvas).toContainText('Imported in frame')
})

test('validation descriptions cross the frame without overwriting authored IDs', async ({ page }) => {
  await page.evaluate(() => {
    const description = document.createElement('p')
    description.id = 'module-help'
    description.textContent = 'Describe the module'
    document.body.appendChild(description)
    const host = document.querySelector('#isolated') as OpenLeafEditor
    host.value = '<p id="module-help">Keep authored content</p>'
    host.setAttribute('aria-describedby', 'module-help')
  })
  const canvas = page.frameLocator('#isolated iframe').getByRole('textbox')
  await expect(canvas).toHaveAccessibleDescription(/Describe the module/)
  await expect(canvas.locator('#module-help')).toHaveText('Keep authored content')
})
