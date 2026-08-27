import { expect, test, type Page } from '@playwright/test'

/**
 * The agent tool surface, driven through its descriptors rather than through a
 * browser flag.
 *
 * The package exposes its tool set as a plain value -- names, descriptions,
 * input schemas, and executable handlers -- and installing is a thin wrapper
 * that hands that value to the browser. So these tests call the handlers
 * directly, against real editors in a real browser, and run on all three
 * engines. `webmcp-registration.spec.ts` is the one test that proves the
 * browser half, in the one engine that has it.
 */

const HARNESS = '/packages/element/test/e2e/harness-webmcp.html'
const CORE_ONLY = '/packages/element/test/e2e/harness.html'

const editor = (page: Page) => page.getByRole('textbox', { name: 'Post body' })

interface ListedEditor {
  id: string
  label: string | null
}

/** The tool set as the script-tag bundle publishes it. */
function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = globalThis as unknown as { OpenLeaf?: { agentTools?: { name: string }[] } }
    return (host.OpenLeaf?.agentTools ?? []).map((tool) => tool.name)
  })
}

/** Call a tool's handler and parse the JSON string it returns. */
async function call(page: Page, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const raw = await page.evaluate(
    ([toolName, toolArgs]) => {
      const host = globalThis as unknown as {
        OpenLeaf?: { agentTools?: { name: string; execute: (a: unknown) => string }[] }
      }
      const tool = host.OpenLeaf?.agentTools?.find((candidate) => candidate.name === toolName)
      if (!tool) throw new Error(`no tool named ${String(toolName)}`)
      return tool.execute(toolArgs)
    },
    [name, args] as [string, Record<string, unknown>],
  )
  // Results are strings, because that is all the browser's execute path
  // returns. Every assertion below goes through the same decode an agent would.
  return JSON.parse(raw)
}

async function listed(page: Page): Promise<ListedEditor[]> {
  const result = (await call(page, 'openleaf_list_editors')) as { ok: boolean; editors: ListedEditor[] }
  expect(result.ok).toBe(true)
  return result.editors
}

const ids = async (page: Page): Promise<string[]> => (await listed(page)).map((one) => one.id)

test.describe('core bundle alone', () => {
  test('exposes no agent tools', async ({ page }) => {
    await page.goto(CORE_ONLY)
    await expect(editor(page)).toBeVisible()
    expect(await toolNames(page)).toEqual([])
  })
})

test.describe('with the agent tool bundle loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the editor-listing tool', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_list_editors')
  })

  test('marks the listing read-only and free of document content', async ({ page }) => {
    // What the client driving the agent reads before it decides whether to ask
    // a person. A read tool that claimed to write would get confirmed at every
    // call; one that returned document content without saying so would hand an
    // agent text aimed at it with no warning attached.
    const annotations = await page.evaluate(() => {
      const host = globalThis as unknown as {
        OpenLeaf?: { agentTools?: { name: string; annotations: unknown }[] }
      }
      return host.OpenLeaf?.agentTools?.find((t) => t.name === 'openleaf_list_editors')?.annotations
    })
    expect(annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false })
  })

  test('returns one entry per editor on the page', async ({ page }) => {
    expect(await listed(page)).toEqual([
      { id: 'post-body', label: 'Post body' },
      { id: 'editor-2', label: 'Notes' },
      { id: 'comment-box', label: 'Comment' },
    ])
  })

  test('names an editor by its host id, and falls back to an ordinal', async ({ page }) => {
    // The two halves of the identity rule in one assertion, because the fixture
    // is the only place they are both true at once: integrators give these
    // elements ids to bind them to a textarea, but the documented integrations
    // do not, so both paths are ordinary.
    const [first, second] = await ids(page)
    expect(first).toBe('post-body')
    expect(second).toMatch(/^editor-\d+$/)
  })

  test('stops offering an editor that was removed from the page', async ({ page }) => {
    await page.evaluate(() => document.getElementById('comment-box')?.remove())
    // Teardown is deferred by a microtask, so the editor is gone from the
    // document before it is gone from the register.
    await expect.poll(() => ids(page)).toEqual(['post-body', 'editor-2'])
  })

  test('offers an editor created after the bundle loaded', async ({ page }) => {
    await page.evaluate(() => {
      const area = document.createElement('textarea')
      area.id = 'late'
      area.name = 'late'
      area.hidden = true
      area.value = '<p>late</p>'
      const el = document.createElement('openleaf-editor')
      el.id = 'late-editor'
      el.setAttribute('for', 'late')
      el.setAttribute('aria-label', 'Late arrival')
      document.getElementById('post-form')?.append(area, el)
    })
    await expect.poll(() => ids(page)).toContain('late-editor')
  })

  test('keeps its identifiers when another plugin registers', async ({ page }) => {
    // Registering an editor plugin reconfigures the state, and ProseMirror
    // destroys and recreates every plugin view when it does. An identifier held
    // in the plugin view's closure would be reassigned on the way back up, so
    // the id an agent was handed one call ago would name nothing.
    const before = await ids(page)
    await page.evaluate(() => {
      const host = globalThis as unknown as {
        OpenLeaf: { __runtime: Record<string, { registerEditorPlugin: (f: () => []) => void }> }
      }
      host.OpenLeaf.__runtime['@openleaf-editor/core']!.registerEditorPlugin(() => [])
    })
    await expect.poll(() => ids(page)).toEqual(before)
  })
})
