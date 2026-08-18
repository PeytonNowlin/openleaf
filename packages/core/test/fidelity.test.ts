/**
 * Round-trip fidelity: the project's headline engineering commitment.
 *
 * Two corpora, two standards, because parsing STORED content and parsing
 * PASTED content are different operations with opposite correct defaults:
 *
 *   fixtures/stored/  The customer's database. Their markup is
 *                     authoritative and we are a guest in it. Standard:
 *                     LOSSLESS. Any attribute we drop is content we
 *                     destroyed.
 *
 *   fixtures/paste/   Foreign content arriving from Word, Google Docs or
 *                     Excel. Its styling is noise the user is actively
 *                     trying to get rid of. Standard: STABLE and
 *                     TEXT-PRESERVING, with attribute stripping counted as
 *                     work done rather than damage.
 *
 * Conflating these two standards is how an editor ends up either mangling
 * stored documents or pasting a wall of `line-height:1.38` into them.
 *
 * The properties checked:
 *
 *   STABILITY (hard, both)   One round trip must be a fixed point. If pass
 *                            two differs from pass one, a document decays a
 *                            little on every save -- cumulatively and
 *                            irreversibly.
 *
 *   TEXT (hard, both)        Every visible character survives. This is the
 *                            failure a customer notices.
 *
 *   ATTRIBUTES               Hard for stored, inverted for paste.
 *                            Undeclared attribute loss in stored content is
 *                            exactly how `class="callout"` quietly becomes
 *                            nothing.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseHtml, serializeHtml } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const STORED = join(HERE, 'fixtures', 'stored')
const PASTE = join(HERE, 'fixtures', 'paste')

/**
 * Losses a specific fixture is permitted, with a reason.
 *
 * Adding an entry here is a deliberate decision to discard part of
 * somebody's document, and has to be argued for in a pull request. Empty is
 * the goal state.
 */
interface Allowance {
  attrs?: string[]
  text?: string[]
  why: string
}

const ALLOWED: Record<string, Allowance> = {
  // Nothing yet.
}

function roundTrip(html: string): string {
  return serializeHtml(parseHtml(html))
}

/**
 * Visible text, compared per block rather than as one flat string.
 *
 * `textContent` inserts no separator at block boundaries, so formatted
 * input (`</p>` newline `<p>`) and minified output (`</p><p>`) would differ
 * on whitespace that carries no meaning. Extracting each block's text
 * separately keeps the comparison sensitive to whitespace WITHIN a block --
 * where losing a space is a real defect -- while ignoring formatting
 * BETWEEN blocks, which is a serialization detail.
 */
const BLOCK_SELECTOR = [
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li', 'ul', 'ol',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption',
  'center', 'hr', 'dl', 'dt', 'dd',
].join(',')

/** NUL, chosen because it cannot legally appear in HTML content. */
const BLOCK_SEP = '\u0000'

function visibleText(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  host.querySelectorAll('script,style').forEach((n) => n.remove())
  for (const el of host.querySelectorAll(BLOCK_SELECTOR)) {
    el.appendChild(document.createTextNode(BLOCK_SEP))
  }
  return (host.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .split(BLOCK_SEP)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((block) => block.length > 0)
    .join('\n')
}

/** Multiset of `tag@name=value` for every attribute in the tree. */
function attributes(html: string): Map<string, number> {
  const host = document.createElement('div')
  host.innerHTML = html
  const counts = new Map<string, number>()
  for (const el of host.querySelectorAll('*')) {
    const tag = el.nodeName.toLowerCase()
    for (const attr of el.attributes) {
      const key = `${tag}@${attr.name}=${attr.value.replace(/\s+/g, ' ').trim()}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

function droppedAttributes(input: string, output: string, allowed: string[] = []): string[] {
  const before = attributes(input)
  const after = attributes(output)
  const lost: string[] = []
  for (const [key, n] of before) {
    const kept = after.get(key) ?? 0
    if (kept < n && !allowed.some((a) => key.startsWith(a))) {
      lost.push(`${key} (${n - kept} of ${n} lost)`)
    }
  }
  return lost
}

function load(dir: string): Array<{ name: string; html: string }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((name) => ({ name, html: readFileSync(join(dir, name), 'utf8').trim() }))
}

interface Row {
  corpus: string
  fixture: string
  stable: boolean
  textOk: boolean
  attrs: number
}
const report: Row[] = []

describe('stored content fidelity (must be lossless)', () => {
  for (const { name, html } of load(STORED)) {
    describe(name, () => {
      const allowance = ALLOWED[name]
      const once = roundTrip(html)
      const twice = roundTrip(once)
      const lost = droppedAttributes(html, once, allowance?.attrs ?? [])

      report.push({
        corpus: 'stored',
        fixture: name,
        stable: once === twice,
        textOk: visibleText(once) === visibleText(html),
        attrs: lost.length,
      })

      it('is stable after one round trip', () => {
        expect(twice).toBe(once)
      })

      it('retains all visible text', () => {
        expect(visibleText(once)).toBe(visibleText(html))
      })

      it('retains every attribute', () => {
        expect(lost).toEqual([])
      })
    })
  }
})

describe('paste cleanup (stable and text-preserving; stripping is the goal)', () => {
  for (const { name, html } of load(PASTE)) {
    describe(name, () => {
      const allowance = ALLOWED[name]
      const once = roundTrip(html)
      const twice = roundTrip(once)
      const stripped = droppedAttributes(html, once, allowance?.attrs ?? [])

      report.push({
        corpus: 'paste',
        fixture: name,
        stable: once === twice,
        textOk: visibleText(once) === visibleText(html),
        attrs: stripped.length,
      })

      it('is stable after one round trip', () => {
        expect(twice).toBe(once)
      })

      it('retains all visible text', () => {
        expect(visibleText(once)).toBe(visibleText(html))
      })

      it('strips foreign styling rather than importing it', () => {
        // The inverse of the stored-corpus assertion. If a Word paste
        // arrives with its mso-* and line-height baggage intact, the
        // cleanup is not doing its job.
        expect(stripped.length).toBeGreaterThan(0)
      })

      it('leaves no vendor styling behind', () => {
        const survived = [...attributes(once).keys()].filter((key) =>
          /mso-|line-height:1\.38|docs-internal-guid/.test(key),
        )
        expect(survived).toEqual([])
      })
    })
  }
})

describe('fidelity report', () => {
  it('prints the rate for both corpora', () => {
    const width = Math.max(...report.map((r) => r.fixture.length), 7)
    const rule = '  ' + '-'.repeat(width + 34)
    const out: string[] = ['', '  OpenLeaf round-trip fidelity', rule,
      `  ${'fixture'.padEnd(width)}  corpus  stable  text  attrs`, rule]
    for (const r of report) {
      out.push(
        `  ${r.fixture.padEnd(width)}  ${r.corpus.padEnd(6)}  ` +
          `${r.stable ? '  ok  ' : ' FAIL '}  ${r.textOk ? ' ok ' : 'FAIL'}  ` +
          `${String(r.attrs).padStart(5)}`,
      )
    }
    const stored = report.filter((r) => r.corpus === 'stored')
    const lossless = stored.filter((r) => r.stable && r.textOk && r.attrs === 0)
    out.push(rule, `  stored corpus: ${lossless.length}/${stored.length} fully lossless`, '')
    console.log(out.join('\n'))
    expect(report.length).toBeGreaterThan(0)
  })
})

describe('preservation layer', () => {
  it('unwraps a bare structural div', () => {
    expect(roundTrip('<div><p>hello</p></div>')).toBe('<p>hello</p>')
  })

  it('preserves a div carrying a class rather than unwrapping it', () => {
    expect(roundTrip('<div class="callout"><p>hello</p></div>')).toContain('class="callout"')
  })

  it('normalizes loose inline text into a paragraph without losing it', () => {
    expect(visibleText(roundTrip('<div>bare text</div>'))).toBe('bare text')
  })

  it('preserves an unknown custom element intact', () => {
    const el = '<drupal-media data-entity-uuid="abc-123"></drupal-media>'
    expect(roundTrip(`<p>x</p>${el}`)).toContain('data-entity-uuid="abc-123"')
  })

  it('preserves presentational legacy tags instead of flattening them', () => {
    expect(roundTrip('<p><font face="Verdana">old</font></p>')).toContain('face="Verdana"')
  })
})

describe('bidirectional text', () => {
  it('preserves dir on paragraphs', () => {
    expect(roundTrip('<p dir="rtl">مرحبا</p>')).toBe(
      '<p dir="rtl">مرحبا</p>',
    )
  })

  it('preserves dir on headings', () => {
    expect(roundTrip('<h2 dir="rtl">عنوان</h2>')).toBe(
      '<h2 dir="rtl">عنوان</h2>',
    )
  })

  it('omits dir when absent rather than defaulting it', () => {
    expect(roundTrip('<p>plain</p>')).toBe('<p>plain</p>')
  })
})
