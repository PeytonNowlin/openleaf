/**
 * The error contract.
 *
 * `grep -rn "extends Error"` across `packages/*` used to return nothing: no
 * error this project threw was programmatically identifiable, and the four
 * boundaries below each failed in a different style -- silently, as a raw
 * ProseMirror `TypeError`, through `console.error` much later, or on some
 * unrelated later call.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PARSE_DEPTH,
  OpenLeafError,
  coreSchema,
  createSchema,
  isOpenLeafError,
  parseHtml,
  registerEditorPlugin,
  registerSchemaExtension,
  serializeHtml,
} from '../src/index.js'

function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw, got none')
}

describe('OpenLeafError', () => {
  it('is identifiable by code, and by name across two copies of the package', () => {
    const error = new OpenLeafError('invalid-argument', 'nope')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('OpenLeafError')
    expect(error.code).toBe('invalid-argument')
    expect(isOpenLeafError(error)).toBe(true)
    expect(isOpenLeafError(error, 'invalid-argument')).toBe(true)
    expect(isOpenLeafError(error, 'depth-limit')).toBe(false)
    expect(isOpenLeafError(new TypeError('x'))).toBe(false)
  })
})

describe('parseHtml', () => {
  it('rejects a non-string instead of returning an empty document', () => {
    // It used to coerce anything at all: `parseHtml(42)` returned an empty doc,
    // so a caller's type error arrived as silent content loss.
    const error = thrownBy(() => parseHtml(42 as unknown as string))
    expect(isOpenLeafError(error, 'invalid-argument')).toBe(true)
  })

  it('refuses input nested past the depth limit rather than overflowing', () => {
    const deep = '<div>'.repeat(MAX_PARSE_DEPTH + 1) + 'x'
    const error = thrownBy(() => parseHtml(deep))
    expect(isOpenLeafError(error, 'depth-limit')).toBe(true)
  })

  it('still parses ordinary nesting', () => {
    const ok = '<div>'.repeat(50) + '<p>x</p>' + '</div>'.repeat(50)
    expect(() => parseHtml(ok)).not.toThrow()
  })

  it('does not overflow on adversarial input at any depth', () => {
    // The whole point: 20,000 levels used to be `RangeError: Maximum call stack
    // size exceeded` from inside ProseMirror, an unattributed crash rather than
    // a refusal a caller can catch and report.
    const error = thrownBy(() => parseHtml('<div>'.repeat(20_000) + 'x'))
    expect(isOpenLeafError(error, 'depth-limit')).toBe(true)
    expect(error).not.toBeInstanceOf(RangeError)
    // Generous: jsdom's own parser takes seconds to build a tree this deep.
  }, 30_000)
})

describe('serializeHtml', () => {
  it('names itself instead of surfacing a ProseMirror TypeError', () => {
    const error = thrownBy(() => serializeHtml(null as never))
    expect(isOpenLeafError(error, 'invalid-argument')).toBe(true)
    expect((error as Error).message).toContain('@openleaf-editor/core')
  })
})

describe('registerEditorPlugin', () => {
  it('rejects a non-function at the registration boundary', () => {
    // Previously accepted, then failed once per editor through console.error,
    // with a stack pointing at createRegisteredPlugins rather than the caller.
    const error = thrownBy(() => registerEditorPlugin(42 as never))
    expect(isOpenLeafError(error, 'invalid-argument')).toBe(true)
  })
})

describe('registerSchemaExtension', () => {
  it('throws at the call that collides, not on some later coreSchema()', () => {
    const error = thrownBy(() =>
      registerSchemaExtension({
        id: 'test/clash',
        nodes: { paragraph: { content: 'inline*', group: 'block' } },
      }),
    )
    expect(isOpenLeafError(error, 'schema-conflict')).toBe(true)
    // And the registry is unchanged, so the next editor still builds.
    expect(() => coreSchema()).not.toThrow()
  })

  it('leaves createSchema throwing for a direct collision too', () => {
    const error = thrownBy(() =>
      createSchema([
        { id: 'a', nodes: { widget: { group: 'block' } } },
        { id: 'b', nodes: { widget: { group: 'block' } } },
      ]),
    )
    expect(isOpenLeafError(error, 'schema-conflict')).toBe(true)
  })
})
