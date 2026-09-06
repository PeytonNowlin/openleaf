import { describe, expect, it } from 'vitest'
import { fail, ok } from '../src/result.js'

/**
 * The result envelope, pinned.
 *
 * Tool results are strings -- that is all the browser's execute path returns --
 * so every tool encodes JSON into one. An agent branches on `ok` before it
 * reads anything else, which only works if every tool in the package agrees on
 * where `ok` is. This is the test that keeps them agreeing.
 */
describe('tool results', () => {
  it('encodes success as an envelope around the payload', () => {
    expect(JSON.parse(ok({ editors: [] }))).toEqual({ ok: true, editors: [] })
  })

  it('encodes failure as a code plus something a model can act on', () => {
    expect(JSON.parse(fail('unknown-editor', 'no editor named "x"; list the editors again'))).toEqual({
      ok: false,
      error: 'unknown-editor',
      message: 'no editor named "x"; list the editors again',
    })
  })

  it('never lets a payload overwrite the flag the agent branches on', () => {
    // A later tool returning a field of its own called `ok` would otherwise
    // silently invert its own result.
    expect(JSON.parse(ok({ ok: false }))).toEqual({ ok: true })
  })
})
