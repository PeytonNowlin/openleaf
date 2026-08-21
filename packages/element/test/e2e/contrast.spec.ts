/**
 * Focus indicators and contrast minimums, measured in a real browser.
 *
 * These are regression tests for defects that were all invisible to the existing
 * suite because the existing suite asserts structure, not paint. Every failure
 * below shipped: a menu item whose focus indicator was 1.13:1, a colour picker
 * that produced no visual change when it opened, control borders at 1.43:1, a
 * table selection at 1.08:1, and dialogs drawn in the light palette on top of a
 * dark editor.
 *
 * Each check runs against all four built-in palettes, because three of these
 * defects passed in one palette and failed in the other three -- including in
 * the skin named "High contrast", where the menu focus indicator measured
 * 1.23:1.
 *
 * See `./contrast.ts` for why this does not use axe-core.
 */
import { expect, test, type Page } from '@playwright/test'
import { SKINS, contrast, describeRatio, useSkin, type SkinName } from './contrast.js'

const CHROME = '/packages/element/test/e2e/harness-chrome.html'
const FORMAT = '/packages/element/test/e2e/harness-format.html'
const SESSION = '/packages/element/test/e2e/harness-session.html'
const TABLES = '/packages/element/test/e2e/harness-tables.html'
const BASE = '/packages/element/test/e2e/harness.html'

/** SC 1.4.11 Non-text Contrast. */
const NON_TEXT = 3
/** SC 1.4.3 Contrast (Minimum), body-size text. */
const TEXT = 4.5

const firstEditor = (page: Page) => page.locator('openleaf-editor').first()

// ---------------------------------------------------------------------------
// 41. Menu items had `outline: none` and a background swap worth 1.13:1.
// ---------------------------------------------------------------------------
test.describe('menu item focus indicator (SC 2.4.7, 1.4.11)', () => {
  for (const skin of SKINS) {
    test(`is visible in the ${skin} palette`, async ({ page }) => {
      await page.goto(CHROME)
      const host = page.locator('openleaf-editor[for="body"]')
      await expect(host.getByRole('menubar')).toBeVisible()
      await useSkin(page, skin, 'openleaf-editor[for="body"]')

      // Keyboard, not click: `:focus-visible` is the whole point, and it does
      // not match for a pointer-initiated focus.
      await host.getByRole('menuitem', { name: 'Edit' }).focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('ArrowDown')

      const focused = host.locator('.ol-menu-item:focus-visible')
      await expect(focused).toHaveCount(1)

      const ring = await contrast(focused, 'outline-vs-self')
      expect(ring, `focus ring on a menu item: ${describeRatio(ring, NON_TEXT)}`)
        .toBeGreaterThanOrEqual(NON_TEXT)
    })
  }

  test('the ring is a real outline, not a background swap', async ({ page }) => {
    // The specific regression: `outline: none` with the indicator moved onto
    // `background`, which is how it reached 1.13:1 in the first place.
    await page.goto(CHROME)
    const host = page.locator('openleaf-editor[for="body"]')
    await host.getByRole('menuitem', { name: 'Edit' }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')

    const style = await host.locator('.ol-menu-item:focus-visible').evaluate((el) => {
      const s = getComputedStyle(el)
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
    })
    expect(style.style).not.toBe('none')
    expect(style.width).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 42. Swatch borders composited over their own fill; focus lost to selection.
// ---------------------------------------------------------------------------
test.describe('colour swatches (SC 1.4.11)', () => {
  const openPicker = async (page: Page) => {
    await page.goto(FORMAT)
    await expect(firstEditor(page)).toBeVisible()
    await page.getByRole('button', { name: /text colour/i }).click()
    await expect(page.locator('.ol-swatch').first()).toBeVisible()
  }

  test('every swatch has a boundary against the popover, White included', async ({ page }) => {
    await openPicker(page)
    const count = await page.locator('.ol-swatch').count()
    expect(count).toBeGreaterThan(0)

    const worst: Array<{ name: string; ratio: number }> = []
    for (let i = 0; i < count; i += 1) {
      const swatch = page.locator('.ol-swatch').nth(i)
      const name = (await swatch.getAttribute('aria-label')) ?? `#${i}`
      const border = await contrast(swatch, 'border')
      expect(border, `${name} swatch border: ${describeRatio(border, NON_TEXT)}`).not.toBeNull()
      worst.push({ name, ratio: border as number })
    }
    const failing = worst.filter((w) => w.ratio < NON_TEXT)
    expect(
      failing,
      `swatches below ${NON_TEXT}:1: ${failing.map((f) => `${f.name} ${f.ratio.toFixed(2)}`).join(', ')}`,
    ).toHaveLength(0)
  })

  test('opening the picker on the selected colour still shows focus', async ({ page }) => {
    // The reported defect exactly: `:focus-visible` and `[aria-pressed="true"]`
    // were both `outline` at the same specificity, so the selection rule won --
    // and the picker focuses the *selected* swatch on open. The focused state
    // was pixel-identical to the unfocused one.
    await openPicker(page)
    const swatch = page.locator('.ol-swatch').first()
    await swatch.focus()

    const seen = await swatch.evaluate((el) => {
      const s = getComputedStyle(el)
      return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }
    })
    expect(seen.outline).not.toBe('none')
    expect(seen.width).toBeGreaterThanOrEqual(2)

    const ring = await contrast(swatch, 'outline-vs-backdrop')
    expect(ring, `swatch focus ring: ${describeRatio(ring, NON_TEXT)}`)
      .toBeGreaterThanOrEqual(NON_TEXT)
  })

  test('selection and focus are carried by different properties', async ({ page }) => {
    // Apply a colour first, so there is a selected swatch to reopen onto --
    // which is the state the defect needed: `picker.ts` focuses the currently
    // selected swatch, and with both rules on `outline` at 0-2-0 the selection
    // rule won and opening the picker produced no visual change at all.
    await openPicker(page)
    await page.locator('.ol-swatch').nth(9).click()
    await page.getByRole('button', { name: /text colour/i }).click()

    const pressed = page.locator('.ol-swatch[aria-selected="true"]').first()
    await expect(pressed).toHaveCount(1)

    const both = await pressed.evaluate((el) => {
      el.focus()
      const s = getComputedStyle(el)
      return { shadow: s.boxShadow, outline: s.outlineStyle, width: parseFloat(s.outlineWidth) }
    })
    // Selection rides on box-shadow, which leaves `outline` free for focus. If
    // a future edit moves selection back onto `outline`, the two collide again
    // and the focused-and-selected swatch stops being distinguishable.
    expect(both.shadow, 'selection must not be drawn with `outline`').not.toBe('none')
    expect(both.outline, 'the focused swatch must still show a focus ring').not.toBe('none')
    expect(both.width).toBeGreaterThanOrEqual(2)
  })

  test('the focus ring does not sit on the neighbouring swatch', async ({ page }) => {
    // `outline-offset: 2px` inside a 4px gap put the ring hard against the next
    // swatch, where a blue ring on a blue neighbour is 1.00:1.
    await openPicker(page)
    const geometry = await page.locator('.ol-color-grid').evaluate((grid) => {
      const style = getComputedStyle(grid)
      const swatch = grid.querySelector('.ol-swatch') as HTMLElement
      const offset = parseFloat(getComputedStyle(swatch).outlineOffset) || 0
      return { gap: parseFloat(style.columnGap) || 0, offset }
    })
    // Surface must remain visible on BOTH sides of the ring: the ring occupies
    // `offset` to `offset + width`, so the gap has to exceed that.
    expect(geometry.gap).toBeGreaterThan(geometry.offset * 2)
  })
})

// ---------------------------------------------------------------------------
// 43a. Control borders were 1.43:1 in three of the four palettes.
// ---------------------------------------------------------------------------
test.describe('control boundaries (SC 1.4.11)', () => {
  for (const skin of SKINS) {
    test(`the block-type select is delimited in the ${skin} palette`, async ({ page }) => {
      await page.goto(CHROME)
      const host = page.locator('openleaf-editor[for="body"]')
      const select = host.getByRole('combobox').first()
      await expect(select).toBeVisible()
      await useSkin(page, skin, 'openleaf-editor[for="body"]')

      const border = await contrast(select, 'border')
      if (border !== null) {
        expect(border, `select border: ${describeRatio(border, NON_TEXT)}`)
          .toBeGreaterThanOrEqual(NON_TEXT)
        return
      }

      // WebKit reports `border-style: none` and `border-width: 0px` on a
      // <select> carrying `appearance: none`, even though it paints the border
      // -- the border box comes out 2px taller than the client box, and forcing
      // a 10px border shrinks the client box by 20. So the property is
      // unreadable there while the border is genuinely on screen. Confirm it
      // geometrically, then read the used colour off a plain <div> in the same
      // place, which every engine reports correctly. Reading the custom
      // property directly does not work: WebKit hands back the unresolved
      // `var(...)` text when the fallback branch is the one in force.
      const painted = await select.evaluate((el) => {
        const box = el.getBoundingClientRect().height
        return box - (el as HTMLElement).clientHeight >= 2
      })
      expect(painted, 'the select must have a border at all').toBe(true)

      const measured = await select.evaluate((el) => {
        const parent = el.parentElement as HTMLElement
        const probe = document.createElement('div')
        probe.style.borderTop = '1px solid var(--ol-border-strong)'
        parent.appendChild(probe)
        const colour = getComputedStyle(probe).borderTopColor
        probe.remove()

        const parse = (v: string) => {
          const m = v.match(/rgba?\(([^)]+)\)/)
          const n = (m?.[1] ?? '').split(/[,\s/]+/).filter(Boolean).map(Number)
          return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 }
        }
        // The select sits on the toolbar, which is what its edge is seen against.
        const toolbar = el.closest('.ol-toolbar') as HTMLElement
        const behind = parse(getComputedStyle(toolbar).backgroundColor)
        const lum = (c: { r: number; g: number; b: number }) => {
          const f = (v: number) => {
            const t = v / 255
            return t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4)
          }
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
        }
        const a = lum(parse(colour))
        const b = lum(behind)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      })
      expect(measured, `select border: ${describeRatio(measured, NON_TEXT)}`)
        .toBeGreaterThanOrEqual(NON_TEXT)
    })
  }

  for (const skin of SKINS) {
    test(`the editable region is delimited in the ${skin} palette`, async ({ page }) => {
      await page.goto(BASE)
      await expect(firstEditor(page)).toBeVisible()
      await useSkin(page, skin)
      const border = await contrast(page.locator('.ol-content').first(), 'border')
      expect(border, `content frame border: ${describeRatio(border, NON_TEXT)}`)
        .toBeGreaterThanOrEqual(NON_TEXT)
    })
  }
})

// ---------------------------------------------------------------------------
// 43b. Table cell selection was indicated at 1.08:1 and vanished in HCM.
// ---------------------------------------------------------------------------
test('a selected table cell carries a visible indicator (SC 1.4.11)', async ({ page }) => {
  await page.goto(TABLES)
  await expect(firstEditor(page)).toBeVisible()
  const cells = page.locator('.ProseMirror td, .ProseMirror th')
  // Asserted rather than skipped: a harness that stopped rendering a table
  // would otherwise turn this into a silent pass.
  expect(await cells.count()).toBeGreaterThanOrEqual(2)

  // Drag across two cells to make a rectangular CellSelection.
  const from = await cells.nth(0).boundingBox()
  const to = await cells.nth(1).boundingBox()
  if (!from || !to) throw new Error('table cells have no layout box')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()

  const selected = page.locator('.ProseMirror .selectedCell').first()
  await expect(selected).toHaveCount(1)

  const ring = await contrast(selected, 'outline-vs-self')
  expect(ring, `selected cell indicator: ${describeRatio(ring, NON_TEXT)}`)
    .toBeGreaterThanOrEqual(NON_TEXT)
})

// ---------------------------------------------------------------------------
// 43d. Find hits were colour-only at 1.44:1 with no secondary indicator.
// ---------------------------------------------------------------------------
test('find hits carry an indicator that is not colour alone (SC 1.4.1, 1.4.11)', async ({ page }) => {
  await page.goto(SESSION)
  await expect(firstEditor(page)).toBeVisible()
  await page.getByRole('button', { name: /find/i }).first().click()
  const field = page.locator('.ol-find input[type="search"], .ol-find input[type="text"]').first()
  await field.fill('alpha')
  await field.press('Enter')

  // A NON-current hit specifically. The current one always had an outline; it
  // was every other match that was indicated by tint alone, at 1.44:1.
  const other = page.locator('.ol-find-hit:not(.ol-find-hit-current)').first()
  await expect(other).toHaveCount(1)

  // Colour-blind and greyscale users get nothing from a tint alone, so the
  // shape indicator is asserted separately from its contrast.
  const outline = await other.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline, 'a non-current find hit needs a non-colour indicator').not.toBe('none')

  const ring = await contrast(other, 'outline-vs-self')
  expect(ring, `find hit outline: ${describeRatio(ring, NON_TEXT)}`)
    .toBeGreaterThanOrEqual(NON_TEXT)

  // And the two states must still be told apart, or "you are here" is lost.
  const current = page.locator('.ol-find-hit-current').first()
  const widths = {
    other: await other.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)),
    current: await current.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)),
  }
  expect(widths.current).toBeGreaterThan(widths.other)
})

// ---------------------------------------------------------------------------
// 44. Dialogs were appended to document.body, outside `.ol-editor`.
// ---------------------------------------------------------------------------
test.describe('dialogs inherit the editor palette', () => {
  const openLinkDialog = async (page: Page, skin: SkinName) => {
    await page.goto(BASE)
    await expect(firstEditor(page)).toBeVisible()
    await useSkin(page, skin)
    // A link needs a selection to attach to, or the button is disabled.
    await page.locator('.ProseMirror').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(page.locator('dialog.ol-dialog')).toBeVisible()
  }

  for (const skin of SKINS) {
    test(`the link dialog is legible in the ${skin} palette`, async ({ page }) => {
      await openLinkDialog(page, skin)
      const dialog = page.locator('dialog.ol-dialog')

      // The reported symptom: skin="midnight" plus Link gave a white dialog
      // with #1f2328 text on top of a #0d1117 editor.
      const surfaces = await dialog.evaluate((d) => {
        const host = document.querySelector('openleaf-editor') as HTMLElement
        return {
          dialog: getComputedStyle(d).backgroundColor,
          editor: getComputedStyle(host).getPropertyValue('--ol-surface').trim(),
          nested: host.contains(d),
        }
      })
      expect(surfaces.nested, 'the dialog must be mounted inside the editor').toBe(true)

      const text = await contrast(dialog.locator('h2'), 'text')
      expect(text, `dialog heading: ${describeRatio(text, TEXT)}`).toBeGreaterThanOrEqual(TEXT)
    })
  }

  test('nesting does not cost the dialog its top layer', async ({ page }) => {
    // The entire fix rests on `showModal()` promoting regardless of DOM
    // position. If that ever stopped holding, the dialog would be clipped by
    // the editor instead of covering the page.
    await openLinkDialog(page, 'midnight')
    const state = await page.locator('dialog.ol-dialog').evaluate((d) => {
      const r = d.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        modal: d.matches(':modal'),
        clipped: r.width === 0 || r.height === 0,
        onTop: !!hit && (hit === d || d.contains(hit)),
      }
    })
    expect(state.modal).toBe(true)
    expect(state.clipped).toBe(false)
    expect(state.onTop).toBe(true)
  })

  test('the error message is readable on a dark surface (SC 1.4.3)', async ({ page }) => {
    await openLinkDialog(page, 'midnight')
    // Submitting empty is what produces the error, which is the one string in
    // the dialog that had a hardcoded #cf222e -- 3.53:1 on the dark surface.
    await page.locator('dialog.ol-dialog input[name="href"]').fill('')
    await page.locator('dialog.ol-dialog').getByRole('button', { name: 'Save' }).click()
    const error = page.locator('dialog.ol-dialog .ol-error')
    await expect(error).not.toBeEmpty()

    // The dialog must actually be dark, or this measures #cf222e on white and
    // proves nothing -- which is exactly what it would have done before the
    // dialog moved inside the editor.
    const surface = await page.locator('dialog.ol-dialog').evaluate((d) => {
      const host = document.querySelector('openleaf-editor') as HTMLElement
      return {
        dialog: getComputedStyle(d).backgroundColor,
        editor: getComputedStyle(host.querySelector('.ol-content')!).backgroundColor,
      }
    })
    expect(surface.dialog, 'the dialog must share the editor surface').toBe(surface.editor)

    const ratio = await contrast(error, 'text')
    expect(ratio, `dialog error text: ${describeRatio(ratio, TEXT)}`).toBeGreaterThanOrEqual(TEXT)
  })
})

// ---------------------------------------------------------------------------
// Mounting dialogs inside the editor puts them inside the host page's <form>.
// ---------------------------------------------------------------------------
test('saving a dialog does not submit the page form', async ({ page }) => {
  // `submit` bubbles. Every harness mirrors the documented CMS integration --
  // the editor inside a <form> -- so a dialog's own `method="dialog"` submit
  // would otherwise reach the page's listeners. In this repo that is the
  // session plugin's, which treats a submit as "saved" and deletes the autosave
  // draft; for an integrator it would be a spurious navigation.
  await page.goto(BASE)
  await expect(firstEditor(page)).toBeVisible()

  const submits = await page.evaluate(() => {
    const state = { count: 0 }
    document.getElementById('post-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      state.count += 1
    })
    ;(window as unknown as { __submits: { count: number } }).__submits = state
    return true
  })
  expect(submits).toBe(true)

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.locator('dialog.ol-dialog input[name="href"]').fill('https://example.org')
  await page.locator('dialog.ol-dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('dialog.ol-dialog')).toHaveCount(0)

  const count = await page.evaluate(
    () => (window as unknown as { __submits: { count: number } }).__submits.count,
  )
  expect(count, 'the page form must not see the dialog’s submit').toBe(0)
})
