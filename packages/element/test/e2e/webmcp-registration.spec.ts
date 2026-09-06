import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

/**
 * The one test that launches a flagged browser.
 *
 * Everything else about this feature is asserted through the tool descriptors,
 * which need no browser API at all -- deliberately, because the API has been
 * renamed twice and a suite pinned to it would break on the next rename rather
 * than on a real regression. That leaves one thing unproven: whether the
 * descriptors ever actually reach a browser. This is that test.
 *
 * It runs in the `chromium-webmcp` Playwright project, which is Chromium
 * launched with `--enable-blink-features=WebMCP`. The skip below is belt and
 * braces for anyone running the spec by hand against another engine.
 */

/**
 * The browser API, declared here because no `lib.dom` ships it yet.
 *
 * Only the members this spec drives, and only the shapes a probe against
 * Chrome for Testing 151 actually measured: `executeTool` takes the tool object
 * from `getTools()` -- not its name -- and a JSON *string* of arguments, and
 * resolves to a string.
 */
interface RegisteredTool {
  name: string
  title: string
  description: string
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
}

interface ModelContext {
  getTools(): Promise<RegisteredTool[]>
  executeTool(tool: RegisteredTool, args: string): Promise<string>
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
  interface Navigator {
    modelContext?: ModelContext
  }
}

test.skip(({ browserName }) => browserName !== 'chromium', 'WebMCP is a Chromium blink feature')

const HARNESS = '/packages/element/test/e2e/harness-webmcp.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })

/** Tool names as the BROWSER lists them, not as the package declares them. */
function registeredTools(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = document.modelContext ?? navigator.modelContext
    if (!context) throw new Error('no modelContext -- is --enable-blink-features=WebMCP set?')
    return (await context.getTools()).map((tool) => tool.name)
  })
}

/** Run a tool through the browser's own execute path and decode the result. */
async function executeThroughBrowser<T = { ok: boolean; editors: { id: string }[] }>(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const raw = await page.evaluate(
    async ([toolName, toolArgs]) => {
      const context = document.modelContext ?? navigator.modelContext
      if (!context) throw new Error('no modelContext -- is --enable-blink-features=WebMCP set?')
      const tool = (await context.getTools()).find((candidate) => candidate.name === toolName)
      if (!tool) throw new Error(`the browser is not offering ${String(toolName)}`)
      const result = await context.executeTool(tool, JSON.stringify(toolArgs))
      // The reason every tool in this package encodes its result: a string is
      // all that comes back, so structure has to be inside it.
      if (typeof result !== 'string') throw new Error(`executeTool returned a ${typeof result}`)
      return result
    },
    [name, args] as [string, Record<string, unknown>],
  )
  return JSON.parse(raw) as T
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  await expect(editor(page)).toBeVisible()
})

test('the browser has the API this package is built against', async ({ page }) => {
  // If this fails, the flag or the property name has moved, and every other
  // failure in this file is downstream of that one fact.
  const where = await page.evaluate(() => ({
    document: 'modelContext' in document,
    navigator: 'modelContext' in navigator,
  }))
  expect(where.document || where.navigator).toBe(true)
})

test("the tools appear in the browser's own listing", async ({ page }) => {
  // `registerTool` is asynchronous, so the listing is populated a turn after
  // the bundle's script tag has run.
  await expect.poll(() => registeredTools(page)).toContain('openleaf_list_editors')
})

test("the editors are listed through the browser's own execute path", async ({ page }) => {
  await expect.poll(() => registeredTools(page)).toContain('openleaf_list_editors')
  const result = await executeThroughBrowser(page, 'openleaf_list_editors', {})
  expect(result.ok).toBe(true)
  expect(result.editors.map((one) => one.id)).toEqual(['post-body', 'editor-2', 'comment-box'])
})

test('an editor destroyed on the page stops being offered', async ({ page }) => {
  await expect.poll(() => registeredTools(page)).toContain('openleaf_list_editors')
  await page.evaluate(() => document.getElementById('comment-box')?.remove())
  await expect
    .poll(async () => (await executeThroughBrowser(page, 'openleaf_list_editors', {})).editors.map((one) => one.id))
    .toEqual(['post-body', 'editor-2'])
})

test('the demo offers its editors and accepts an undoable browser-agent edit', async ({ page }) => {
  // The harness cannot catch a missing script tag or a registration-order bug
  // in the demo's full combination of plugin bundles.
  await page.goto('/demo/index.html')
  const post = page.locator('openleaf-editor[for="body"]')
  await expect(post.getByRole('textbox')).toBeVisible()
  await expect.poll(() => registeredTools(page)).toContain('openleaf_replace_at')
  const listed = await executeThroughBrowser<{
    ok: boolean
    editors: { id: string; label: string | null }[]
  }>(page, 'openleaf_list_editors', {})
  expect(listed.ok).toBe(true)
  expect(listed.editors).toHaveLength(await page.locator('openleaf-editor').count())
  const id = listed.editors.find((one) => one.label === 'Post body')?.id
  expect(id).toBeDefined()
  const before = await stored(page)
  const found = await executeThroughBrowser<{ ok: boolean; matches: { handle: string }[] }>(
    page, 'openleaf_find_text', { id, text: 'Try editing this' },
  )
  expect(found.ok).toBe(true)
  expect(found.matches).toHaveLength(1)
  const replaced = await executeThroughBrowser<{ ok: boolean }>(page, 'openleaf_replace_at', {
    id,
    handle: found.matches[0]?.handle,
    html: 'Edited through WebMCP',
  })
  expect(replaced.ok).toBe(true)
  await expect(post.getByRole('heading', { name: 'Edited through WebMCP' })).toBeVisible()
  expect(await stored(page)).toContain('Edited through WebMCP')
  await post.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await stored(page)).toBe(before)
})
