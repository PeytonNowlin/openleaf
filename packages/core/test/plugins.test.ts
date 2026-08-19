import { Plugin, PluginKey } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import { coreSchema, createRegisteredPlugins, registerEditorPlugin } from '../src/index.js'

describe('createRegisteredPlugins cache', () => {
  const disposers: Array<() => void> = []
  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.()
  })

  it('reuses instances for factories already in the cache', () => {
    let calls = 0
    const factory = () => {
      calls += 1
      return [new Plugin({ key: new PluginKey('cached') })]
    }
    disposers.push(registerEditorPlugin(factory))
    const schema = coreSchema()
    const cache = new Map()
    const first = createRegisteredPlugins(schema, cache)
    const second = createRegisteredPlugins(schema, cache)
    expect(calls).toBe(1)
    expect(second[0]).toBe(first[0])
  })

  it('instantiates only newly registered factories', () => {
    let a = 0
    let b = 0
    disposers.push(
      registerEditorPlugin(() => {
        a += 1
        return [new Plugin({ key: new PluginKey('a') })]
      }),
    )
    const schema = coreSchema()
    const cache = new Map()
    createRegisteredPlugins(schema, cache)
    disposers.push(
      registerEditorPlugin(() => {
        b += 1
        return [new Plugin({ key: new PluginKey('b') })]
      }),
    )
    createRegisteredPlugins(schema, cache)
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})
