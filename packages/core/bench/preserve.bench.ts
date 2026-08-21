/**
 * Task 40 item 1: preserved atoms re-parse their stored HTML on every render.
 *
 * jsdom, not a browser. Absolute numbers are indicative; the before/after ratio
 * on the same rig is the load-bearing part.
 */

import { describe, it } from 'vitest'
import { coreSchema, parseHtml, serializeHtml } from '../src/index.js'
import { plainDoc } from '../../../bench/docs.js'
import { time } from '../../../bench/_util.js'

const schema = coreSchema()

/** Half the blocks are markup nothing in the schema claims, so they become atoms. */
function preservedDoc(paragraphs = 3000, share = 0.5): string {
  const plain = plainDoc(paragraphs).match(/<p>.*?<\/p>/g) ?? []
  const out: string[] = []
  for (let i = 0; i < plain.length; i += 1) {
    const text = (plain[i] as string).slice(3, -4)
    if (i % Math.round(1 / share) === 0) out.push(`<div class="callout" data-k="${i}">${text}</div>`)
    else out.push(plain[i] as string)
  }
  return out.join('')
}

describe('40.1 - preserved atom toDOM', () => {
  it('measures', () => {
    for (const [label, html] of [
      ['plain 3,000 blocks', plainDoc()],
      ['50% preserved 3,000 blocks', preservedDoc()],
      ['100% preserved 3,000 blocks', preservedDoc(3000, 1)],
    ] as const) {
      const doc = parseHtml(html, { schema })
      time(
        `40.1 serializeHtml  ${label}`,
        () => {
          const out = serializeHtml(doc)
          if (out.length === 0) throw new Error('empty')
        },
        7,
        2,
      )
    }
  })
})
