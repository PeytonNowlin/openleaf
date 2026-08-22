/**
 * Media editing in a real browser.
 *
 * The parts that jsdom cannot answer. A `<video controls>` draws its own control
 * bar and takes pointer events for it, so "can the author still select the
 * player in order to edit it" is a question only a real engine can settle --
 * and if the answer were no, the edit path would be unreachable however well it
 * is unit tested. WebKit matters most here: it is the engine with the most
 * opinionated native media chrome.
 */

import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const HARNESS = '/packages/element/test/e2e/harness-insert.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const mediaButton = (page: Page) => toolbar(page).getByRole('button', { name: 'Insert media' })
const dialog = (page: Page) => page.locator('dialog.ol-dialog')
const field = (page: Page, name: string) => dialog(page).locator(`[name="${name}"]`)

/** Put a player in the document by hand, so the test starts from stored HTML. */
async function seed(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector('openleaf-editor')
    if (el) (el as HTMLElement & { value: string }).value = value
  }, html)
}

async function selectTheVideo(page: Page): Promise<void> {
  const video = editor(page).locator('video').first()
  await expect(video).toBeVisible()
  const box = await video.boundingBox()
  if (!box) throw new Error('the video has no box')
  // The upper area, deliberately: the lower strip is the native control bar,
  // and a click there is a play/pause the author did not mean as a selection.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25)
}

test.describe('inserting media', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
    await expect(mediaButton(page)).toBeVisible()
  })

  test('offers the fields the format needs', async ({ page }) => {
    await editor(page).click()
    await mediaButton(page).click()
    await expect(dialog(page)).toBeVisible()
    for (const name of ['src', 'title', 'poster', 'width', 'height', 'alt0', 'altType0', 'alt1', 'altType1']) {
      await expect(field(page, name)).toBeVisible()
    }
  })

  test('inserts a video with an alternative source', async ({ page }) => {
    await editor(page).click()
    await mediaButton(page).click()
    await field(page, 'src').fill('/clip.mp4')
    await field(page, 'alt0').fill('/clip.webm')
    await field(page, 'altType0').fill('video/webm')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(dialog(page)).toBeHidden()
    const html = await stored(page)
    expect(html).toContain('/clip.mp4')
    expect(html).toContain('<source src="/clip.webm" type="video/webm">')
  })

  test('turns a pasted watch page into an embed', async ({ page }) => {
    await editor(page).click()
    await mediaButton(page).click()
    await field(page, 'src').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(dialog(page)).toBeHidden()
    const html = await stored(page)
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ')
    expect(html).not.toContain('watch?v=')
  })

  test('keeps the dialog open and says why when there is nothing to play', async ({ page }) => {
    await editor(page).click()
    await mediaButton(page).click()
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('alert')).toBeVisible()
  })
})

test.describe('editing a player that is already there', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
    await expect(mediaButton(page)).toBeVisible()
    await seed(
      page,
      '<p>Alpha.</p><video controls width="240" poster="/p.jpg">' +
        '<source src="/clip.webm" type="video/webm"><source src="/clip.mp4" type="video/mp4"></video>',
    )
  })

  // The one a unit test cannot answer: native media chrome takes pointer events
  // for its own controls, and if the picture area did not select the node then
  // editing a player would be unreachable in practice.
  test('can still be selected despite its native controls', async ({ page }) => {
    await selectTheVideo(page)
    await mediaButton(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('h2')).toHaveText('Edit media')
  })

  test('prefills every field from the stored player', async ({ page }) => {
    await selectTheVideo(page)
    await mediaButton(page).click()
    await expect(field(page, 'poster')).toHaveValue('/p.jpg')
    await expect(field(page, 'width')).toHaveValue('240')
    await expect(field(page, 'alt0')).toHaveValue('/clip.webm')
    await expect(field(page, 'altType0')).toHaveValue('video/webm')
    await expect(field(page, 'alt1')).toHaveValue('/clip.mp4')
    // A source-only player has no address of its own, and the dialog says so
    // rather than inventing one.
    await expect(field(page, 'src')).toHaveValue('')
  })

  test('changes the player in place rather than adding a second one', async ({ page }) => {
    await selectTheVideo(page)
    await mediaButton(page).click()
    await field(page, 'alt0').fill('/other.webm')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(dialog(page)).toBeHidden()
    const html = await stored(page)
    expect(html).toContain('/other.webm')
    expect(html).not.toContain('/clip.webm')
    expect(html.match(/<video/g)?.length).toBe(1)
  })

  test('has a keyboard-operable resize handle', async ({ page }) => {
    await selectTheVideo(page)
    const handle = editor(page).locator('.ol-img-handle')
    await expect(handle).toHaveAttribute('aria-label', 'Video width')
    await expect(handle).toHaveAttribute('role', 'slider')
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    expect(await stored(page)).toContain('width="250"')
  })

  test('does not give audio a handle, because its schema has no box', async ({ page }) => {
    await seed(page, '<p>Alpha.</p><audio src="/a.mp3" controls></audio>')
    await expect(editor(page).locator('audio')).toBeVisible()
    await expect(editor(page).locator('.ol-img-handle')).toHaveCount(0)
  })
})
