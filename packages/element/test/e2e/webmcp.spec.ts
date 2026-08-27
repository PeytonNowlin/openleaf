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

interface Capabilities {
  ok: boolean
  id: string
  nodes: string[]
  marks: string[]
  commands: { id: string; label: string }[]
}

async function capabilities(page: Page, id: string): Promise<Capabilities> {
  const result = (await call(page, 'openleaf_get_capabilities', { id })) as Capabilities
  expect(result.ok).toBe(true)
  return result
}

/**
 * The command ids, sorted.
 *
 * Order is not part of the contract -- the tools walk the registry, so it is
 * whatever order the deployment's plugins happened to register in -- and a test
 * that pinned it would fail the day a plugin moves its own registration.
 */
const commandIds = async (page: Page, id: string): Promise<string[]> =>
  (await capabilities(page, id)).commands.map((command) => command.id).sort()

async function documentHtml(page: Page, id: string): Promise<string> {
  const result = (await call(page, 'openleaf_get_document', { id })) as {
    ok: boolean
    html: string
  }
  expect(result.ok).toBe(true)
  return result.html
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

  test('offers the capability and content tools', async ({ page }) => {
    expect(await toolNames(page)).toEqual(
      expect.arrayContaining(['openleaf_get_capabilities', 'openleaf_get_document']),
    )
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

test.describe('what an editor can do', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('reports the schema types the document can hold', async ({ page }) => {
    const caps = await capabilities(page, 'post-body')
    expect(caps.id).toBe('post-body')
    expect(caps.nodes).toEqual(expect.arrayContaining(['paragraph', 'heading', 'table']))
    expect(caps.marks).toEqual(expect.arrayContaining(['strong', 'em', 'link']))
  })

  test('reports the commands this editor offers, not every command there is', async ({ page }) => {
    // The layout is the per-editor half: `registerToolbarItem` is page-global,
    // so an editor is restricted by the `toolbar` attribute it was given rather
    // than by anything being uninstalled.
    expect(await commandIds(page, 'post-body')).toEqual([
      'blockType',
      'bold',
      'italic',
      'redo',
      'source',
      'undo',
    ])
    // Registered on this page -- every editor here renders a bar with a source
    // toggle -- and still absent from the narrow editor's answer.
    expect(await commandIds(page, 'comment-box')).toEqual(['bold', 'italic'])
  })

  test('says a restricted editor cannot apply a heading, and still stores one', async ({ page }) => {
    // The divergence the whole tool exists for, in one editor. `blockType` is
    // the control that applies a heading; this bar does not carry it. Reporting
    // only the schema would promise an agent an edit that cannot happen, and
    // reporting only the commands would tell it a stored heading is unreadable.
    const caps = await capabilities(page, 'comment-box')
    expect(caps.commands.map((command) => command.id)).not.toContain('blockType')
    expect(caps.nodes).toContain('heading')
  })

  test('says the document can hold a table this deployment cannot build', async ({ page }) => {
    // The other half, and the one that bites without anyone choosing it: table
    // nodes are in the base schema so a stored document round-trips, while the
    // editing chrome for them is an opt-in bundle this page never loads.
    const caps = await capabilities(page, 'post-body')
    expect(caps.nodes).toEqual(expect.arrayContaining(['table', 'table_row', 'table_cell']))
    expect(caps.commands.map((command) => command.id)).not.toContain('insertTable')
  })

  test('names every command it reports', async ({ page }) => {
    // The id is what a later call passes back; the label is the only thing that
    // tells an agent what `blockType` is for.
    const caps = await capabilities(page, 'post-body')
    for (const command of caps.commands) expect(command.label.length).toBeGreaterThan(0)
  })

  test('fails clearly on an editor that is not on the page', async ({ page }) => {
    expect(await call(page, 'openleaf_get_capabilities', { id: 'no-such-editor' })).toEqual({
      ok: false,
      error: 'unknown-editor',
      message: expect.stringContaining('openleaf_list_editors'),
    })
  })
})

test.describe('reading an editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('returns the content as HTML', async ({ page }) => {
    expect(await documentHtml(page, 'post-body')).toBe('<p>alpha beta</p>')
    // Each editor answers for itself, which is the whole reason the id is
    // required rather than there being a "current" editor.
    expect(await documentHtml(page, 'comment-box')).toBe('<p>delta</p>')
  })

  test('returns what the author has typed but not yet saved', async ({ page }) => {
    // What the form would submit right now, not what it was loaded with: an
    // agent asked to fix a sentence has to read the sentence in front of the
    // author.
    await editor(page).click()
    await page.keyboard.type('zeta ')
    await expect.poll(() => documentHtml(page, 'post-body')).toContain('zeta')
  })

  test('marks the content untrusted and the read read-only', async ({ page }) => {
    // The annotation this package exists to get right: a document is where text
    // aimed at the agent reading it hides, and this is what tells the client
    // driving the agent to treat it as data.
    const annotations = await page.evaluate(() => {
      const host = globalThis as unknown as {
        OpenLeaf?: { agentTools?: { name: string; annotations: unknown }[] }
      }
      return host.OpenLeaf?.agentTools?.find((t) => t.name === 'openleaf_get_document')?.annotations
    })
    expect(annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
  })

  test('fails clearly on an editor that was removed from the page', async ({ page }) => {
    await page.evaluate(() => document.getElementById('comment-box')?.remove())
    await expect.poll(() => ids(page)).not.toContain('comment-box')
    expect(await call(page, 'openleaf_get_document', { id: 'comment-box' })).toEqual({
      ok: false,
      error: 'unknown-editor',
      message: expect.stringContaining('openleaf_list_editors'),
    })
  })

  test('fails rather than guessing when no editor is named', async ({ page }) => {
    // Nothing validates an agent's arguments against the schema on the way in.
    expect(await call(page, 'openleaf_get_document', {})).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
  })
})
