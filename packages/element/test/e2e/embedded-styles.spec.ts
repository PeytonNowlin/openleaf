import { expect, test, type Page } from '@playwright/test'
import type { OpenLeafEditor } from '../../src/index.js'

const hero = '<style>body{color:rgb(20,30,40)} .hero{background:rgb(10,25,40);color:white;padding:40px;background-image:linear-gradient(blue,black)} .hero h1{font-size:48px;font-weight:900} button{color:rgb(255,0,0)} @media(min-width:1px){.hero p{font-size:22px}}</style><section class="hero"><h1>Built Right.</h1><p>For Ohio.</p></section>'
const read = (page: Page) => page.evaluate(() => (document.querySelector('#cms') as OpenLeafEditor).value)

test.beforeEach(async ({ page }) => {
  await page.goto('/packages/element/test/e2e/harness-session.html')
  await page.evaluate((html) => {
    const host = document.createElement('openleaf-editor')
    host.id = 'cms'
    host.setAttribute('preserve-styles', '')
    host.setAttribute('aria-label', 'CMS module')
    host.setAttribute('toolbar', 'undo redo | bold | preview source')
    const field = document.createElement('textarea')
    field.id = 'cms-field'
    field.name = 'cms'
    field.hidden = true
    field.defaultValue = html
    host.setAttribute('for', field.id)
    document.querySelector('form')!.append(field, host)
  }, hero)
  await expect(page.locator('#cms .hero')).toBeVisible()
})

test('renders embedded CSS without styling admin controls or another editor', async ({ page }) => {
  const cms = page.locator('#cms')
  await expect(cms.locator('.hero')).toHaveCSS('background-color', 'rgb(10, 25, 40)')
  await expect(cms.locator('.hero h1')).toHaveCSS('font-size', '48px')
  await expect(cms.locator('.hero p')).toHaveCSS('font-size', '22px')
  await expect(cms.locator('.ProseMirror')).toHaveCSS('color', 'rgb(20, 30, 40)')
  await expect(cms.getByRole('button', { name: 'Bold', exact: true })).not.toHaveCSS('color', 'rgb(255, 0, 0)')
  await expect(page.locator('body')).not.toHaveCSS('color', 'rgb(20, 30, 40)')
  await page.evaluate(() => {
    const other = document.querySelector('openleaf-editor:not(#cms)') as OpenLeafEditor
    other.value = '<section class="hero"><h1>Other module</h1></section>'
  })
  await expect(page.locator('openleaf-editor:not(#cms) .hero')).not.toHaveCSS('background-color', 'rgb(10, 25, 40)')
  await expect(cms.locator('style')).toHaveCount(0)
  expect(await read(page)).toContain('<style>')
})

test('source CSS edits, undo, module replacement and reset keep the right styles', async ({ page }) => {
  const cms = page.locator('#cms')
  await cms.getByRole('button', { name: 'HTML source', exact: true }).click()
  const source = cms.getByRole('textbox', { name: 'HTML source', exact: true })
  await source.fill(hero.replace('rgb(10,25,40)', 'rgb(40,50,60)'))
  await cms.getByRole('button', { name: 'HTML source', exact: true }).click()
  await expect(cms.locator('.hero')).toHaveCSS('background-color', 'rgb(40, 50, 60)')
  await cms.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(cms.locator('.hero')).toHaveCSS('background-color', 'rgb(10, 25, 40)')
  await page.evaluate(() => { (document.querySelector('#cms') as OpenLeafEditor).value = '<section class="hero"><h1>New module</h1></section>' })
  await expect(cms.locator('.hero')).not.toHaveCSS('background-color', 'rgb(10, 25, 40)')
  expect(await read(page)).not.toContain('<style>')
  await page.evaluate(() => document.querySelector('form')!.reset())
  await expect(cms.locator('.hero')).toHaveCSS('background-color', 'rgb(10, 25, 40)')
  await cms.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Published preview"]').locator('.hero')).toHaveCSS('background-color', 'rgb(10, 25, 40)')
})

test('scopes broad and malformed-media rules and removes its sheet on teardown', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const cms = document.querySelector('#cms') as OpenLeafEditor
    const save = document.querySelector('button')!
    const before = getComputedStyle(save).color
    const sheets = document.adoptedStyleSheets.length
    cms.value = '<style media="all){} button{color:red} @media all">button{color:red} .hero{color:rgb(1,2,3)}</style><style>@font-face{font-family:host;src:url(/never-font.woff)}@property --host{syntax:"*";inherits:true;initial-value:red} body, :root {color:rgb(1,2,3)}</style><p>Replacement</p>'
    const output = cms.value
    const after = getComputedStyle(save).color
    cms.remove()
    await Promise.resolve() // disconnect is deferred so DOM moves keep the editor alive
    return { before, after, removed: document.adoptedStyleSheets.length === sheets - 1, output }
  })
  expect(result.after).toBe(result.before)
  expect(result.removed).toBe(true)
  expect(result.output).toContain('@font-face')
  expect(result.output).toContain('@property')
})
