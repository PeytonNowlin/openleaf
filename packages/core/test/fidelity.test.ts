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
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  coreSchema,
  parseHtml,
  serializeHtml,
  setHeading,
  setParagraph,
  setTextAlign,
  setTextColor,
  toggleBulletList,
  toggleCodeBlock,
} from '../src/index.js'

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
  'table', 'caption', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption',
  'details', 'summary',
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

/**
 * Multiset of `tag@name=value` for every attribute in the tree.
 *
 * `style` is counted one declaration at a time rather than as a whole string,
 * because the schema legitimately rewrites the attribute without losing
 * anything from it. Two things it does:
 *
 *   - A modelled property comes back in the schema's canonical order and
 *     spelling. `line-height:1.8;text-align:center` is stored as two node
 *     attributes and re-emitted as `text-align:center;line-height:1.8`.
 *   - One `<span>` carrying two modelled declarations round-trips as two nested
 *     spans, because ProseMirror serializes one element per mark.
 *
 * Comparing whole strings called both of those a loss. Comparing declarations
 * asks the question the corpus is actually for -- did any styling disappear --
 * and still fails if one does. The byte-level guarantee for declarations the
 * schema does NOT model has its own test in format.test.ts, and `is stable
 * after one round trip` still pins the exact output here.
 */
/**
 * Presentational attributes the schema deliberately re-spells as CSS, and the
 * declaration each one becomes.
 *
 * These are conversions, not losses, and the difference is worth being exact
 * about because this file's whole job is refusing to accept losses. `<td
 * bgcolor="#ff0000">` comes back as `<td style="background-color:#ff0000">`:
 * the fact -- this cell has a red background -- is entirely intact, in the
 * spelling that is still valid HTML. Counting that as a destroyed attribute
 * would either force the corpus to exclude the legacy content it exists to
 * cover, or push the schema into emitting both spellings of one fact, which is
 * the duplication these folds were added to remove.
 *
 * So both spellings collapse to one key, on BOTH sides of the comparison. That
 * is the narrow claim being made: the two are interchangeable notations. It is
 * not an allowance and it cannot hide a dropped value -- a fact that disappears
 * in both notations still disappears from the count.
 *
 * Restricted to the folds the schema genuinely performs: `readStyle` and
 * `cellGetAttrs` in tables.ts fold `bgcolor` and `vertical-align`, and
 * `textBlockAttrs` in schema.ts reads the legacy `align` and writes
 * `text-align`. Anything not listed here is compared as itself.
 */
const EQUIVALENT_SPELLINGS: ReadonlyArray<{ attribute: string; property: string }> = [
  { attribute: 'bgcolor', property: 'background-color' },
  { attribute: 'valign', property: 'vertical-align' },
  { attribute: 'align', property: 'text-align' },
]

const BY_ATTRIBUTE = new Map(EQUIVALENT_SPELLINGS.map((e) => [e.attribute, e]))
const BY_PROPERTY = new Map(EQUIVALENT_SPELLINGS.map((e) => [e.property, e]))

/**
 * One key for a fact, whichever notation it arrived in.
 *
 * Values are lowercased for these three only, because the fold runs through
 * `safeColor` and `safeVAlign`, both of which normalize case. Comparing
 * `bgcolor="#FF0000"` against `background-color:#ff0000` as different facts
 * would report a loss where the only change is one the validator made on
 * purpose.
 */
function equivalenceKey(tag: string, name: string, value: string): string | null {
  const found = BY_ATTRIBUTE.get(name) ?? BY_PROPERTY.get(name)
  if (!found) return null
  return `${tag}@=${found.attribute}:${value.toLowerCase()}`
}

function attributes(html: string, withTag = true): Map<string, number> {
  const host = document.createElement('div')
  host.innerHTML = html
  const counts = new Map<string, number>()
  const bump = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const el of host.querySelectorAll('*')) {
    // The command corpus compares without the tag, because changing a block's
    // TYPE is the whole point of the commands under test: `p@class=lead`
    // legitimately becomes `h2@class=lead`, and keying on the tag would report
    // every successful conversion as a destroyed attribute.
    const tag = withTag ? el.nodeName.toLowerCase() : ''
    for (const attr of el.attributes) {
      const value = attr.value.replace(/\s+/g, ' ').trim()
      if (attr.name !== 'style') {
        bump(equivalenceKey(tag, attr.name, value) ?? `${tag}@${attr.name}=${value}`)
        continue
      }
      for (const declaration of value.split(';')) {
        const at = declaration.indexOf(':')
        if (at === -1) continue
        const property = declaration.slice(0, at).trim().toLowerCase()
        const setting = declaration.slice(at + 1).trim()
        if (property === '' || setting === '') continue
        bump(equivalenceKey(tag, property, setting) ?? `${tag}@style~${property}:${setting}`)
      }
    }
  }
  return counts
}

function droppedAttributes(
  input: string,
  output: string,
  allowed: string[] = [],
  withTag = true,
): string[] {
  const before = attributes(input, withTag)
  const after = attributes(output, withTag)
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

      /*
       * This block round-trips the fixture through the SCHEMA alone, with no
       * paste normalizer, as a backstop: nothing here should be able to import
       * a vendor artefact even if the normalizer were bypassed.
       *
       * `line-height:1.38` used to be on this list and is not any more, because
       * line-height became a modelled property. The schema reads it for the same
       * reason it reads `text-align` -- an author can set it deliberately, and it
       * cannot tell that value apart from Google Docs' default. Stripping vendor
       * styling is the paste pipeline's job, which strips every declaration
       * rather than allowlisting; `gdocs.test.ts` pins that it still does.
       */
      it('leaves no vendor styling behind', () => {
        const survived = [...attributes(once).keys()].filter((key) =>
          /mso-|docs-internal-guid/.test(key),
        )
        expect(survived).toEqual([])
      })
    })
  }
})

/*
 * ------------------------------------------------------------------------
 * The same three properties, with an EDIT in the middle.
 * ------------------------------------------------------------------------
 *
 * The corpora above prove that opening and saving a document changes nothing.
 * That is half the promise, and it was the half being measured: the harness
 * reported "11/11 fully lossless" while every block-type command in the editor
 * was destroying `class`, every `data-*`, all unmodelled CSS and `dir` on the
 * block it touched. Nothing here could have caught it, because nothing here
 * ever ran a command.
 *
 * A user does not open a document and save it. They open it, press a toolbar
 * button, and save it -- so "we did not damage your content" has to hold across
 * an edit, not just across a no-op. These cases parse a fixture, apply a real
 * command sequence to it, and then ask the same three questions.
 *
 * Attribute comparison drops the tag name (see `attributes`): a command that
 * turns a `<p>` into an `<h2>` is doing its job, and the property being pinned
 * is that everything ELSE about the block survived the trip.
 */

interface CommandCase {
  name: string
  html: string
  /** Applied in order, each to the whole document. */
  commands: Command[]
  /**
   * Attribute keys this sequence is allowed to remove, and why.
   *
   * Same standard as `ALLOWED` above: an entry is a deliberate decision to
   * discard part of somebody's document and has to be argued for.
   */
  removes?: string[]
  why?: string
}

/** Select the whole document, so a command applies to every block in it. */
function wholeDocument(doc: PMNode): EditorState {
  const state = EditorState.create({ doc, schema: coreSchema() })
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

function applyAll(html: string, commands: Command[]): string {
  let state = wholeDocument(parseHtml(html))
  for (const command of commands) {
    const before = state
    const ran = command(state, (tr) => {
      state = before.apply(tr)
    })
    if (!ran) throw new Error('a command in the sequence declined to apply')
  }
  return serializeHtml(state.doc)
}

const COMMAND_CASES: CommandCase[] = [
  {
    name: 'setHeading keeps class, data attributes, dir and unmodelled CSS',
    html: '<p class="lead" data-cms-block="7" dir="rtl" style="letter-spacing:0.05em">Hello</p>',
    commands: [setHeading(2)],
  },
  {
    name: 'setHeading keeps a heading its own id and level attributes',
    html: '<h3 id="intro" class="section" dir="rtl">Introduction</h3>',
    commands: [setHeading(2)],
  },
  {
    name: 'setParagraph keeps what the heading was carrying, including its id',
    html: '<h2 id="intro" class="section" data-anchor="top" dir="rtl">Introduction</h2>',
    commands: [setParagraph],
  },
  {
    name: 'toggleCodeBlock keeps class and data attributes',
    html: '<p class="note" data-cms-block="9">const x = 1</p>',
    commands: [toggleCodeBlock],
  },
  {
    name: 'toggleBulletList keeps the list style and class',
    html: '<ol class="steps" style="list-style-type:lower-alpha"><li><p>First</p></li></ol>',
    commands: [toggleBulletList],
  },
  {
    name: 'setTextAlign leaves everything it did not come for alone',
    html: '<p class="lead" data-cms-block="7" style="letter-spacing:0.05em">Hello</p>',
    commands: [setTextAlign('center')],
  },
  {
    name: 'setTextColor leaves the block untouched',
    html: '<p class="lead" data-cms-block="7" style="letter-spacing:0.05em">Hello</p>',
    commands: [setTextColor('#cc0000')],
  },
  {
    name: 'a heading and back again is the identity',
    html: '<p class="lead" data-cms-block="7" dir="rtl" style="letter-spacing:0.05em">Hello</p>',
    commands: [setHeading(2), setParagraph],
  },
  {
    name: 'every block in a multi-block selection keeps its OWN attributes',
    html:
      '<p class="first" data-one="1">Alpha</p>' +
      '<p class="second" data-two="2" dir="rtl">Beta</p>',
    commands: [setHeading(3)],
  },
]

describe('command fidelity (an edit must not damage the rest of the block)', () => {
  for (const testCase of COMMAND_CASES) {
    describe(testCase.name, () => {
      const once = applyAll(testCase.html, testCase.commands)
      const twice = roundTrip(once)
      const lost = droppedAttributes(testCase.html, once, testCase.removes ?? [], false)

      it('is stable when the result is round-tripped', () => {
        expect(twice).toBe(once)
      })

      it('retains all visible text', () => {
        expect(visibleText(once)).toBe(visibleText(testCase.html))
      })

      it('retains every attribute', () => {
        expect(lost).toEqual([])
      })
    })
  }

  /*
   * A table selection is several ranges, and `selection.from`/`to` describe one
   * of them. Kept out of the table above because it is the SELECTION that is
   * the subject here, not the command, and it needs a `CellSelection` to build.
   */
  it('applies a colour to every cell of a selected column, not just the last', async () => {
    const { CellSelection } = await import('prosemirror-tables')
    const doc = parseHtml(
      '<table><tbody>' +
        '<tr><td>a1</td><td>b1</td></tr>' +
        '<tr><td>a2</td><td>b2</td></tr>' +
        '<tr><td>a3</td><td>b3</td></tr>' +
        '</tbody></table>',
    )
    const cells: number[] = []
    doc.descendants((node, pos) => {
      if (node.type.name === 'table_cell') cells.push(pos)
      return true
    })

    const base = EditorState.create({ doc, schema: coreSchema() })
    // First column: the cell at index 0 through the cell at index 4.
    const column = CellSelection.create(doc, cells[0] as number, cells[4] as number)
    const state = base.apply(base.tr.setSelection(column))
    expect(state.selection.ranges.length).toBe(3)

    let next = state
    expect(setTextColor('#cc0000')(state, (tr) => { next = state.apply(tr) })).toBe(true)
    const out = serializeHtml(next.doc)

    // Every cell of the column, and no cell outside it.
    expect(out.match(/color:#cc0000/g)?.length).toBe(3)
    for (const text of ['a1', 'a2', 'a3']) {
      expect(out).toContain(`<span style="color:#cc0000">${text}</span>`)
    }
    for (const text of ['b1', 'b2', 'b3']) {
      expect(out).toContain(`<td>${text}</td>`)
    }
  })
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

    /*
     * The headline number, asserted rather than printed.
     *
     * This used to be `expect(report.length).toBeGreaterThan(0)` -- a check that
     * the corpus is not empty, sitting directly under a banner claiming every
     * fixture in it is lossless. The banner was the thing anybody read and the
     * assertion was the thing that could fail, and they were not about the same
     * subject. Six confirmed content-destroying defects shipped under a green
     * "11/11 fully lossless".
     *
     * Now the number is the test. A fixture that starts dropping attributes
     * fails here as well as in its own block, so the summary cannot advertise a
     * guarantee the corpus no longer meets.
     */
    expect(stored.length).toBeGreaterThan(0)
    expect(lossless.length).toBe(stored.length)
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
    // Two attributes, so no single mark can hold the element: the preservation
    // layer keeps it whole rather than a mark silently dropping the rest.
    expect(roundTrip('<p><font face="Verdana" size="2">old</font></p>')).toContain('face="Verdana"')
  })

  // Face alone is now the font-family mark, so it converts rather than being
  // preserved -- the same bargain `<font color>` has always had. The point of
  // modelling it is that the run stays editable text instead of becoming an
  // opaque atom; the styling has to survive the conversion, which is what this
  // asserts.
  it('converts a font element a mark can hold completely', () => {
    const out = roundTrip('<p><font face="Verdana">old</font></p>')
    expect(out).not.toContain('<font')
    expect(out).toContain('font-family:Verdana')
    expect(out).toContain('old')
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

/**
 * The invariant underneath every fixture above: a document this parser accepts
 * is a document this serializer can emit.
 *
 * It was not true. The HTML parser accepts attribute names `setAttribute`
 * refuses -- `<p ="v">` parses to one attribute literally named `="v"` -- and
 * those were carried through as residue and written back on the way out, so
 * `serializeHtml(parseHtml(x))` threw `InvalidCharacterError` from the middle of
 * rendering. One stray `=` typed into the source box left the editor a blank
 * rectangle with no way back; a stored document containing one could not be
 * loaded at all.
 *
 * Which malformed markup detonated depended on the runtime, which made it worse
 * rather than better: browsers are laxer than the spec for HTML documents while
 * jsdom implements the `Name` production strictly, so `class=""lead""` -- an
 * ordinary template typo -- threw only on the server, in exactly the server-side
 * round trip `serializeHtml`'s own docstring tells integrators to run. These
 * cases run in jsdom on purpose: it is the strict end.
 *
 * Generated as well as enumerated, because the enumerated list is the one that
 * was already believed to be complete.
 */
describe('parse then serialize never throws', () => {
  const MALFORMED = [
    '<p ="v">x</p>',
    '<p class=""lead"">x</p>',
    '<h2 id=""a"">t</h2>',
    '<p "x">y</p>',
    '<p a<b="1">z</p>',
    '<td class=""c"">c</td>',
    '<img src="/a.png" alt=""x"">',
    '<p =>x</p>',
    '<div ==="">x</div>',
    '<span 1="a">x</span>',
    '<p -x="1">x</p>',
    '<p .x="1">x</p>',
    '<table><tr><td ="v">c</td></tr></table>',
    '<ul><li ="v">i</li></ul>',
    '<a href="/a" ="v">l</a>',
  ]

  for (const html of MALFORMED) {
    it(`survives ${html}`, () => {
      expect(() => roundTrip(html)).not.toThrow()
      // Still a document rather than an empty one: the text is the content, and
      // only the name that cannot be written is dropped.
      expect(roundTrip(html)).not.toBe('')
    })
  }

  it('is a fixed point for malformed input too, so a document cannot decay', () => {
    for (const html of MALFORMED) {
      const once = roundTrip(html)
      expect(roundTrip(once)).toBe(once)
    }
  })

  /*
   * A small deterministic sweep over the attribute-name position, which is where
   * the parser and `setAttribute` disagree. Deterministic on purpose: a random
   * corpus that fails once and passes on rerun is not a regression test.
   */
  it('survives generated attribute-name garbage', () => {
    const NOISE = ['=', '"', "'", '<', '>', '/', ' ', '`', '&', '\t', '\n', '1', '-', '.', ':']
    const TAGS = ['p', 'div', 'span', 'h2', 'li', 'td', 'a', 'img']
    for (const tag of TAGS) {
      for (const noise of NOISE) {
        for (const shape of [`${noise}x`, `x${noise}`, noise, `x${noise}y`]) {
          const html = `<${tag} ${shape}="v">t</${tag}>`
          expect(() => roundTrip(html), html).not.toThrow()
          expect(() => roundTrip(roundTrip(html)), `${html} (second pass)`).not.toThrow()
        }
      }
    }
  })
})

describe('unwrap of a sole attribute-free paragraph', () => {
  /*
   * Table cells already had this pass. list_item, blockquote and details
   * body have the same shape and used to grow a `<p>` on first save, which
   * is a rendering change (UA `p` margins, child selectors) as well as a
   * markup rewrite. Mixed content follows the cell rule: more than one
   * child keeps the wrapper.
   */
  const cases: Array<[string, string, string]> = [
    ['bare list items', '<ul><li>a</li><li>b</li></ul>', '<ul><li>a</li><li>b</li></ul>'],
    ['bare ordered item', '<ol><li>one</li></ol>', '<ol><li>one</li></ol>'],
    [
      'nested list: outer mixed, inner sole',
      '<ul><li>a<ul><li>b</li></ul></li></ul>',
      '<ul><li><p>a</p><ul><li>b</li></ul></li></ul>',
    ],
    ['bare blockquote', '<blockquote>quoted text</blockquote>', '<blockquote>quoted text</blockquote>'],
    [
      'details body, not the summary',
      '<details><summary>s</summary>body</details>',
      '<details><summary>s</summary>body</details>',
    ],
    [
      'authored wrappers also unwrap (same asymmetry as cells)',
      '<ul><li><p>a</p></li></ul>',
      '<ul><li>a</li></ul>',
    ],
    [
      'two paragraphs stay wrapped',
      '<ul><li><p>a</p><p>b</p></li></ul>',
      '<ul><li><p>a</p><p>b</p></li></ul>',
    ],
    [
      'classed paragraph stays wrapped',
      '<ul><li><p class="lead">x</p></li></ul>',
      '<ul><li><p class="lead">x</p></li></ul>',
    ],
    [
      'table cells still unwrap',
      '<table><tbody><tr><td>cell</td></tr></tbody></table>',
      '<table><tbody><tr><td>cell</td></tr></tbody></table>',
    ],
    [
      'list inside preserved markup is byte-identical',
      '<div class="callout"><ul><li>a</li></ul></div>',
      '<div class="callout"><ul><li>a</li></ul></div>',
    ],
  ]

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(roundTrip(input)).toBe(expected)
    })
  }
})
