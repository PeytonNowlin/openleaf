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

const found = (page: Page, id: string, text: string): Promise<FoundText> =>
  call(page, 'openleaf_find_text', { id, text }) as Promise<FoundText>

interface OutlineEntry {
  handle: string
  type: string
  level?: number
  text: string
}

interface Structure {
  ok: boolean
  id?: string
  outline?: OutlineEntry[]
  truncated?: boolean
}

const structure = (page: Page, id: string): Promise<Structure> =>
  call(page, 'openleaf_get_structure', { id }) as Promise<Structure>

/**
 * Mount another editor on the harness, with content of this test's choosing.
 *
 * The fixture's three editors are shared with every other spec here, so a test
 * that needs a document of a particular shape brings its own rather than
 * rewriting one they all assert against. This is also the path a CMS takes when
 * it reveals an editor after the page has loaded.
 */
async function addEditor(page: Page, id: string, html: string): Promise<void> {
  await page.evaluate(
    ([editorId, value]) => {
      const area = document.createElement('textarea')
      area.id = `${editorId}-value`
      area.name = editorId
      area.hidden = true
      area.value = value
      const el = document.createElement('openleaf-editor')
      el.id = editorId
      el.setAttribute('for', `${editorId}-value`)
      el.setAttribute('aria-label', editorId)
      document.getElementById('post-form')?.append(area, el)
    },
    [id, html] as [string, string],
  )
  await expect.poll(() => ids(page)).toContain(id)
}

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
    expect(await annotations(page, 'openleaf_get_document')).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    })
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

/**
 * Outlining, through the shipped bundle and against real editors.
 *
 * The shape of an outline, what it leaves out and what a handle taken from one
 * is worth after an edit are asserted in
 * `packages/plugins-webmcp/test/structure.test.ts`, which can resolve a handle.
 * What this covers is the half only a browser can answer: that the outline
 * describes the live document of the editor it was named -- including the
 * blocks the author has only just typed -- and that a document loaded into a
 * real editor outlines the way the fixture says it does.
 */
test.describe('outlining a document', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the outline tool', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_get_structure')
  })

  test('marks the outline read-only, and what it returns untrusted', async ({ page }) => {
    // An outline is shorter than the document, which is not the same as safer
    // than the document: it is made of the document's own headings.
    expect(await annotations(page, 'openleaf_get_structure')).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    })
  })

  test('names each block of the editor it was asked about', async ({ page }) => {
    const result = await structure(page, 'post-body')
    expect(result.id).toBe('post-body')
    expect(result.truncated).toBe(false)
    expect(result.outline).toEqual([
      { handle: expect.any(String), type: 'paragraph', text: 'alpha beta' },
    ])
  })

  test('describes a heading without handing back the document', async ({ page }) => {
    await addEditor(page, 'structured', '<h2>Introduction</h2><p>alpha <strong>beta</strong></p>')
    const entries = (await structure(page, 'structured')).outline ?? []
    expect(entries.map((entry) => [entry.type, entry.level, entry.text])).toEqual([
      ['heading', 2, 'Introduction'],
      ['paragraph', undefined, 'alpha beta'],
    ])
    // The point of the tool beside `openleaf_get_document`: an agent asked to
    // retitle one section of fifty must not have to read the other forty-nine.
    for (const entry of entries) expect(entry.text).not.toContain('<')
  })

  test('outlines an empty editor as an empty outline, not as a failure', async ({ page }) => {
    await addEditor(page, 'blank', '')
    expect(await call(page, 'openleaf_get_structure', { id: 'blank' })).toEqual({
      ok: true,
      id: 'blank',
      outline: [],
      truncated: false,
    })
  })

  test('describes the blocks the author has just typed', async ({ page }) => {
    await editor(page).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('a second paragraph')
    // The live document, not the markup the page loaded with -- which is the
    // whole reason this runs in a real browser.
    await expect
      .poll(async () => ((await structure(page, 'post-body')).outline ?? []).map((one) => one.text))
      .toEqual(['alpha beta', 'a second paragraph'])
  })

  test('hands back a handle per entry, and says nothing in it', async ({ page }) => {
    const [entry] = (await structure(page, 'post-body')).outline ?? []
    expect(entry?.handle.length).toBeGreaterThan(0)
    expect(entry?.handle).not.toContain('post-body')
    expect(entry?.handle).not.toContain('alpha')
  })

  test('refuses an editor it does not know, and says what to do instead', async ({ page }) => {
    expect(await call(page, 'openleaf_get_structure', { id: 'no-such-editor' })).toEqual({
      ok: false,
      error: 'unknown-editor',
      message: expect.stringContaining('openleaf_list_editors'),
    })
  })
})
