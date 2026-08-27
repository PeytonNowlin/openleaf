import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What `installAgentTools` does with the browser it finds -- or does not find.
 *
 * jsdom rather than Playwright on purpose, and this is the one part of the
 * package where that is the right answer: nothing here touches selection, focus
 * or contenteditable. It is which object was reached for, how many times, and
 * with what.
 *
 * `installed` is module state and installing is deliberately one-way, so each
 * test re-imports the package after `vi.resetModules()` rather than sharing one
 * instance and asserting on the leftovers of the test before it.
 */

interface Registration {
  tool: { name: string }
  options?: { signal: AbortSignal } | undefined
}

/** A stand-in for the browser object, recording what it was handed. */
function recorder(): { registerTool: (t: { name: string }, o?: { signal: AbortSignal }) => Promise<void>; calls: Registration[] } {
  const calls: Registration[] = []
  return {
    calls,
    registerTool: (tool, options) => {
      calls.push({ tool, options })
      return Promise.resolve()
    },
  }
}

const load = () => import('../src/index.js')

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext')
  Reflect.deleteProperty(navigator, 'modelContext')
})

describe('installing', () => {
  it('registers every tool once, and ignores every call after the first', async () => {
    const context = recorder()
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context })

    const { agentTools, installAgentTools } = await load()
    installAgentTools()
    installAgentTools()
    installAgentTools({})

    // A CMS template that includes the bundle on two paths is the case this
    // exists for; the browser answers a repeated name with
    // `InvalidStateError: Duplicate tool name`.
    expect(context.calls.map((call) => call.tool.name)).toEqual(agentTools.map((tool) => tool.name))
  })

  it('hands every registration a signal to abort', async () => {
    const context = recorder()
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context })

    const { installAgentTools } = await load()
    installAgentTools()

    // The only teardown the API has: no `unregisterTool`, no bulk replace, no
    // clear. A registration made without a signal can never be undone, so the
    // signal has to be there from the start whether or not anything aborts it.
    expect(context.calls.length).toBeGreaterThan(0)
    for (const call of context.calls) expect(call.options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('prefers the document-scoped object over the deprecated navigator one', async () => {
    const preferred = recorder()
    const deprecated = recorder()
    Object.defineProperty(document, 'modelContext', { configurable: true, value: preferred })
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: deprecated })

    const { installAgentTools } = await load()
    installAgentTools()

    expect(preferred.calls.length).toBeGreaterThan(0)
    expect(deprecated.calls).toEqual([])
  })

  it('falls back to the navigator-scoped object when that is all there is', async () => {
    // Chrome 150 deprecated it but has not removed it, and a browser that only
    // has the old name is the one this fallback is for.
    const deprecated = recorder()
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: deprecated })

    const { agentTools, installAgentTools } = await load()
    installAgentTools()

    expect(deprecated.calls.map((call) => call.tool.name)).toEqual(agentTools.map((tool) => tool.name))
  })
})
