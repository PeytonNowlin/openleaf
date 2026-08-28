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
  id?: string
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

const insert = (page: Page, args: Record<string, unknown>): Promise<WriteResult> =>
  call(page, 'openleaf_insert_html', args) as Promise<WriteResult>

interface Applied {
  ok: boolean
  error?: string
  message?: string
  id?: string
  command?: string
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
      id: 'post-body',
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
    // Three blocks, and the middle one is the preserved callout the write
    // tests lean on. It is listed rather than skipped: only an *empty
    // textblock* is left out, and a preserved atom's type is the whole of what
    // an agent needs to know it is there.
    expect(result.outline).toEqual([
      { handle: expect.any(String), type: 'paragraph', text: 'alpha beta' },
      { handle: expect.any(String), type: 'unknown_block', text: '' },
      { handle: expect.any(String), type: 'paragraph', text: 'tail' },
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
    // The caret is placed through the view rather than by clicking and pressing
    // End. A click that lands in the preserved callout, or a keypress that
    // arrives before the click has moved the caret, both type at position 0 --
    // which reads as "Enter did nothing" and was flaky in exactly that way.
    // Same idiom as keyboard.spec.ts: end of the first paragraph, by arithmetic.
    await page.evaluate(() => {
      const host = document.querySelector('#post-body') as HTMLElement & {
        view?: {
          state: { doc: { firstChild: { content: { size: number } } | null }; selection: unknown; tr: unknown }
          dispatch(tr: unknown): void
          focus(): void
        }
      }
      const view = host.view
      if (!view) throw new Error('no view')
      const first = view.state.doc.firstChild
      if (!first) throw new Error('no first paragraph')
      const TextSelection = (view.state.selection as { constructor: unknown })
        .constructor as { create(doc: unknown, anchor: number): unknown }
      const tr = view.state.tr as { setSelection(sel: unknown): unknown }
      view.dispatch(tr.setSelection(TextSelection.create(view.state.doc, 1 + first.content.size)))
      view.focus()
    })
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.type('a second paragraph')
    // The live document, not the markup the page loaded with -- which is the
    // whole reason this runs in a real browser.
    await expect
      .poll(async () => ((await structure(page, 'post-body')).outline ?? []).map((one) => one.text))
      .toEqual(['alpha beta', 'a second paragraph', '', 'tail'])
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

  test('lands as one undoable step', async ({ page }) => {
    // "Exactly one transaction per call" is a property of `writeAt` rather than
    // a rule each tool keeps, and one press of undo is where an author sees it:
    // a call that dispatched the staging and the change separately would take
    // two presses to put back, and the first would leave the document in a
    // state nobody asked for. Counted in jsdom by `write.test.ts`; this is the
    // same claim where it is felt, through what the form would post.
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    await write(page, { id: 'post-body', handle, html: 'sigma' })
    await expect.poll(() => stored(page)).toContain('<p>alpha sigma</p>')

    // Aimed at the paragraph rather than at the editor's centre, which lands in
    // the preserved callout the fixture carries.
    await editor(page).getByText('alpha sigma').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => stored(page)).toBe(before)
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

  test('does not let the HTML choose which normalizer runs', async ({ page }) => {
    // The sanitizer dispatches on where the markup looks like it came from, and
    // one of its branches keeps inline styles: `data-pm-slice` is what
    // ProseMirror stamps on its own clipboard HTML, and a copy out of this
    // editor is in the same trust domain as where it is going. An agent writes
    // its own argument, so that signal is one it can set for itself -- and the
    // whole promise here is that it cannot introduce markup a person could not
    // have pasted. Byte-for-byte the fixture above, plus the attribute.
    const handle = await handleFor(page, 'post-body', 'beta')
    await write(page, {
      id: 'post-body',
      handle,
      html: '<div class="callout" data-pm-slice="1 1 []" style="position:fixed"><p>injected</p></div>',
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

/**
 * Inserting, which differs from replacement in one thing an agent can see.
 *
 * The stored value is again what everything here asserts on. The refusal is
 * the case worth a browser: a heading aimed into the middle of a sentence is
 * something the fitting would have answered by splitting the paragraph, and a
 * split paragraph is exactly the kind of "success" that only looks wrong in
 * the markup the host ends up posting.
 */
test.describe('inserting into an editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('offers the insert tool, and does not claim it is read-only', async ({ page }) => {
    expect(await toolNames(page)).toContain('openleaf_insert_html')
    expect(await annotations(page, 'openleaf_insert_html')).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    })
  })

  test('adds a block beside the one an outline named', async ({ page }) => {
    // The two tools an agent actually chains: outline the document, then insert
    // against an entry of it. Its own editor rather than the fixture's, because
    // two other specs assert on what the fixture's three contain.
    await addEditor(page, 'draft', '<h2>Title</h2><p>alpha</p>')
    const outline = (await structure(page, 'draft')).outline ?? []
    const handle = outline[0]?.handle as string
    expect(
      await insert(page, { id: 'draft', handle, html: '<p>intro</p>', position: 'after' }),
    ).toEqual({ ok: true, id: 'draft' })

    await expect.poll(() => stored(page, 'draft-value')).toContain('<p>intro</p>')
    const html = await stored(page, 'draft-value')
    expect(html.indexOf('<p>intro</p>')).toBeGreaterThan(html.indexOf('<h2>Title</h2>'))
    expect(html.indexOf('<p>intro</p>')).toBeLessThan(html.indexOf('<p>alpha</p>'))
  })

  test('adds inline content beside the text a handle names, leaving it there', async ({ page }) => {
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(
      await insert(page, { id: 'post-body', handle, html: '<strong>!</strong>', position: 'after' }),
    ).toMatchObject({ ok: true })
    await expect.poll(() => stored(page)).toContain('<p>alpha beta<strong>!</strong></p>')
  })

  test('leaves the handle usable, unlike a replacement', async ({ page }) => {
    // Nothing the handle named was deleted, so it still names it. An agent that
    // is building a sentence up in pieces depends on this.
    const handle = await handleFor(page, 'post-body', 'beta')
    await insert(page, { id: 'post-body', handle, html: '(', position: 'before' })
    expect(await insert(page, { id: 'post-body', handle, html: ')', position: 'after' })).toMatchObject({
      ok: true,
    })
    await expect.poll(() => stored(page)).toContain('<p>alpha (beta)</p>')
  })

  test('refuses a block inside a sentence, and writes nothing', async ({ page }) => {
    // The acceptance criterion with content in it. Fitting this in would mean
    // cutting the paragraph in two around the heading -- a document nobody
    // asked for, handed back as a success.
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    const result = await insert(page, {
      id: 'post-body',
      handle,
      html: '<h2>Title</h2>',
      position: 'after',
    })
    expect(result).toMatchObject({ ok: false, error: 'invalid-position' })
    // The message names what the position does hold, which is the difference
    // between a refusal an agent can act on and one it can only repeat.
    expect(result.message).toContain('paragraph')
    expect(await stored(page)).toBe(before)
  })

  test('refuses a handle covering preserved markup, and writes nothing', async ({ page }) => {
    const before = await stored(page, 'notes')
    const handle = await handleFor(page, 'editor-2', '\uFFFC')
    const result = await insert(page, { id: 'editor-2', handle, html: 'plain', position: 'before' })
    expect(result).toMatchObject({ ok: false, error: 'preserved-region' })
    expect(await stored(page, 'notes')).toBe(before)
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
    // `toContain` rather than an equality: `post-body` also carries the
    // preserved callout the write tests lean on, and this assertion is about
    // the paragraph the handle named.
    await expect.poll(() => stored(page)).toContain('<p>alpha <strong>beta</strong></p>')
  })

  test('lands as one undoable step', async ({ page }) => {
    // One transaction per call is what makes this true, and an author pressing
    // undo once is the only place it is observable from outside.
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    await applied(page, { id: 'post-body', command: 'bold', handle })
    await expect.poll(() => stored(page)).toContain('<strong>')
    // Aimed at the paragraph rather than at the editor's centre, which lands in
    // the preserved callout the fixture carries.
    await editor(page).getByText('alpha beta').click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => stored(page)).toBe(before)
  })

  test('leaves the other editors alone', async ({ page }) => {
    const untouched = await stored(page, 'body')
    const handle = await handleFor(page, 'comment-box', 'delta')
    expect((await applied(page, { id: 'comment-box', command: 'italic', handle })).ok).toBe(true)
    await expect.poll(() => stored(page, 'comment')).toBe('<p><em>delta</em></p>')
    expect(await stored(page, 'body')).toBe(untouched)
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
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'post-body', command: 'insertTable', handle })).toMatchObject({
      ok: false,
      error: 'unknown-command',
    })
    expect(await stored(page)).toBe(before)
  })

  test('refuses a control that only works through the interface', async ({ page }) => {
    // `blockType` applies a heading, is registered, and is on this editor's bar
    // -- and builds its own control rather than being a command, so there is
    // nothing to run. Reporting it applied is the worst of the three answers:
    // the agent moves on believing the heading exists.
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    expect(await applied(page, { id: 'post-body', command: 'blockType', handle })).toMatchObject({
      ok: false,
      error: 'unsupported-command',
    })
    expect(await stored(page)).toBe(before)
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
    const before = await stored(page)
    const notes = await stored(page, 'notes')
    const handle = await handleFor(page, 'editor-2', 'gamma')
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'invalid-argument',
    })
    expect(await stored(page)).toBe(before)
    expect(await stored(page, 'notes')).toBe(notes)
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

/**
 * The integrator's veto over every call.
 *
 * Driven through the script tag's own escape hatch rather than through
 * `installAgentTools({ allowTool })`, because that bundle installs on load: by
 * the time a page's own script runs, the options argument is already spent.
 * This is therefore the exact path a CMS integrator takes.
 */
type Policy = 'clear' | 'allow-all' | 'deny-all' | 'reads-only' | 'not-comment-box' | 'throws'

async function policy(page: Page, which: Policy): Promise<void> {
  await page.evaluate((mode) => {
    interface Call {
      tool: string
      editor: string | null
      readOnly: boolean
    }
    const host = globalThis as unknown as {
      OpenLeaf?: { registerAgentPermission?: (allow: ((call: Call) => boolean) | null) => void }
    }
    const register = host.OpenLeaf?.registerAgentPermission
    if (!register) throw new Error('the bundle exposes no registerAgentPermission')
    // `clear` and `allow-all` are here to be *ignored*: the setting is
    // set-once, so a second call is how a later script would try to take the
    // integrator's policy off, and it must not work.
    if (mode === 'clear') return register(null)
    if (mode === 'allow-all') return register(() => true)
    if (mode === 'deny-all') return register(() => false)
    // No tool is named in either of these two, which is the point of the
    // request carrying `readOnly` and `editor` at all: a policy written today
    // still means what its author meant after a tool is added.
    if (mode === 'reads-only') return register(({ readOnly }) => readOnly)
    if (mode === 'not-comment-box') return register(({ editor }) => editor !== 'comment-box')
    return register(() => {
      throw new Error('the host session store was unreachable')
    })
  }, which)
}

test.describe('a page that refuses calls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
  })

  test('refuses every tool, the listing included', async ({ page }) => {
    await policy(page, 'deny-all')
    // The listing takes no editor, so nothing it does resolves an argument --
    // and it is still gated, because the gate is applied where the tool set is
    // composed rather than inside a handler.
    for (const name of await toolNames(page)) {
      expect(await call(page, name, { id: 'post-body' }), name).toMatchObject({
        ok: false,
        error: 'refused',
      })
    }
  })

  test('allows reads and refuses writes, and the refused write stores nothing', async ({ page }) => {
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    await policy(page, 'reads-only')

    expect(await documentHtml(page, 'post-body')).toContain('alpha beta')
    expect(await write(page, { id: 'post-body', handle, html: 'sigma' })).toMatchObject({
      ok: false,
      error: 'refused',
    })
    expect(await applied(page, { id: 'post-body', command: 'bold', handle })).toMatchObject({
      ok: false,
      error: 'refused',
    })
    // What the form would post, which is the only place a partial write could
    // hide: the gate runs before anything touches the view, so a refusal is not
    // a write that was undone, it is not a write.
    expect(await stored(page)).toBe(before)
  })

  test('refuses one editor and leaves the others alone', async ({ page }) => {
    await policy(page, 'not-comment-box')
    expect(await documentHtml(page, 'post-body')).toContain('alpha beta')
    expect(await call(page, 'openleaf_get_document', { id: 'comment-box' })).toMatchObject({
      ok: false,
      error: 'refused',
    })
  })

  test('treats a predicate that throws as a refusal, not as a crashed call', async ({ page }) => {
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    await policy(page, 'throws')

    // A throw out of a handler reaches the agent as a rejected call with no
    // shape to it and nothing to retry against -- and it would reach it here as
    // a Playwright evaluation error, which is what this asserts is not thrown.
    const result = await write(page, { id: 'post-body', handle, html: 'sigma' })
    expect(result).toMatchObject({ ok: false, error: 'refused' })
    expect(result.message).not.toContain('session store')
    expect(await stored(page)).toBe(before)
  })

  test('keeps the first policy against a second script that tries to undo it', async ({ page }) => {
    // The escape hatch is a function on the page's own global, so everything
    // else on the page can reach it. It is set-once for that reason: neither a
    // permissive predicate nor a clear may take the integrator's policy off,
    // and the write has to still be refused and still store nothing after both.
    const before = await stored(page)
    const handle = await handleFor(page, 'post-body', 'beta')
    await policy(page, 'deny-all')

    await policy(page, 'allow-all')
    expect(await write(page, { id: 'post-body', handle, html: 'sigma' })).toMatchObject({
      ok: false,
      error: 'refused',
    })

    await policy(page, 'clear')
    expect(await write(page, { id: 'post-body', handle, html: 'sigma' })).toMatchObject({
      ok: false,
      error: 'refused',
    })
    expect(await stored(page)).toBe(before)
  })
})

/**
 * Undo, from the author's side of the keyboard.
 *
 * The unit tests in `packages/plugins-webmcp/test/undo-grouping.test.ts` count
 * history events, which is where the grouping rules are legible. These are the
 * claim the rules exist to support and the only place it can be made: a real
 * element, with the `history()` it actually installs, and a real Ctrl+Z.
 */
test.describe('undoing what an agent wrote', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS)
    await expect(editor(page)).toBeVisible()
    // Focus, so the keystrokes below reach the editor's keymap. Clicking sets
    // a selection and changes no content, which is exactly what an author
    // watching an agent work does.
    await editor(page).click()
  })

  test('takes back a whole run of agent writes in one press', async ({ page }) => {
    const before = await stored(page)

    await write(page, {
      id: 'post-body',
      handle: await handleFor(page, 'post-body', 'alpha'),
      html: 'one',
    })
    await write(page, {
      id: 'post-body',
      handle: await handleFor(page, 'post-body', 'beta'),
      html: 'two',
    })
    await write(page, {
      id: 'post-body',
      handle: await handleFor(page, 'post-body', 'tail'),
      html: 'three',
    })
    await expect.poll(() => stored(page)).toContain('<p>one two</p>')

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => stored(page)).toBe(before)

    // And back again, whole: an author who undid to look at the original and
    // then changed their mind gets the agent's work back in one press.
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => stored(page)).toContain('<p>one two</p>')
  })

  test('leaves an edit the author made in the middle of the run', async ({ page }) => {
    await write(page, {
      id: 'post-body',
      handle: await handleFor(page, 'post-body', 'alpha'),
      html: 'one',
    })
    await expect.poll(() => stored(page)).toContain('<p>one beta</p>')

    // The author types in the paragraph the agent has not touched. Clicked at
    // the left edge rather than moved with Home, which lands at the end of the
    // line in WebKit and Firefox.
    await editor(page).getByText('tail').click({ position: { x: 2, y: 8 } })
    await page.keyboard.type('mine ')
    await expect.poll(() => stored(page)).toContain('<p>mine tail</p>')

    await write(page, {
      id: 'post-body',
      handle: await handleFor(page, 'post-body', 'beta'),
      html: 'two',
    })
    await expect.poll(() => stored(page)).toContain('<p>one two</p>')

    // One press takes back the agent's second write and nothing else. The
    // author's sentence is their own undo step, which is the point: an agent's
    // run must not swallow work the person did while it was thinking.
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => stored(page)).toContain('<p>one beta</p>')
    expect(await stored(page)).toContain('<p>mine tail</p>')
  })
})
