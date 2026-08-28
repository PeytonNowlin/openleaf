import { expect, test, type Page } from '@playwright/test'
import { stored } from './stored.js'

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

interface Applied {
  ok: boolean
  error?: string
  message?: string
  id?: string
  command?: string
}

/** The handle for the first match of `text`, which is what an agent would hold. */
async function handleFor(page: Page, id: string, text: string): Promise<string> {
  const result = await found(page, id, text)
  const handle = result.matches?.[0]?.handle
  expect(handle, `no match for "${text}" in ${id}`).toBeTruthy()
  return handle as string
}

const applied = (page: Page, args: Record<string, unknown>): Promise<Applied> =>
  call(page, 'openleaf_apply_command', args) as Promise<Applied>

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
 * Applying a command, asserted through what the form would submit.
 *
 * The stored value is the only thing that answers the question the tool is for:
 * an agent said "bold this", and the host has to end up posting markup that has
 * it. Nothing here reaches for the register, the handle table or the
 * transaction marker.
 */
test.describe('applying a command', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the tool, and says it writes', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_apply_command')
    // The only tool here that is not read-only, which is what lets the client
    // driving the agent decide this is the call worth confirming with a person.
    expect(await annotations(page, 'openleaf_apply_command')).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    })
  })

  test('formats the text a handle names', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toEqual({
      ok: true,
      id: 'post-body',
      command: 'bold',
    })
    await expect.poll(() => stored(page)).toBe('<p>alpha <strong>beta</strong></p>')
  })

  test('lands as one undoable step', async ({ page }) => {
    // One transaction per call is what makes this true, and an author pressing
    // undo once is the only place it is observable from outside.
    const handle = await handleFor(page, 'post-body', 'beta')
    await applied(page, { id: 'post-body', command: 'bold', handle })
    await expect.poll(() => stored(page)).toContain('<strong>')
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => stored(page)).toBe('<p>alpha beta</p>')
  })

  test('leaves the other editors alone', async ({ page }) => {
    const handle = await handleFor(page, 'comment-box', 'delta')
    expect((await applied(page, { id: 'comment-box', command: 'italic', handle })).ok).toBe(true)
    await expect.poll(() => stored(page, 'comment')).toBe('<p><em>delta</em></p>')
    expect(await stored(page, 'body')).toBe('<p>alpha beta</p>')
  })

  test('refuses a command this editor does not offer, and writes nothing', async ({ page }) => {
    // `blockType` is registered on this page -- `post-body` carries it -- and is
    // not on the comment box's bar. The answer has to be per editor, because
    // restricting one editor is a layout decision rather than an uninstall.
    const handle = await handleFor(page, 'comment-box', 'delta')
    const result = await applied(page, { id: 'comment-box', command: 'blockType', handle })
    expect(result).toMatchObject({ ok: false, error: 'unknown-command' })
    expect(result.message).toContain('openleaf_get_capabilities')
    expect(await stored(page, 'comment')).toBe('<p>delta</p>')
  })

  test('refuses a command nothing on the page registered', async ({ page }) => {
    // No table bundle is loaded here, so `insertTable` exists in no registry --
    // which is exactly what `openleaf_get_capabilities` already reports.
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'post-body', command: 'insertTable', handle })).toMatchObject({
      ok: false,
      error: 'unknown-command',
    })
    expect(await stored(page)).toBe('<p>alpha beta</p>')
  })

  test('refuses a control that only works through the interface', async ({ page }) => {
    // `blockType` applies a heading, is registered, and is on this editor's bar
    // -- and builds its own control rather than being a command, so there is
    // nothing to run. Reporting it applied is the worst of the three answers:
    // the agent moves on believing the heading exists.
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'post-body', command: 'blockType', handle })).toMatchObject({
      ok: false,
      error: 'unsupported-command',
    })
    expect(await stored(page)).toBe('<p>alpha beta</p>')
  })

  test('everything it reports as a command is a command or an honest refusal', async ({ page }) => {
    // The pair of criteria in one assertion: nothing outside the capability
    // list can be applied, and nothing inside it answers "no such command".
    const handle = await handleFor(page, 'post-body', 'beta')
    for (const id of await commandIds(page, 'post-body')) {
      const result = await applied(page, { id: 'post-body', command: id, handle })
      expect(result.error, `${id} reported as offered but unknown`).not.toBe('unknown-command')
    }
  })

  test('refuses a handle whose text has been deleted', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('rewritten')
    await expect.poll(() => stored(page)).toContain('rewritten')
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'stale-handle',
    })
  })

  test('refuses a handle from another editor', async ({ page }) => {
    const handle = await handleFor(page, 'editor-2', 'gamma')
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
    expect(await stored(page)).toBe('<p>alpha beta</p>')
    expect(await stored(page, 'notes')).toBe('<p>gamma</p>')
  })

  test('refuses an editor that is not on the page', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'no-such-editor', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'unknown-editor',
    })
  })

  test('refuses while the author is editing the HTML by hand', async ({ page }) => {
    // Source view disables every toolbar control, because a command applied
    // here runs against the hidden document that closing the view parses over
    // the top of -- the change would be reported and then thrown away.
    const handle = await handleFor(page, 'post-body', 'beta')
    await page.evaluate(() => {
      const host = document.getElementById('post-body') as HTMLElement & { sourceMode: boolean }
      host.sourceMode = true
    })
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'refused',
    })
  })
})
