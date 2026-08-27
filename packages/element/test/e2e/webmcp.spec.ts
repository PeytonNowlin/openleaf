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

interface FoundText {
  ok: boolean
  error?: string
  message?: string
  matches?: { handle: string; context: string }[]
  truncated?: boolean
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

const found = (page: Page, id: string, text: string): Promise<FoundText> =>
  call(page, 'openleaf_find_text', { editor: id, text }) as Promise<FoundText>

/** The annotations the client driving the agent reads before it calls anything. */
function annotations(page: Page, name: string): Promise<unknown> {
  return page.evaluate((toolName) => {
    const host = globalThis as unknown as {
      OpenLeaf?: { agentTools?: { name: string; annotations: unknown }[] }
    }
    return host.OpenLeaf?.agentTools?.find((tool) => tool.name === toolName)?.annotations
  }, name)
}

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
    expect(await annotations(page, 'openleaf_list_editors')).toEqual({
      readOnlyHint: true,
      untrustedContentHint: false,
    })
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

/**
 * Searching, through the shipped bundle and against real editors.
 *
 * What a handle is worth after the document changes is asserted in
 * `packages/plugins-webmcp/test/handles.test.ts`, which can resolve one; no
 * tool consumes a handle yet, so there is nothing to drive from here. What this
 * covers is the half only a browser can answer: that the search reads the live
 * document of the editor it was named, including text the author has just
 * typed into it.
 */
test.describe('finding text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the search tool', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_find_text')
  })

  test('marks the search read-only, and what it returns untrusted', async ({ page }) => {
    // It reads the document and hands back the text around each match, so the
    // client driving the agent has to know that an instruction found in there
    // is content, not an instruction.
    expect(await annotations(page, 'openleaf_find_text')).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    })
  })

  test('returns a handle and the text around each match', async ({ page }) => {
    const result = await found(page, 'post-body', 'beta')
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.matches).toHaveLength(1)
    const [match] = result.matches ?? []
    expect(typeof match?.handle).toBe('string')
    expect(match?.handle.length).toBeGreaterThan(0)
    expect(match?.context).toContain('beta')
  })

  test('searches the editor it was named and no other', async ({ page }) => {
    // "gamma" is in the second editor only. A tool that searched the page, or
    // fell back to the first editor, would find it either way.
    expect((await found(page, 'post-body', 'gamma')).matches).toEqual([])
    expect((await found(page, 'editor-2', 'gamma')).matches).toHaveLength(1)
  })

  test('answers text that is not there with no matches, not a failure', async ({ page }) => {
    expect(await found(page, 'post-body', 'omega')).toEqual({
      ok: true,
      matches: [],
      truncated: false,
    })
  })

  test('refuses an editor it does not know, and says what to do instead', async ({ page }) => {
    const result = await found(page, 'no-such-editor', 'beta')
    expect(result).toMatchObject({ ok: false, error: 'unknown-editor' })
    expect(result.message).toContain('openleaf_list_editors')
  })

  test('hands back handles that say nothing about where they point', async ({ page }) => {
    const first = (await found(page, 'post-body', 'beta')).matches?.[0]?.handle
    const again = (await found(page, 'post-body', 'beta')).matches?.[0]?.handle
    expect(first).toBeTruthy()
    // Anything an agent can read out of a handle is something it will
    // eventually compute with, and a computed handle is a write to a position
    // nobody chose.
    expect(first).not.toContain('post-body')
    expect(first).not.toContain('beta')
    expect(first).not.toBe(again)
  })

  test('finds text the author has just typed', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' and beta again')
    // The search reads the editor's live state, not the markup the page loaded
    // with -- which is the whole reason it runs in a real browser.
    await expect.poll(async () => (await found(page, 'post-body', 'beta')).matches?.length).toBe(2)
  })
})
