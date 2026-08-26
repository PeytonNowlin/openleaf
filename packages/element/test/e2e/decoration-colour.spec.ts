import { expect, test, type Page } from '@playwright/test'

/**
 * Underline and strike must paint in the same colour as the glyphs.
 *
 * Schema order wraps `<u>`/`<s>` around the colour span, and CSS Text
 * Decorations paint the line in the originating element's colour -- so a rule
 * on `u` that reads `currentColor` is a no-op for the nest the editor itself
 * produces. The opposite nest (colour wrapping the decoration) already
 * inherits. Both have to be true, including after a skin change: midnight is
 * the repro, because a cream line under red letters is the miss you can see.
 *
 * jsdom does not compute `text-decoration-color`. This file is the proof.
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

function host(page: Page) {
  return page.locator('openleaf-editor')
}

async function setBody(page: Page, html: string): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
    el.value = value
  }, html)
}

/**
 * The decoration actually painted over `needle`, and the glyph colour of
 * that text. Walks from the text node out and takes the innermost element
 * whose line is not `none` and whose decoration colour is not transparent --
 * that is the line you see, whether it lives on `<u>` or was re-established
 * on the colour span.
 */
function paintedOver(
  page: Page,
  needle: string,
): Promise<{ glyph: string; decoration: string; line: string; html: string }> {
  return page.evaluate((text) => {
    const root = document.querySelector('.ProseMirror')
    if (!root) throw new Error('no canvas')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Text | null = null
    while (walker.nextNode()) {
      const current = walker.currentNode as Text
      if (current.textContent?.includes(text)) {
        node = current
        break
      }
    }
    if (!node?.parentElement) throw new Error(`no text "${text}"`)
    const glyph = getComputedStyle(node.parentElement).color
    let el: HTMLElement | null = node.parentElement
    let decoration = ''
    let line = ''
    while (el && !el.classList.contains('ProseMirror')) {
      const cs = getComputedStyle(el)
      const painted = cs.textDecorationLine
      const color = cs.textDecorationColor
      const transparent = color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
      if (painted && painted !== 'none' && !transparent) {
        decoration = color
        line = painted
        break
      }
      el = el.parentElement
    }
    return { glyph, decoration, line, html: node.parentElement.closest('p')?.innerHTML ?? '' }
  }, needle)
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
  await expect(toolbar(page)).toBeVisible()
})

test.describe('underline and strike follow the text colour', () => {
  test('colour then underline, including after switching to midnight', async ({ page }) => {
    await setBody(page, '<p>Paint me</p>')
    await editor(page).click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)

    await button(page, 'Text colour').click()
    await page.getByRole('dialog', { name: 'Text colour' }).getByRole('gridcell', { name: 'Red', exact: true }).click()
    await button(page, 'Underline').click()

    const before = await paintedOver(page, 'Paint me')
    expect(before.line).toContain('underline')
    expect(before.decoration).toBe(before.glyph)
    // Schema order: the colour span is inside <u>. This is the nest a
    // currentColor-on-u rule cannot fix, and the one the UI produces.
    expect(before.html).toMatch(/<u[^>]*>.*<span style="color:#dc2626">Paint me<\/span>.*<\/u>/)

    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await expect(host(page)).toHaveAttribute('data-ol-skin', 'midnight')

    const after = await paintedOver(page, 'Paint me')
    expect(after.decoration).toBe(after.glyph)
    expect(after.glyph).toBe('rgb(220, 38, 38)')
  })

  test('underline then a later colour change retints the line', async ({ page }) => {
    await setBody(page, '<p>Paint me</p>')
    await editor(page).click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)
    await button(page, 'Underline').click()
    await button(page, 'Text colour').click()
    await page.getByRole('dialog', { name: 'Text colour' }).getByRole('gridcell', { name: 'Blue', exact: true }).click()

    const painted = await paintedOver(page, 'Paint me')
    expect(painted.line).toContain('underline')
    expect(painted.decoration).toBe(painted.glyph)
    expect(painted.glyph).toBe('rgb(37, 99, 235)')
  })

  test('both mark nestings, and strike, on the midnight skin', async ({ page }) => {
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await expect(host(page)).toHaveAttribute('data-ol-skin', 'midnight')

    await setBody(
      page,
      '<p><u><span style="color:#ff0000">Nest A</span></u></p>' +
        '<p><s><span style="color:#ff0000">Strike A</span></s></p>',
    )

    const nestA = await paintedOver(page, 'Nest A')
    expect(nestA.html).toContain('<u>')
    expect(nestA.html).toContain('color:#ff0000')
    expect(nestA.line).toContain('underline')
    expect(nestA.decoration).toBe(nestA.glyph)
    expect(nestA.glyph).toBe('rgb(255, 0, 0)')

    const strikeA = await paintedOver(page, 'Strike A')
    expect(strikeA.line).toContain('line-through')
    expect(strikeA.decoration).toBe(strikeA.glyph)

    // Colour wrapping <u> is not the editor's nest -- schema order rewrites
    // it on parse -- so the opposite order is constructed under the same
    // skinned host, where the canvas rules still match.
    await page.evaluate(() => {
      const hostEl = document.querySelector('.ol-editor')
      if (!hostEl) throw new Error('no host')
      const wrap = document.createElement('div')
      wrap.className = 'ol-content'
      wrap.dataset['olNest'] = 'b'
      wrap.innerHTML =
        '<div class="ProseMirror"><p><span style="color:#ff0000"><u>Nest B</u></span></p></div>'
      hostEl.append(wrap)
    })

    const nestB = await page.evaluate(() => {
      const u = document.querySelector('[data-ol-nest="b"] u')
      if (!u) throw new Error('no nest B')
      const cs = getComputedStyle(u)
      return {
        glyph: cs.color,
        decoration: cs.textDecorationColor,
        line: cs.textDecorationLine,
      }
    })
    expect(nestB.line).toContain('underline')
    expect(nestB.decoration).toBe(nestB.glyph)
    expect(nestB.glyph).toBe('rgb(255, 0, 0)')
  })

  test('highlight keeps the line on the foreground', async ({ page }) => {
    await host(page).evaluate((el) => el.setAttribute('skin', 'midnight'))
    await expect(host(page)).toHaveAttribute('data-ol-skin', 'midnight')
    await setBody(page, '<p>Paint me</p>')
    await editor(page).click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+a`)
    await button(page, 'Underline').click()
    await button(page, 'Highlight colour').click()
    await page
      .getByRole('dialog', { name: 'Highlight colour' })
      .getByRole('gridcell', { name: 'Yellow', exact: true })
      .click()

    const painted = await paintedOver(page, 'Paint me')
    expect(painted.line).toContain('underline')
    expect(painted.decoration).toBe(painted.glyph)
    // Midnight's canvas text, not the yellow highlight and not a UA black.
    expect(painted.glyph).toBe('rgb(230, 237, 243)')
  })
})
