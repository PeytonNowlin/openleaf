import { expect, test, type Page } from '@playwright/test'

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
async function executeThroughBrowser(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; editors: { id: string }[] }> {
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
  return JSON.parse(raw) as { ok: boolean; editors: { id: string }[] }
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
