/**
 * Highlighting benchmarks.
 *
 * Three costs, measured separately because they have three different fixes:
 *
 *   1. A keystroke in a paragraph nowhere near a code block. This is the one
 *      the audit found: the plugin rebuilt every decoration in the document.
 *   2. A keystroke inside a code block. Only that block's tokens are stale.
 *   3. A burst of `input` events on the source view backdrop.
 *
 * jsdom numbers. A real browser also has to lay the spans out, so the DOM
 * figures here are a floor, not a ceiling.
 */

import { baseSchema, parseHtml } from '@openleaf-editor/core'
import { EditorState } from 'prosemirror-state'
import { describe, it } from 'vitest'
import { time } from '../../../bench/_util.js'
import { plainDoc } from '../../../bench/docs.js'
import { codeBlockHighlighting } from '../src/codeblock.js'
import { enhanceSourceTextarea } from '../src/source.js'
import { tokenizeHtml } from '../src/tokenize.js'

const CODE = `function hello(name) {
  const greeting = 'hello, ' + name
  if (greeting.length > 40) return null
  return { greeting, at: Date.now() }
}
`.repeat(4)

/** N paragraphs with `blocks` code blocks spread through them. */
function docWith(paragraphs: number, blocks: number): string {
  const parts = plainDoc(paragraphs).split('</p>').filter(Boolean)
  const every = Math.max(1, Math.floor(parts.length / blocks))
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    out.push(`${parts[i]}</p>`)
    if (i % every === 0 && out.length > 0) {
      out.push(`<pre><code class="language-js">${CODE.replace(/</g, '&lt;')}</code></pre>`)
    }
  }
  return out.join('')
}

function stateFor(html: string): EditorState {
  return EditorState.create({ doc: parseHtml(html), schema: baseSchema, plugins: [codeBlockHighlighting()] })
}

/** Position of the first text position inside the first paragraph. */
function firstParagraphPos(state: EditorState): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === 'paragraph') {
      found = pos + 1
      return false
    }
    return true
  })
  return found
}

function firstCodeBlockPos(state: EditorState): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === 'code_block') {
      found = pos + 1
      return false
    }
    return true
  })
  return found
}

describe('code block highlighting', () => {
  for (const [paragraphs, blocks] of [
    [1000, 20],
    [3000, 20],
  ] as const) {
    const html = docWith(paragraphs, blocks)
    const base = stateFor(html)
    const paraPos = firstParagraphPos(base)
    const codePos = firstCodeBlockPos(base)

    it(`${paragraphs} paragraphs + ~${blocks} code blocks`, () => {
      time(`  init (whole document)                     ${paragraphs}p`, () => {
        stateFor(html)
      }, 5, 2)

      let outside = base
      time(`  keystroke in a paragraph, far from code   ${paragraphs}p`, () => {
        outside = outside.apply(outside.tr.insertText('x', paraPos))
      }, 20, 5)

      let inside = base
      time(`  keystroke inside a code block             ${paragraphs}p`, () => {
        inside = inside.apply(inside.tr.insertText('x', codePos))
      }, 20, 5)

      let selection = base
      time(`  selection-only transaction                ${paragraphs}p`, () => {
        selection = selection.apply(selection.tr.setMeta('ping', 1))
      }, 20, 5)
    })
  }
})

describe('source view backdrop', () => {
  const html = plainDoc(2000)

  it('paints a large source document', () => {
    const doc = document
    const parent = doc.createElement('div')
    doc.body.appendChild(parent)
    const textarea = doc.createElement('textarea')
    textarea.value = html
    parent.appendChild(textarea)

    console.log(`  source length: ${(html.length / 1024).toFixed(1)} KB`)

    time('  tokenizeHtml(source)', () => {
      tokenizeHtml(html)
    }, 7, 2)

    const teardown = enhanceSourceTextarea(textarea)
    const view = parent.querySelector('.ol-src-view') as HTMLElement

    time('  10 input events -> repaint work', () => {
      for (let i = 0; i < 10; i += 1) {
        textarea.value = `${textarea.value}x`
        textarea.dispatchEvent(new Event('input'))
      }
      // Force whatever the implementation deferred, so the number is comparable.
      void view.childNodes.length
    }, 7, 2)

    teardown()
    parent.remove()
  })
})

describe('tokenizeHtml with many script/style blocks', () => {
  it('does not rescan the whole source per raw block', () => {
    const chunk = '<p>some ordinary paragraph text goes here to add bulk</p>'.repeat(40)
    const source = `${chunk}<script>const a = 1; const b = 2;</script><style>.a{color:red}</style>`.repeat(60)
    console.log(`  source length: ${(source.length / 1024).toFixed(1)} KB, 120 raw blocks`)
    time('  tokenizeHtml(120 script/style blocks)', () => {
      tokenizeHtml(source)
    }, 7, 2)
  })
})
