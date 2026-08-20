/**
 * Task 40 item 2: the CSSOM probe in `applyStyleAttribute` runs per styled
 * element. jsdom, not a browser -- the ratio is what matters.
 */

import { describe, it } from 'vitest'
import { applyStyleAttribute } from '../src/css.js'
import { time } from '../../../bench/_util.js'

describe('40.2 - applyStyleAttribute CSSOM probe', () => {
  it('measures', () => {
    for (const elements of [5000, 20000]) {
      const doc = document.implementation.createHTMLDocument('bench')
      const nodes: Element[] = []
      for (let i = 0; i < elements; i += 1) nodes.push(doc.createElement('span'))
      time(
        `40.2 applyStyleAttribute ${String(elements).padStart(6)} elements`,
        () => {
          for (const el of nodes) applyStyleAttribute(el, 'color:#334455;line-height:1.5')
        },
        9,
        2,
      )
    }
  })
})
