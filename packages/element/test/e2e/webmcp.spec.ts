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

/** The handle for the first match, which is the only addressing a write has. */
async function handleFor(page: Page, id: string, text: string): Promise<string> {
  const result = await found(page, id, text)
  const handle = result.matches?.[0]?.handle
  expect(handle, `nothing matched "${text}" in ${id}`).toBeTruthy()
  return handle as string
}

interface WriteResult {
  ok: boolean
  id?: string
  error?: string
  message?: string
}

const write = (page: Page, args: Record<string, unknown>): Promise<WriteResult> =>
  call(page, 'openleaf_replace_at', args) as Promise<WriteResult>

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
    expect(await documentHtml(page, 'post-body')).toContain('<p>alpha beta</p>')
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
 * What this covers is the half only a browser can answer: that the search reads
 * the live document of the editor it was named, including text the author has
 * just typed into it. What a handle is worth after the document changes is
 * asserted twice -- as position arithmetic in
 * `packages/plugins-webmcp/test/handles.test.ts`, and end to end below, where a
 * handle taken before an edit is written through after it.
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
 * Writing, which is the half of the surface that can do damage.
 *
 * Every assertion here goes through `stored()` -- what the form would actually
 * post -- rather than through anything the plugin knows about itself. A write
 * that changed the editor's view and not the value the host submits would pass
 * any test that asked the plugin how it went.
 */
test.describe('writing to an editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the write tool, and does not claim it is read-only', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_replace_at')
    // The flag the client driving the agent reads to decide whether this is a
    // call to ask a person about first.
    expect(await annotations(page, 'openleaf_replace_at')).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    })
  })

  test('replaces the text a handle names', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await write(page, { id: 'post-body', handle, html: 'sigma' })).toEqual({
      ok: true,
      id: 'post-body',
    })
    await expect.poll(() => stored(page)).toContain('<p>alpha sigma</p>')
  })

  test('leaves preserved markup byte-identical', async ({ page }) => {
    // The guarantee the preservation layer makes to an author, under a writer
    // it was not designed against. The wrapper is stored as an opaque atom
    // carrying its own markup; a write two paragraphs away must not cost it a
    // byte, an attribute or a quote character.
    const before = await stored(page)
    const wrapper = '<div class="callout" data-callout-id="7"><p>Load-bearing wrapper.</p></div>'
    expect(before).toContain(wrapper)

    const handle = await handleFor(page, 'post-body', 'beta')
    await write(page, { id: 'post-body', handle, html: 'sigma' })
    await expect.poll(() => stored(page)).toContain('<p>alpha sigma</p>')
    expect(await stored(page)).toBe(before.replace('alpha beta', 'alpha sigma'))
  })

  test('sanitizes before it parses', async ({ page }) => {
    // The ordering the whole ticket turns on. Parsing first would hand the
    // preservation layer a `<div>` the schema does not recognize, and it would
    // keep the thing whole -- inline style and all -- for the life of the
    // document. Running the paste policy first means the style is gone before
    // the parser sees the markup, and an agent can put nothing into the
    // document that a person could not have pasted into it.
    const handle = await handleFor(page, 'post-body', 'beta')
    await write(page, {
      id: 'post-body',
      handle,
      html: '<div class="callout" style="position:fixed"><p>injected</p></div>',
    })
    await expect.poll(() => stored(page)).toContain('injected')
    expect(await stored(page)).not.toContain('position:fixed')
  })

  test('refuses content the paste policy leaves nothing of, and writes nothing', async ({
    page,
  }) => {
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    const result = await write(page, {
      id: 'post-body',
      handle,
      html: '<script>alert(1)</script>',
    })
    expect(result).toMatchObject({ ok: false, error: 'rejected-content' })
    expect(await stored(page)).toBe(before)
  })

  test('refuses a range covering preserved markup, and writes nothing', async ({ page }) => {
    // The reachable route to preserved content: the search stands an inline
    // atom in for one object-replacement character, so an agent that searches
    // for that character is handed a handle onto the `<ins>` this editor is
    // preserving. Refusing is what keeps the byte-identical promise true under
    // an agent that went looking.
    const before = await stored(page, 'notes')
    expect(before).toContain('<ins>tracked</ins>')

    const handle = await handleFor(page, 'editor-2', '\uFFFC')
    const result = await write(page, { id: 'editor-2', handle, html: 'plain' })
    expect(result).toMatchObject({ ok: false, error: 'preserved-region' })
    expect(await stored(page, 'notes')).toBe(before)
  })

  test('refuses a handle it has already spent, and writes nothing', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    await write(page, { id: 'post-body', handle, html: 'sigma' })
    await expect.poll(() => stored(page)).toContain('alpha sigma')

    // The text the handle named is gone, so the handle has to refuse rather
    // than land on whatever now sits at those positions.
    const after = await stored(page)
    const again = await write(page, { id: 'post-body', handle, html: 'tau' })
    expect(again).toMatchObject({ ok: false, error: 'stale-handle' })
    expect(await stored(page)).toBe(after)
  })

  test('writes through a handle taken before the author edited elsewhere', async ({ page }) => {
    // The end-to-end half of what handles exist for: an agent takes a handle,
    // the author types somewhere else while the agent is thinking, and the
    // write still lands on the text the agent read rather than two characters
    // to the left of it.
    const handle = await handleFor(page, 'post-body', 'beta')
    // Clicked at the left edge of the paragraph rather than moved there with
    // Home, which lands at the end of the line in WebKit and Firefox. The point
    // is only that the author's text goes in *before* the handle, so that the
    // positions it was issued against are the wrong ones by the time it is used.
    await editor(page).getByText('alpha beta').click({ position: { x: 2, y: 8 } })
    await page.keyboard.type('zulu ')
    await expect.poll(() => stored(page)).toContain('zulu alpha beta')

    expect(await write(page, { id: 'post-body', handle, html: 'sigma' })).toMatchObject({
      ok: true,
    })
    await expect.poll(() => stored(page)).toContain('zulu alpha sigma')
  })

  test('refuses a handle that belongs to another editor', async ({ page }) => {
    // Handles are page-unique, so the id is not needed to find the editor. It
    // is required so that an agent which has muddled two editors' handles gets
    // a refusal instead of a correct-looking write to the wrong document.
    const before = await stored(page, 'comment')
    const handle = await handleFor(page, 'post-body', 'beta')
    const result = await write(page, { id: 'comment-box', handle, html: 'sigma' })
    expect(result).toMatchObject({ ok: false, error: 'invalid-argument' })
    expect(result.message).toContain('post-body')
    expect(await stored(page, 'comment')).toBe(before)
  })
})
