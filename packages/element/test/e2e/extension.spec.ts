import { expect, test, type Page } from '@playwright/test'

const HARNESS = '/packages/element/test/e2e/harness-extension.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })
const value = (page: Page) => page.locator('#body').inputValue()

/** Node type names in the live document. */
function nodeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names: string[] = []
    const el = document.querySelector('openleaf-editor') as HTMLElement & {
      view: { state: { doc: { descendants: (f: (n: { type: { name: string } }) => boolean) => void } } }
    }
    el.view.state.doc.descendants((n) => {
      names.push(n.type.name)
      return true
    })
    return names
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test.describe('a schema extension registered from a later script tag', () => {
  test('reaches an editor declared before it', async ({ page }) => {
    // The whole point of the capability freeze. Custom-element upgrade runs
    // before the next <script>, so without deferring the build this node type
    // would not exist and the callout would be an opaque preserved atom.
    const types = await nodeTypes(page)
    expect(types).toContain('callout')
    expect(types).not.toContain('unknown_block')
  })

  test('renders the node with its own markup', async ({ page }) => {
    await expect(editor(page).locator('aside.ol-callout')).toBeVisible()
    await expect(editor(page).locator('aside.ol-callout')).toHaveAttribute('data-level', 'warn')
  })

  test('is editable, not an inert card', async ({ page }) => {
    const callout = editor(page).locator('aside.ol-callout')
    await callout.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' edited inside')
    await expect(callout).toContainText('edited inside')
    await expect.poll(() => value(page)).toContain('edited inside')
  })

  test('keeps attributes the extension never modelled', async ({ page }) => {
    // Claiming a tag would otherwise narrow fidelity: the preservation layer
    // kept every attribute, a node spec keeps what it declares.
    const stored = await value(page)
    expect(stored).toContain('id="keep-me"')
    expect(stored).toContain('data-analytics="x"')
    expect(stored).not.toContain('__openleaf')
  })

  test('round-trips the whole document unchanged', async ({ page }) => {
    const before = await value(page)
    await page.evaluate(() => {
      const el = document.querySelector('openleaf-editor') as HTMLElement & { value: string }
      el.value = el.value
    })
    await expect.poll(() => value(page)).toBe(before)
  })

  test('leaves surrounding content alone', async ({ page }) => {
    await expect(editor(page)).toContainText('Before.')
    await expect(editor(page)).toContainText('After.')
  })
})

test.describe('registering too late', () => {
  test('warns rather than silently doing nothing', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text())
    })

    await page.evaluate(() => {
      const core = (window as never as {
        OpenLeaf: { __runtime: Record<string, { registerSchemaExtension: (e: unknown) => void }> }
      }).OpenLeaf.__runtime['@openleaf/core']!
      core.registerSchemaExtension({
        id: 'test/too-late',
        nodes: {
          widget: {
            group: 'block',
            parseDOM: [{ tag: 'div.widget' }],
            toDOM: () => ['div', { class: 'widget' }, 0],
          },
        },
      })
    })

    // A document's schema is fixed when its editor is built. Saying so is much
    // better than a node type that mysteriously never appears.
    await expect.poll(() => warnings.join('\n')).toContain('schema is')
  })

  test('does not disturb the open editor', async ({ page }) => {
    const before = await value(page)
    await page.evaluate(() => {
      const core = (window as never as {
        OpenLeaf: { __runtime: Record<string, { registerSchemaExtension: (e: unknown) => void }> }
      }).OpenLeaf.__runtime['@openleaf/core']!
      core.registerSchemaExtension({ id: 'test/inert', nodes: {} })
    })
    await editor(page).click()
    await page.keyboard.type('still works')
    await expect.poll(() => value(page)).toContain('still works')
    expect(before).toContain('callout')
  })
})
