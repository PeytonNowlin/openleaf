import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHtml, serializeHtml } from '@openleaf/core'
import { describe, expect, it } from 'vitest'
import { formatHtml } from '../src/format.js'
import { formatIfLossless } from '../src/source.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const STORED = join(HERE, '../../core/test/fixtures/stored')

const parse = (html: string): string => serializeHtml(parseHtml(html))

describe('formatting never changes the document', () => {
  /*
   * The property that makes reformatting safe at all: indenting for display must
   * produce markup that parses to exactly the same document. Run against the
   * real fidelity corpus rather than invented samples, because those fixtures
   * are the awkward content this project actually promises to handle.
   */
  const fixtures = readdirSync(STORED).filter((f) => f.endsWith('.html'))

  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(5)
  })

  for (const name of fixtures) {
    it(`${name} survives formatting`, () => {
      const stored = parse(readFileSync(join(STORED, name), 'utf8'))
      expect(parse(formatHtml(stored))).toBe(stored)
    })
  }
})

describe('the rules the formatter must not break', () => {
  it('copies <pre> content byte for byte', () => {
    // Whitespace inside <pre> is content. Reindenting it silently rewrites the
    // author's code sample.
    const html = '<p>before</p><pre><code>line one\n    deeply indented\n</code></pre><p>after</p>'
    const formatted = formatHtml(html)
    expect(formatted).toContain('<code>line one\n    deeply indented\n</code>')
    expect(parse(formatted)).toBe(parse(html))
  })

  it('does not break lines inside a block\'s inline content', () => {
    // A newline before <strong> would turn "ab" into "a b".
    const html = '<p>a<strong>b</strong>c</p>'
    expect(formatHtml(html)).toContain('<p>a<strong>b</strong>c</p>')
  })

  it('does indent nested block structure', () => {
    // A list is opened up; the paragraph inside a list item holds only inline
    // content and so stays on one line.
    expect(formatHtml('<ul><li><p>one</p></li></ul>')).toBe(
      ['<ul>', '  <li>', '    <p>one</p>', '  </li>', '</ul>'].join('\n'),
    )
  })

  it('leaves preserved markup parsing identically', () => {
    const html = parse('<div class="callout" data-id="7"><p>kept</p></div>')
    expect(parse(formatHtml(html))).toBe(html)
  })

  it('handles a table without changing it', () => {
    const html = parse('<table border="1"><tbody><tr><td>A</td></tr></tbody></table>')
    expect(parse(formatHtml(html))).toBe(html)
  })
})

describe('formatIfLossless refuses when it cannot prove safety', () => {
  it('formats ordinary content', () => {
    const stored = parse('<h2>T</h2><p>x</p>')
    expect(formatIfLossless(stored)).toContain('\n')
  })

  it('returns the input unchanged rather than risk it', () => {
    // Anything it cannot round-trip is handed back untouched. There is no
    // "probably fine" branch.
    const weird = '<p>unclosed'
    const out = formatIfLossless(weird)
    expect(parse(out)).toBe(parse(weird))
  })

  it('is idempotent', () => {
    const once = formatIfLossless(parse('<ul><li><p>a</p></li><li><p>b</p></li></ul>'))
    expect(formatIfLossless(once)).toBe(once)
  })
})
