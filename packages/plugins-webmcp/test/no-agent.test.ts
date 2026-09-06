import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installAgentTools } from '../src/index.js'

/**
 * A browser with no agent API at all -- which is every browser today except a
 * flagged Chromium, and will be most of them for a long time.
 *
 * The obligation an integrator is given is that shipping this bundle costs
 * their other users nothing. Not "degrades gracefully": nothing. No throw, and
 * nothing written to the console either, because a warning on every page load
 * of every site that loads the file is its own kind of breakage.
 */
describe('a browser without the API', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = []

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation(() => {}))
    }
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  it('installs silently', () => {
    expect('modelContext' in document).toBe(false)
    expect('modelContext' in navigator).toBe(false)

    expect(() => installAgentTools()).not.toThrow()

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
