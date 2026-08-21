/**
 * What highlighting is allowed to do per keystroke.
 *
 * Counting tests, not timing tests: "how many code blocks were tokenized" and
 * "how many times did the backdrop repaint" are the same numbers on every
 * machine, and they are the quantities that regressed. Each assertion here was
 * confirmed to go red against the unfixed code.
 */

import { coreSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import { codeBlockHighlighting } from '../src/codeblock.js'
import { enhanceSourceTextarea } from '../src/source.js'
import * as tokenize from '../src/tokenize.js'

const schema = coreSchema()

/** `blocks` code blocks, separated by `gap` paragraphs each. */
function docHtml(blocks: number, gap: number): string {
  const out: string[] = []
  for (let i = 0; i < blocks; i += 1) {
    for (let p = 0; p < gap; p += 1) out.push(`<p>paragraph ${i}-${p} of prose</p>`)
    out.push(`<pre><code class="language-js">const x${i} = ${i} + 1;\nreturn x${i};</code></pre>`)
  }
  return out.join('')
}

/** Position of the first character of the first paragraph. */
function firstParagraphPos(state: EditorState): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'paragraph') {
      found = pos + 1
      return false
    }
    return true
  })
  if (found < 0) throw new Error('no paragraph')
  return found
}

/** Position inside the first code block. */
function firstCodePos(state: EditorState): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'code_block') {
      found = pos + 1
      return false
    }
    return true
  })
  if (found < 0) throw new Error('no code block')
  return found
}

describe('code-block highlighting is incremental', () => {
  /**
   * `apply` used to be `tr.docChanged ? decorationsFor(tr.doc) : previous.map(...)`,
   * which takes the cheap path when nothing changed and rebuilds every
   * decoration in the document whenever anything does -- including a keystroke
   * in a paragraph nowhere near a code block, which is a `docChanged`
   * transaction like any other.
   *
   * MEASURED (jsdom): 20 code blocks, one character typed in a paragraph.
   *   before  20 blocks tokenized   after  0
   */
  it('tokenizes nothing when the edit is nowhere near a code block', () => {
    const state = EditorState.create({
      doc: parseHtml(docHtml(20, 3), { schema }),
      plugins: [codeBlockHighlighting()],
    })

    const spy = vi.spyOn(tokenize, 'tokenize')
    try {
      state.apply(state.tr.insertText('x', firstParagraphPos(state)))
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * The block that was actually edited must be re-tokenized, and only it.
   *
   * MEASURED (jsdom): 20 code blocks, one character typed inside one of them.
   *   before  20 blocks tokenized   after  1
   */
  it('tokenizes exactly the one code block that changed', () => {
    const state = EditorState.create({
      doc: parseHtml(docHtml(20, 3), { schema }),
      plugins: [codeBlockHighlighting()],
    })

    const spy = vi.spyOn(tokenize, 'tokenize')
    try {
      state.apply(state.tr.insertText('y', firstCodePos(state)))
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  /** A selection-only transaction cannot change a single decoration. */
  it('tokenizes nothing when only the selection moved', () => {
    const state = EditorState.create({
      doc: parseHtml(docHtml(20, 3), { schema }),
      plugins: [codeBlockHighlighting()],
    })

    const spy = vi.spyOn(tokenize, 'tokenize')
    try {
      state.apply(state.tr.setSelection(TextSelection.create(state.doc, firstCodePos(state))))
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * Incremental has to mean "the same answer, sooner". A document edited
   * step by step must carry exactly the decorations a from-scratch pass over
   * the finished document would produce.
   */
  it('lands the same decorations incrementally as it does from scratch', () => {
    const plugin = codeBlockHighlighting()
    let live = EditorState.create({
      doc: parseHtml(docHtml(4, 2), { schema }),
      plugins: [plugin],
    })

    live = live.apply(live.tr.insertText('z', firstCodePos(live)))
    live = live.apply(live.tr.insertText('q', firstParagraphPos(live)))
    live = live.apply(live.tr.delete(firstCodePos(live), firstCodePos(live) + 2))

    const fresh = EditorState.create({ doc: live.doc, plugins: [codeBlockHighlighting()] })

    const ranges = (s: EditorState): string[] => {
      const p = s.plugins[0]
      if (!p) throw new Error('no plugin')
      const set = p.props.decorations?.call(p, s) as
        | { find(): Array<{ from: number; to: number; type: { attrs?: { class?: string } } }> }
        | undefined
      return (set?.find() ?? [])
        .map((d) => `${d.from}-${d.to}:${d.type.attrs?.class ?? ''}`)
        .sort()
    }

    expect(ranges(live)).toEqual(ranges(fresh))
  })
})

describe('source-view highlighting', () => {
  /**
   * Every `input` used to re-tokenize the whole HTML source and rebuild one node
   * per token, with no debounce and no rAF -- and the caret sits in a
   * transparent textarea directly on top of the backdrop, so the relayout is
   * visible as the author types.
   *
   * MEASURED (jsdom): five `input` events dispatched in one frame.
   *   before  5 repaints   after  1
   */
  it('coalesces a burst of input into one repaint', async () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb)
        return frames.length
      })

    const area = document.createElement('textarea')
    area.value = '<p>hello</p>'
    document.body.append(area)
    const teardown = enhanceSourceTextarea(area)

    const spy = vi.spyOn(tokenize, 'tokenize')
    try {
      for (let i = 0; i < 5; i += 1) {
        area.value += `<p>${i}</p>`
        area.dispatchEvent(new Event('input'))
      }
      // Nothing has repainted yet: the work is queued, not done per event.
      expect(spy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)

      for (const frame of frames.splice(0)) frame(0)
      // One repaint for the whole burst. `tokenize` runs once per language the
      // HTML tokenizer delegates to, so the assertion is "one pass", not "one
      // call of everything".
      expect(spy.mock.calls.filter((c) => c[1] === 'html')).toHaveLength(1)
    } finally {
      spy.mockRestore()
      teardown()
      raf.mockRestore()
      area.remove()
    }
  })

  /**
   * `codeblock.ts` caps a single block at 20,000 characters; this file had no
   * cap at all, so an ordinary long article rebuilt thousands of spans per
   * keystroke. Above the cap the backdrop is plain text.
   *
   * MEASURED (jsdom): 60,000 characters of source.
   *   before  tokenized every keystroke   after  not tokenized at all
   */
  it('falls back to plain text above the length cap', () => {
    const area = document.createElement('textarea')
    // One long paragraph rather than thousands of small ones: the cap is on
    // length, and the formatter that runs on attach parses whatever it is given.
    area.value = `<p>${'x'.repeat(25_000)}</p>`
    expect(area.value.length).toBeGreaterThan(20_000)
    document.body.append(area)

    const spy = vi.spyOn(tokenize, 'tokenize')
    try {
      const teardown = enhanceSourceTextarea(area)
      expect(spy).not.toHaveBeenCalled()
      // The content still reaches the backdrop, just uncoloured.
      const view = area.parentElement?.querySelector('.ol-src-view')
      expect(view?.textContent).toContain('xxxxx')
      teardown()
    } finally {
      spy.mockRestore()
      area.remove()
    }
  })
})

describe('tokenizeHtml raw-text scanning', () => {
  /**
   * Finding the closing tag used to be `source.toLowerCase().indexOf(...)`,
   * which allocates a second copy of the WHOLE document for every `<script>`
   * and every `<style>` in it -- so the cost grew with their product.
   *
   * A counting proof rather than a timing one: `String.prototype.toLowerCase`
   * must not be handed the whole document at all.
   *
   * MEASURED (jsdom): 40 script tags in a 200 KB document.
   *   before  40 whole-document lowercase copies   after  0
   */
  it('does not lowercase the whole source to find a closing tag', () => {
    const filler = '<p>some prose that makes the document long</p>'.repeat(500)
    const source = `${filler}<script>var a = 1;</script>`.repeat(40)

    const real = String.prototype.toLowerCase
    let bigCopies = 0
    // eslint-disable-next-line no-extend-native
    String.prototype.toLowerCase = function (this: string) {
      if (this.length > 5000) bigCopies += 1
      return real.call(this)
    }
    try {
      tokenize.tokenize(source, 'html')
      expect(bigCopies).toBe(0)
    } finally {
      String.prototype.toLowerCase = real
    }
  })

  /** Case-insensitivity is the reason the lowercase copy existed. Keep it. */
  it('still finds an upper-case closing tag', () => {
    const tokens = tokenize.tokenize('<script>var a = 1;</SCRIPT><p>after</p>', 'html')
    const text = tokens.map((t) => t.value).join('')
    expect(text).toBe('<script>var a = 1;</SCRIPT><p>after</p>')
    // The prose after the block is markup again, not script.
    expect(tokens.some((t) => t.type === 'tag' && t.value.includes('p'))).toBe(true)
  })
})
