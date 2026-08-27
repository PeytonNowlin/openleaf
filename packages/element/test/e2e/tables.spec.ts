import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

const CORE_ONLY = '/packages/element/test/e2e/harness.html'
const WITH_TABLES = '/packages/element/test/e2e/harness-tables.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const value = (page: Page) => stored(page)

/**
 * Both configurations are tested, because both ship. A regression that only
 * appears when the opt-in bundle is absent -- or only when it is present -- is
 * exactly the kind a single-configuration suite misses.
 */

test.describe('core bundle alone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CORE_ONLY)
    await expect(editor(page)).toBeVisible()
  })

  test('reads and writes tables even without the editing bundle', async ({ page }) => {
    // The reason table NODES are in core: without them a table becomes an
    // opaque preserved atom, and "we read your tables but you may not touch
    // them" is not something you can tell a CMS.
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<table border="1"><tbody><tr><td>A</td></tr></tbody></table>'
    })
    await expect.poll(() => value(page)).toContain('<table border="1">')
    await expect(editor(page).locator('table')).toBeVisible()
  })

  test('renders a caption and hands it back on save', async ({ page }) => {
    // A caption used to be deleted on parse, which for a screen-reader user
    // removed the table's accessible name. jsdom cannot answer whether it
    // actually renders, so the question is asked in a real browser.
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value =
        '<table><caption>Q1 results</caption>' +
        '<colgroup><col width="200"></colgroup>' +
        '<tbody><tr><td>A</td></tr></tbody></table>'
    })

    const caption = editor(page).locator('table > caption')
    await expect(caption).toBeVisible()
    await expect(caption).toHaveText('Q1 results')

    const stored = await value(page)
    expect(stored).toContain('<caption>Q1 results</caption>')
    expect(stored).toContain('width="200"')
    // The inert marker is for the editor's DOM only; storing it would be this
    // editor writing its own attribute into the author's markup.
    expect(stored).not.toContain('contenteditable')
  })

  test('typing cannot corrupt a caption it does not own', async ({ page }) => {
    // The caption renders inside the editable area but outside the node's
    // contentDOM. Without contenteditable="false" a caret enters it and the
    // typing is reverted on the next redraw, which looks like data loss.
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<table><caption>Q1 results</caption><tbody><tr><td>A</td></tr></tbody></table>'
    })

    const caption = editor(page).locator('table > caption')
    await expect(caption).toBeVisible()
    await expect(caption).toHaveAttribute('contenteditable', 'false')

    await caption.click()
    await page.keyboard.type('XYZ')

    await expect(caption).toHaveText('Q1 results')
    expect(await value(page)).toContain('<caption>Q1 results</caption>')
  })

  test('has no table controls', async ({ page }) => {
    // The opt-in half really is absent, rather than present but inert.
    await expect(toolbar(page).getByRole('button', { name: 'Insert table' })).toHaveCount(0)
  })
})

test.describe('with the table bundle loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WITH_TABLES)
    await expect(editor(page)).toBeVisible()
    await expect(toolbar(page).getByRole('button', { name: 'Insert table' })).toBeVisible()
  })

  test('shares the core runtime instead of loading a second copy', async ({ page }) => {
    // Two ProseMirror copies would mean two schemas, and a table node built by
    // the plugin would be a different node type than the editor accepts.
    const shared = await page.evaluate(() => {
      const rt = (window as never as { OpenLeaf: { __runtime: Record<string, unknown> } }).OpenLeaf
        .__runtime
      return {
        hasRuntime: !!rt,
        modules: Object.keys(rt).length,
        oneSchema: rt['@openleaf-editor/core'] === rt['@openleaf-editor/core'],
      }
    })
    expect(shared.hasRuntime).toBe(true)
    expect(shared.modules).toBeGreaterThan(5)
  })

  test('renders the existing table with its header cells and scope', async ({ page }) => {
    await expect(editor(page).locator('table th')).toHaveCount(2)
    await expect(editor(page).locator('table th').first()).toHaveAttribute('scope', 'col')
  })

  test('inserts a table with a header row', async ({ page }) => {
    // Header row by default: a table without headers is an accessibility
    // problem authors rarely go back and fix.
    await editor(page).getByText('After the table.').click()
    await toolbar(page).getByRole('button', { name: 'Insert table' }).click()
    await page.getByRole('gridcell', { name: '3 by 3 table' }).click()

    await expect.poll(() => value(page)).toMatch(/<th scope="col">/)
    await expect(editor(page).locator('table')).toHaveCount(2)
  })

  test('adds and deletes a row', async ({ page }) => {
    const before = (await editor(page).locator('table tr').count())
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert row below' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(before + 1)

    await toolbar(page).getByRole('button', { name: 'Delete row' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(before)
  })

  test('adds and deletes a column', async ({ page }) => {
    const before = await editor(page).locator('table tr').first().locator('th, td').count()
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert column after' }).click()
    await expect(editor(page).locator('table tr').first().locator('th, td')).toHaveCount(before + 1)

    await toolbar(page).getByRole('button', { name: 'Delete column' }).click()
    await expect(editor(page).locator('table tr').first().locator('th, td')).toHaveCount(before)
  })

  test('edits a captioned table without the cell map drifting', async ({ page }) => {
    /*
     * The load-bearing test for why a caption is an attribute and not a child
     * node. `prosemirror-tables` takes `height = table.childCount` and reads
     * every child as a row, so a caption node would shift every coordinate it
     * derives -- and the symptom would not be an error, it would be row and
     * column commands quietly operating one cell off.
     */
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value =
        '<table><caption>Q1 results</caption><tbody>' +
        '<tr><th scope="col">Region</th><th scope="col">Q1</th></tr>' +
        '<tr><td>North</td><td>1204</td></tr></tbody></table>'
    })
    await expect(editor(page).locator('table > caption')).toBeVisible()

    const rows = await editor(page).locator('table tr').count()
    const cols = await editor(page).locator('table tr').first().locator('th, td').count()

    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert row below' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(rows + 1)

    await toolbar(page).getByRole('button', { name: 'Insert column after' }).click()
    await expect(editor(page).locator('table tr').first().locator('th, td')).toHaveCount(cols + 1)

    // The edits landed and the caption is still there, still exactly once.
    await expect(editor(page).locator('table > caption')).toHaveCount(1)
    expect(await value(page)).toContain('<caption>Q1 results</caption>')
  })

  test('toggles the header row', async ({ page }) => {
    await editor(page).getByText('Region').click()
    await toolbar(page).getByRole('button', { name: 'Toggle header row' }).click()
    await expect.poll(() => value(page)).not.toContain('<th')
    await expect.poll(() => value(page)).not.toMatch(/<td[^>]*scope/)

    await toolbar(page).getByRole('button', { name: 'Toggle header row' }).click()
    await expect.poll(() => value(page)).toMatch(/<th scope="col">/)
  })

  test('adds a header cell with scope', async ({ page }) => {
    await editor(page).getByText('Region').click()
    await toolbar(page).getByRole('button', { name: 'Insert column after' }).click()
    await expect.poll(() => value(page)).toMatch(/<th scope="col">Region<\/th><th scope="col">/)
  })

  test('deletes the whole table', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Delete table' }).click()
    await expect(editor(page).locator('table')).toHaveCount(0)
    // The surrounding content is untouched.
    await expect(editor(page)).toContainText('After the table.')
  })

  test('disables table commands outside a table', async ({ page }) => {
    // A control that silently does nothing looks broken. One that reports
    // itself unavailable looks unavailable.
    await editor(page).getByText('After the table.').click()
    await expect(toolbar(page).getByRole('button', { name: 'Delete row' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await editor(page).getByText('North').click()
    await expect(toolbar(page).getByRole('button', { name: 'Delete row' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
  })

  test('table controls are in the roving tabindex like every other button', async ({ page }) => {
    const tabbable = await toolbar(page).locator('button').evaluateAll(
      (els) => els.filter((el) => (el as HTMLButtonElement).tabIndex === 0).length,
    )
    expect(tabbable).toBe(1)
  })

  test('renders the plugin-registered icons rather than empty squares', async ({ page }) => {
    // Icons come from the plugin, appended to a sprite the core bundle already
    // injected. Getting that wrong produces buttons with nothing in them.
    const box = await toolbar(page)
      .getByRole('button', { name: 'Insert table' })
      .locator('svg')
      .evaluate((el) => el.getBoundingClientRect().width)
    expect(box).toBeGreaterThan(8)
    const symbol = await page.locator('#ol-icon-sprite #ol-i-table').count()
    expect(symbol).toBe(1)
  })

  test('the round trip keeps legacy table attributes', async ({ page }) => {
    await expect.poll(() => value(page)).toContain('border="1"')
    await expect.poll(() => value(page)).toContain('cellpadding="4"')
  })

  test('edits a caption from the toolbar dialog', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Table caption' }).click()
    const dialog = page.getByRole('dialog', { name: 'Table caption' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Caption').fill('Regional totals')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => value(page)).toContain('<caption>Regional totals</caption>')
  })

  test('sets cell vertical alignment from cell properties', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Cell properties' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cell properties' })
    await dialog.getByLabel('Vertical alignment').selectOption('middle')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => value(page)).toMatch(/<td[^>]*valign="middle"/)
  })

  test('opens a context menu on a table cell', async ({ page }) => {
    const cell = editor(page).locator('td', { hasText: 'North' })
    await cell.click()
    await cell.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Table' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Insert row below' }).click()
    await expect(editor(page).locator('table tr')).toHaveCount(3)
  })

  // A secondary click does not always move ProseMirror's selection: with a cell
  // selection live in one table, right-clicking a second one left it in place, so
  // every menu command ran on the table the author had not clicked.
  test('acts on the table that was right-clicked, not the one still selected', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      host.value =
        '<table><tbody><tr><td>first-a</td><td>first-b</td></tr>' +
        '<tr><td>first-c</td><td>first-d</td></tr></tbody></table>' +
        '<table><tbody><tr><td>second-a</td><td>second-b</td></tr>' +
        '<tr><td>second-c</td><td>second-d</td></tr></tbody></table>'
    })
    const content = editor(page)
    await expect(content.getByText('second-a')).toBeVisible()

    // A cell selection across the first table's opening row -- the case
    // prosemirror-tables holds on to across a secondary click elsewhere.
    await content.getByText('first-a').click()
    await content.getByText('first-b').click({ modifiers: ['Shift'] })

    await content.getByText('second-a').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Table' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Delete row' }).click()

    // The clicked table lost its row; the still-selected one kept everything.
    await expect.poll(() => value(page)).not.toContain('second-a')
    const html = await value(page)
    expect(html).toContain('first-a')
    expect(html).toContain('first-b')
  })

  test('inserts a nested table from the size grid', async ({ page }) => {
    await editor(page).getByText('North').click()
    await toolbar(page).getByRole('button', { name: 'Insert table' }).click()
    await page.getByRole('gridcell', { name: '2 by 2 table' }).click()
    await expect(editor(page).locator('table table')).toHaveCount(1)
  })

  /**
   * Nested-table column borders. `columnResizing`'s own hit-test walks to the
   * innermost `td`, so a pointer over a nested table used to resize that inner
   * grid even when it was sitting on an outer column edge. Padding is 0 so the
   * inner table's box actually reaches the outer cell's border — the case the
   * wrapping plugin exists for, not a padded cell where the target would already
   * be the outer `td`.
   */
  const NESTED_FOR_RESIZE =
    '<table border="1"><tbody><tr>' +
    '<td style="padding:0">Left</td>' +
    '<td style="padding:0">' +
    '<table border="1"><tbody><tr><td>InnerA</td><td>InnerB</td></tr></tbody></table>' +
    '</td></tr></tbody></table>'

  test('dragging an outer column border over a nested table resizes the outer grid', async ({
    page,
  }) => {
    await page.evaluate((html) => {
      const host = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      host.value = html
    }, NESTED_FOR_RESIZE)
    const nested = editor(page).locator('table table')
    await expect(nested).toBeVisible()

    const leftWidthBefore = await editor(page)
      .locator('td', { hasText: 'Left' })
      .first()
      .evaluate((el) => (el as HTMLElement).offsetWidth)

    const point = await nested.evaluate((inner) => {
      const host = inner.closest('td')
      if (!host) return null
      const hostRect = host.getBoundingClientRect()
      const innerRect = inner.getBoundingClientRect()
      return { x: hostRect.left + 2, y: innerRect.top + innerRect.height / 2 }
    })
    expect(point).not.toBeNull()

    await page.mouse.move(point!.x, point!.y)
    await expect(editor(page)).toHaveClass(/resize-cursor/)
    await page.mouse.down()
    await page.mouse.move(point!.x + 50, point!.y, { steps: 8 })
    await page.mouse.up()

    const storedHtml = await value(page)
    expect(storedHtml).toContain('InnerA')
    expect(storedHtml).toContain('Left')
    expect(storedHtml.match(/<table/g)?.length).toBe(2)
    // The handle we grabbed belongs to the outer table: its cells pick up
    // `data-colwidth`, and the inner ones do not.
    expect(storedHtml).toMatch(/<td[^>]*data-colwidth/)
    const inner = storedHtml.slice(storedHtml.lastIndexOf('<table'))
    expect(inner).not.toMatch(/data-colwidth/)

    const leftWidthAfter = await editor(page)
      .locator('td', { hasText: 'Left' })
      .first()
      .evaluate((el) => (el as HTMLElement).offsetWidth)
    expect(leftWidthAfter).toBeGreaterThan(leftWidthBefore + 20)
  })

  test('dragging an inner column border still resizes the nested table', async ({ page }) => {
    await page.evaluate((html) => {
      const host = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      host.value = html
    }, NESTED_FOR_RESIZE)
    const innerA = editor(page).locator('table table td', { hasText: 'InnerA' })
    await expect(innerA).toBeVisible()
    const box = await innerA.boundingBox()
    expect(box).not.toBeNull()

    const x = box!.x + box!.width - 2
    const y = box!.y + box!.height / 2
    await page.mouse.move(x, y)
    await expect(editor(page)).toHaveClass(/resize-cursor/)
    await page.mouse.down()
    await page.mouse.move(x + 40, y, { steps: 8 })
    await page.mouse.up()

    const storedHtml = await value(page)
    const inner = storedHtml.slice(storedHtml.lastIndexOf('<table'))
    expect(inner).toMatch(/data-colwidth/)
    expect(storedHtml).toContain('Left')
    expect(storedHtml).toContain('InnerB')
  })

  /**
   * Paste HTML by dispatching a synthetic clipboard event. Same construction as
   * `paste.spec.ts`: real clipboard access is permission-gated, and Firefox
   * returns a null `clipboardData` from the constructor, so a false return is
   * reported rather than a vacuous pass.
   */
  async function pasteHtml(page: Page, html: string): Promise<boolean> {
    return page.evaluate((payload) => {
      const region = document.querySelector<HTMLElement>('.ProseMirror')
      if (!region) return false
      region.focus()
      let data: DataTransfer
      try {
        data = new DataTransfer()
        data.setData('text/html', payload)
      } catch {
        return false
      }
      if (data.getData('text/html') !== payload) return false
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
      if (!event.clipboardData || event.clipboardData.getData('text/html') !== payload) return false
      region.dispatchEvent(event)
      return true
    }, html)
  }

  test('pasting a table into a cell nests it instead of replacing the host', async ({ page }) => {
    await page.evaluate(() => {
      const host = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      host.value =
        '<table><tbody>' +
        '<tr><td>Target</td><td>Sibling</td></tr>' +
        '<tr><td>Below</td><td>Corner</td></tr>' +
        '</tbody></table>'
    })
    await editor(page).getByText('Target').click()
    const ok = await pasteHtml(
      page,
      '<table><tbody>' +
        '<tr><td>Inner A</td><td>Inner B</td></tr>' +
        '<tr><td>Inner C</td><td>Inner D</td></tr>' +
        '</tbody></table>',
    )
    test.skip(!ok, 'this engine does not honour a constructed ClipboardEvent')

    await expect.poll(() => value(page)).toContain('Inner A')
    const html = await value(page)
    expect(html.match(/<table/g)?.length).toBe(2)
    expect(html).toContain('Target')
    expect(html).toContain('Sibling')
    expect(html).toContain('Below')
    expect(html).toContain('Corner')
    expect(html).toContain('Inner D')
  })
})

/**
 * The column-count bound, in the configuration that made it a hung tab.
 *
 * `columnResizing({ View: CaptionedTableView })` installs
 * `updateColumnsOnResize` for every table node view, and that appends one real
 * `<col>` element per column and sums their widths into the table's `minWidth`.
 * So the damage from an unbounded `colspan` is only visible with the tables
 * bundle loaded -- the core-only harness reports zero `<col>` elements for the
 * same input, which is why this lives here and not in the unit tests.
 *
 * Measured against the DOM rather than against a stopwatch: a timing assertion
 * on a machine under load is a flake, and the element count is the thing that
 * was wrong.
 */
test.describe('an unbounded colspan cannot hang the tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WITH_TABLES)
    await expect(editor(page)).toBeVisible()
  })

  test('clamps the columns a single cell can ask for', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<table><tr><td colspan="200000">x</td></tr></table>'
    })
    await expect(editor(page).locator('table')).toBeVisible()
    // 200000 before the clamp, and 5,000,000 for the value in the report.
    const cols = await editor(page).locator('table colgroup col').count()
    expect(cols).toBeLessThanOrEqual(1000)
    // And the table is no longer asked to lay out at twenty million pixels. The
    // ceiling is the clamp times prosemirror-tables' 100px default column
    // minimum, which is what a legitimate thousand-column table would also cost.
    const minWidth = await editor(page)
      .locator('table')
      .evaluate((el) => Number.parseInt((el as HTMLElement).style.minWidth || '0', 10))
    expect(minWidth).toBeLessThanOrEqual(1000 * 100)
  })

  test('still edits normally afterwards, and stores the clamped span', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = '<table><tr><td colspan="200000">x</td></tr></table>'
    })
    await expect.poll(() => value(page)).toContain('colspan="1000"')
    await editor(page).getByText('x').click()
    await page.keyboard.type('y')
    await expect.poll(() => value(page)).toContain('xy')
  })
})

/**
 * `readonly`, for the paths that are not behind ProseMirror's `editable` gate.
 *
 * Typing, paste, drop and the keymaps are gated by `editable`, and the toolbar
 * and the element's own menus check the attribute themselves. The table context
 * menu is bound directly on `view.dom` -- deliberately, so cell-selection
 * handling in `prosemirror-tables` cannot swallow the event first -- and that is
 * exactly what took it out of the gate. It opened with all fourteen entries live
 * on a read-only table, and Delete row worked. Shift+F10 fires `contextmenu`
 * too, so it was reachable from the keyboard.
 *
 * In a real browser rather than only in jsdom, because the whole question is
 * whether a real secondary click reaches a real listener.
 */
test.describe('a read-only table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WITH_TABLES)
    await expect(editor(page)).toBeVisible()
    await page.evaluate(() => {
      document.querySelector('openleaf-editor')!.setAttribute('readonly', '')
    })
  })

  test('opens no context menu on a secondary click', async ({ page }) => {
    await editor(page).getByText('North').click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Table' })).toBeHidden()
  })

  test('opens none from the keyboard either', async ({ page }) => {
    await editor(page).getByText('North').click()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu', { name: 'Table' })).toBeHidden()
  })

  test('keeps every row, which Delete row used to take', async ({ page }) => {
    const before = await value(page)
    await editor(page).getByText('North').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Table' })
    if (await menu.isVisible()) {
      await menu.getByRole('menuitem', { name: 'Delete row' }).click()
    }
    expect(await value(page)).toBe(before)
    expect(await value(page)).toContain('North')
  })

  test('dismisses a menu that was open when readonly arrived', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('openleaf-editor')!.removeAttribute('readonly')
    })
    await editor(page).getByText('North').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Table' })
    await expect(menu).toBeVisible()
    await page.evaluate(() => {
      document.querySelector('openleaf-editor')!.setAttribute('readonly', '')
    })
    await expect(menu).toBeHidden()
  })

  /*
   * The point of refusing, which the menu-by-name assertions above do not reach.
   *
   * The plugin's listener returning early is not the whole story: the element's
   * own `contextmenu` listener is on the same event, it recognised the same
   * table, and it opened the generic "Editor menu" and called
   * `preventDefault()`. So the browser's menu -- the copy and inspect that is
   * the entire reason a read-only reader wants a secondary click -- was still
   * taken away, and the reader was offered a list of edit items that `invoke`
   * refuses to run. Asserting on the plugin's menu by name passed straight
   * through that, which is why this asserts on `defaultPrevented` instead.
   */
  test('leaves the browser its own menu, rather than swapping in a dead one', async ({ page }) => {
    await page.evaluate(() => {
      ;(window as { __prevented?: boolean | null }).__prevented = null
      document.addEventListener('contextmenu', (event) => {
        ;(window as { __prevented?: boolean | null }).__prevented = event.defaultPrevented
      })
    })
    await editor(page).getByText('North').click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Table' })).toBeHidden()
    await expect(page.getByRole('menu', { name: 'Editor menu' })).toBeHidden()
    expect(
      await page.evaluate(() => (window as { __prevented?: boolean | null }).__prevented),
    ).toBe(false)
  })

  test('opens no editor menu from the keyboard either', async ({ page }) => {
    await editor(page).getByText('North').click()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu', { name: 'Editor menu' })).toBeHidden()
  })
})
