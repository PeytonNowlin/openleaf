import { DEFAULT_LAYOUT } from '@openleaf-editor/ui'
import { describe, expect, it } from 'vitest'
import { getCapabilitiesTool, layoutIds } from '../src/get-capabilities.js'
import { getDocumentTool } from '../src/get-document.js'
import { getStructureTool } from '../src/get-structure.js'

/**
 * The half of the capabilities answer that needs no editor.
 *
 * Which commands an editor offers is decided by a `toolbar` attribute, and that
 * is a string with a grammar: ids, `|` for a separator, absent meaning the
 * default bar, `none` meaning no bar. Everything editor-shaped is asserted in
 * Playwright against real editors -- this is the parsing underneath it, which
 * is where an off-by-one in the grammar would hide.
 */
describe('the commands a layout names', () => {
  it('takes the ids and drops the separators', () => {
    expect(layoutIds('undo redo | bold italic | source', null)).toEqual([
      'undo',
      'redo',
      'bold',
      'italic',
      'source',
    ])
  })

  it('reads the default bar when the integrator named no layout', () => {
    // No `toolbar` attribute is not "no toolbar": it is the default one, and an
    // agent told otherwise would refuse edits the editor is showing a button
    // for.
    expect(layoutIds(null, null)).toEqual(DEFAULT_LAYOUT.split(/\s+/).filter((id) => id !== '|'))
  })

  it('reports nothing for an editor whose toolbar was turned off', () => {
    expect(layoutIds('none', null)).toEqual([])
    expect(layoutIds('none', 'none')).toEqual([])
  })

  it('counts the second toolbar, and counts a repeated id once', () => {
    // `toolbar2` is a second bar with the same grammar, so a command on it is
    // as available as one on the first. An id on both bars is one capability.
    expect(layoutIds('bold italic', 'italic | source')).toEqual([
      'bold',
      'italic',
      'source',
    ])
  })
})

/**
 * Failing on a name that is not on the page.
 *
 * There is no editor in this environment at all, which makes it exactly the
 * case an agent hits when it reuses an identifier from an earlier task: the
 * answer has to be a result it can read and retry from, not a throw, and never
 * somebody else's document.
 */
describe('a tool asked about an editor that is not there', () => {
  const idTaking = [getCapabilitiesTool, getDocumentTool, getStructureTool]

  it('fails with the code that says to list again', () => {
    for (const tool of idTaking) {
      expect(JSON.parse(tool.execute({ id: 'post-body' }))).toEqual({
        ok: false,
        error: 'unknown-editor',
        message: expect.stringContaining('openleaf_list_editors'),
      })
    }
  })

  it('fails on arguments that do not match the schema it published', () => {
    // Nothing checks the agent's arguments against the schema on the way in, so
    // a missing or mistyped `id` arrives at the handler.
    for (const tool of idTaking) {
      for (const args of [{}, { id: '' }, { id: 7 }]) {
        expect(JSON.parse(tool.execute(args))).toMatchObject({
          ok: false,
          error: 'invalid-argument',
        })
      }
    }
  })
})
