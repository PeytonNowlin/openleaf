import { describe, expect, it } from 'vitest'
import * as webmcp from '../src/index.js'

/**
 * A characterization test over the public surface of
 * `@openleaf-editor/plugins-webmcp`.
 *
 * The same shape as the one in core, and here for the same reason: the package
 * exists to isolate an API that has already been renamed twice, so its own
 * surface is the thing that must not move underneath integrators while the
 * browser's does.
 */
const EXPECTED_EXPORTS = [
  // The integrator's single call. Idempotent, options from the first call.
  'installAgentTools',
  // The tool set as data. This is the seam every test drives and every later
  // tool is added to, so it is public rather than internal: a maintainer who
  // cannot get at the descriptors has to launch a flagged browser to assert
  // anything at all.
  'agentTools',
] as const

describe('the public surface', () => {
  it('exports everything integrators currently import', () => {
    const missing = EXPECTED_EXPORTS.filter((name) => !(name in webmcp))
    expect(missing).toEqual([])
  })

  it('has not quietly grown exports nobody decided to support', () => {
    // A new export is a new promise. This fails on addition so the addition is
    // deliberate, and the fix is to add the name above once it is intended.
    const unexpected = Object.keys(webmcp).filter(
      (name) => !(EXPECTED_EXPORTS as readonly string[]).includes(name),
    )
    expect(unexpected).toEqual([])
  })
})

describe('the tool set', () => {
  it('names its tools in one namespace', () => {
    // A tool name is page-global and shared with every other script that
    // registers one, so a bare `list_editors` is a collision waiting to happen
    // -- and the browser answers a collision by refusing the registration.
    for (const tool of webmcp.agentTools) expect(tool.name).toMatch(/^openleaf_[a-z_]+$/)
  })

  it('offers the tools it says it offers', () => {
    // Pinned rather than counted: the names are page-global and published to
    // agents, so one disappearing or being spelled differently is a break for
    // every integration that told an agent to call it.
    expect(webmcp.agentTools.map((tool) => tool.name)).toEqual([
      'openleaf_list_editors',
      'openleaf_get_capabilities',
      'openleaf_get_document',
    ])
  })

  it('annotates every tool read-only, and says which ones return content', () => {
    // Nothing here writes yet, so a tool claiming otherwise would have a client
    // asking a person before every read. The content hint is the half that
    // varies: it marks the results an agent must treat as data rather than as
    // instructions addressed to it.
    const contentReturning = webmcp.agentTools
      .filter((tool) => tool.annotations.untrustedContentHint)
      .map((tool) => tool.name)
    expect(webmcp.agentTools.every((tool) => tool.annotations.readOnlyHint)).toBe(true)
    expect(contentReturning).toEqual(['openleaf_get_document'])
  })

  it('asks for an editor by id everywhere except the listing', () => {
    // The listing is the one call that can have no id, because it is where an
    // id comes from. Every other tool requires one -- there is no implicit
    // "current editor" on a page with three of them.
    for (const tool of webmcp.agentTools) {
      const required = tool.inputSchema.required ?? []
      if (tool.name === 'openleaf_list_editors') expect(required).toEqual([])
      else expect(required).toEqual(['id'])
    }
  })

  it('gives every tool a title, a description and annotations', () => {
    // All three are what an agent reads before it decides to call anything. A
    // tool with no description is a tool that gets called wrongly or not at
    // all, and the browser surfaces every one of these back through `getTools`.
    for (const tool of webmcp.agentTools) {
      expect(tool.title.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean')
      expect(typeof tool.annotations.untrustedContentHint).toBe('boolean')
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})
