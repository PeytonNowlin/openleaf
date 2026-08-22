/**
 * Skin installation, per document.
 *
 * `registerStyles` is spied rather than exercised, because jsdom has no
 * `adoptedStyleSheets` -- the real function returns 'unavailable' for every
 * document here, so the thing under test would be invisible. What matters is
 * that skins REACH it once per document, which is exactly what the spy sees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerStyles = vi.fn<(css: string, doc?: Document) => 'adopted'>(() => 'adopted')

vi.mock('../src/styles.js', () => ({
  registerStyles: (css: string, doc?: Document) => registerStyles(css, doc),
  ensureStyles: () => 'already' as const,
  markStylesExternal: () => undefined,
  CSS: '',
}))

const { availableSkins, ensureSkins, registerSkin } = await import('../src/skins.js')

/** Every document a call reached, in order. */
function documents(): Array<Document | undefined> {
  return registerStyles.mock.calls.map(([, doc]) => doc)
}

beforeEach(() => {
  registerStyles.mockClear()
})

describe('installing skins into more than one document', () => {
  /*
   * skins.ts kept a module-global string of the last sheet it installed and
   * returned early when the next one matched. The sheet text does not depend on
   * the document, so the first install armed that flag for every document that
   * came after: an editor in an iframe or a print view got the built-in tokens
   * and none of the skin palette. `registerStyles` dedupes per *document*
   * already, which is the same saving without the bug.
   */
  it('reaches the stylesheet installer for a second document', () => {
    const first = document
    const second = document.implementation.createHTMLDocument('second')

    ensureSkins(first)
    ensureSkins(second)

    expect(documents()).toEqual([first, second])
  })

  it('installs the skin palette, not an empty sheet, into the second document', () => {
    const second = document.implementation.createHTMLDocument('second')
    ensureSkins(document)
    ensureSkins(second)

    // Asserted before the destructure, so a skipped second install reads as
    // "never installed" rather than as a confusing undefined-vs-string error.
    expect(registerStyles.mock.calls).toHaveLength(2)
    const css = registerStyles.mock.calls[1]![0]
    // Named by skin, so a missing palette is a missing rule rather than a
    // stylesheet that merely differs in length.
    for (const skin of availableSkins()) {
      expect(css).toContain(`[data-ol-skin="${skin.name}"]`)
    }
  })

  it('carries a skin registered after the second document was styled', () => {
    const second = document.implementation.createHTMLDocument('second')
    ensureSkins(document)
    ensureSkins(second)
    registerStyles.mockClear()

    registerSkin(
      { name: 'acme', label: 'Acme', scheme: 'light', tokens: '--openleaf-color-accent: #c2185b;' },
      second,
    )

    expect(documents()).toEqual([second])
    expect(registerStyles.mock.calls[0]?.[0]).toContain('[data-ol-skin="acme"]')
  })
})
