import { refractor } from 'refractor/core'
import python from 'refractor/python'
import { describe, expect, it } from 'vitest'
import { canHighlight, highlight, setHighlighter, type Token } from '../src/highlighter.js'

/**
 * The pluggable highlighter, driven by a real third-party highlighter.
 *
 * An extension point nobody has run is an extension point that does not work.
 * The built-in tokenizer covers three languages on purpose -- small and honest --
 * and this proves the documented escape hatch actually carries a project that
 * needs the other three hundred.
 */

refractor.register(python)

interface HastNode {
  type: string
  value?: string
  children?: HastNode[]
  properties?: { className?: string[] }
}

function flatten(nodes: HastNode[], inherited: string): Token[] {
  const out: Token[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push({ type: inherited as Token['type'], value: node.value ?? '' })
    } else {
      const own = node.properties?.className?.[1] ?? inherited
      out.push(...flatten(node.children ?? [], own))
    }
  }
  return out
}

describe('the built-in default', () => {
  it('knows the three languages it claims', () => {
    expect(canHighlight('html')).toBe(true)
    expect(canHighlight('css')).toBe(true)
    expect(canHighlight('js')).toBe(true)
  })

  it('declines a language it does not model rather than guessing', () => {
    expect(highlight('def f(): pass', 'python')).toBeNull()
    expect(canHighlight('python')).toBe(false)
  })

  it('does not treat Object.prototype names as languages', () => {
    // `<code class="language-constructor">` used to make canHighlight lie
    // (undefined !== null) while highlight returned undefined, not null.
    expect(canHighlight('constructor')).toBe(false)
    expect(canHighlight('__proto__')).toBe(false)
    expect(highlight('let a = 1', 'constructor')).toBeNull()
  })
})

describe('swapping in refractor', () => {
  it('gains a language the built-in tokenizer does not have', () => {
    const restore = setHighlighter((source, language) => {
      if (!refractor.registered(language)) return null
      return flatten(refractor.highlight(source, language).children as HastNode[], 'text')
    })

    try {
      const tokens = highlight('def greet(name):\n    return name', 'python')
      expect(tokens).not.toBeNull()
      // The safety invariant must hold for a third-party highlighter too.
      expect(tokens!.map((t) => t.value).join('')).toBe('def greet(name):\n    return name')
      expect(tokens!.some((t) => t.type === 'keyword')).toBe(true)
    } finally {
      restore()
    }
  })

  it('restores the previous highlighter', () => {
    const restore = setHighlighter(() => [])
    restore()
    expect(canHighlight('html')).toBe(true)
  })

  it('survives a highlighter that throws', () => {
    // A broken third-party highlighter must cost colour, not the editor.
    const restore = setHighlighter(() => {
      throw new Error('boom')
    })
    try {
      expect(highlight('x', 'html')).toBeNull()
    } finally {
      restore()
    }
  })
})
