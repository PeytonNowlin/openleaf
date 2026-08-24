/**
 * Alignment and colour: the two formatting features that must be expressed as
 * CSS rather than as a tag.
 *
 * The interesting cases here are not "does the button work". They are the
 * fidelity ones: a paragraph whose `style` carries a declaration OpenLeaf does
 * not model must keep it, a coloured span must become editable text rather than
 * a preserved atom, and a hex colour must not come back longer than it went in.
 *
 * ## On comparing bytes
 *
 * These assertions compare stored HTML exactly, which is only possible because
 * the schema writes CSS with `setAttribute` rather than letting ProseMirror's
 * serializer route it through `element.style.cssText`. The CSSOM rewrites as it
 * parses -- `color:#cc0000` becomes `color: rgb(204, 0, 0)` in jsdom, Chromium and
 * WebKit alike -- so without that, every one of these tests would be pinning a
 * rewrite of the author's markup rather than the author's markup. See
 * applyStyleAttribute in src/css.ts.
 *
 * The same claims are checked against real browsers in
 * packages/element/test/e2e/format.spec.ts, because a promise about stored bytes
 * that is only tested in jsdom is not worth much.
 */

import { NodeSelection, TextSelection, type Command, EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  activeBackgroundColor,
  activeFontFamily,
  activeFontSize,
  activeTextAlign,
  activeTextColor,
  clearBackgroundColor,
  clearTextColor,
  coreSchema,
  parseDeclarations,
  parseHtml,
  roundTrip,
  safeColor,
  safeListStyle,
  serializeHtml,
  setBackgroundColor,
  setTextAlign,
  setTextColor,
  toggleTextAlign,
} from '../src/index.js'

function stateFrom(html: string): EditorState {
  return EditorState.create({ doc: parseHtml(html, { schema: coreSchema() }) })
}

function selectAll(state: EditorState): EditorState {
  const { doc } = state
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

function cursorAt(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** A document holding one image, with that image selected. */
function selectingImage(html: string): EditorState {
  const state = stateFrom(html)
  let pos: number | null = null
  state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === 'image') pos = at
    return pos === null
  })
  if (pos === null) throw new Error(`no image node in ${html}`)
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
}

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied ? next : null
}

function html(state: EditorState | null): string {
  if (!state) throw new Error('command declined to apply')
  return serializeHtml(state.doc)
}

/** The declarations on the first element matching `selector` in some HTML. */
function styleOf(html: string, selector = 'p'): Map<string, string> {
  const host = document.createElement('div')
  host.innerHTML = html
  return parseDeclarations(host.querySelector(selector)?.getAttribute('style'))
}

/**
 * A colour declaration in serialized output, folded to the canonical form.
 *
 * `safeColor` is the fold the schema itself applies, so reading through it
 * compares colours rather than spellings -- which is what makes the assertion
 * true both here, where jsdom has rewritten `#cc0000` as `rgb(204, 0, 0)` on the
 * way into the attribute, and in a browser, where it has not.
 */
function styleColor(html: string, property: 'color' | 'background-color'): string | null {
  const host = document.createElement('div')
  host.innerHTML = html
  // Across every span, because two colours serialize as two nested spans -- one
  // per mark -- and which one is outermost is mark order, not something a test
  // should assert.
  for (const span of Array.from(host.querySelectorAll('span'))) {
    const value = safeColor(parseDeclarations(span.getAttribute('style')).get(property))
    if (value !== null) return value
  }
  return null
}

/** The colour attribute of the first mark of this type in a parsed document. */
function markColor(html: string, type: 'text_color' | 'background_color'): string | null {
  const doc = parseHtml(html, { schema: coreSchema() })
  let found: string | null = null
  doc.descendants((node) => {
    if (found !== null) return false
    const mark = node.marks.find((m) => m.type.name === type)
    if (mark) found = mark.attrs['color'] as string
    return true
  })
  return found
}

/** The alignment of every paragraph in some HTML, in document order. */
function alignments(html: string): Array<string | undefined> {
  const host = document.createElement('div')
  host.innerHTML = html
  return Array.from(host.querySelectorAll('p')).map((p) =>
    parseDeclarations(p.getAttribute('style')).get('text-align'),
  )
}

/** A second pass must change nothing, whatever the first pass normalized. */
function isStable(html: string): boolean {
  const once = roundTrip(html)
  return roundTrip(once) === once
}

describe('alignment round-trips', () => {
  it('keeps a centred paragraph byte-identical', () => {
    expect(roundTrip('<p style="text-align:center">hi</p>')).toBe(
      '<p style="text-align:center">hi</p>',
    )
  })

  it("normalizes another editor's spacing, and only its spacing", () => {
    // What TinyMCE writes. A declaration the schema MODELS is re-emitted in the
    // schema's own spelling, so `text-align: center;` loses a space and a
    // semicolon. That is the one normalization this feature imposes on inherited
    // content, and it is deliberately the cheapest available: the value is
    // untouched, no declaration is added or removed, and nothing about how the
    // page renders changes.
    //
    // The rewrite that was NOT acceptable, and which applyStyleAttribute exists to
    // prevent, is the CSSOM's: it turns every `#cc0000` into `rgb(204, 0, 0)`.
    expect(roundTrip('<p style="text-align: center;">hi</p>')).toBe(
      '<p style="text-align:center">hi</p>',
    )
  })

  it('leaves an unmodelled declaration spelled exactly as it was', () => {
    // Residue goes back verbatim, because nothing here understands it well enough
    // to have an opinion about how it should be written. `letter-spacing` rather
    // than `line-height`: the latter is modelled now, and a modelled declaration
    // is deliberately re-spelled -- see the test below.
    expect(roundTrip('<p style="letter-spacing: 0.08em;">hi</p>')).toBe(
      '<p style="letter-spacing: 0.08em;">hi</p>',
    )
  })

  /*
   * The other half of that bargain, stated so it is a decision rather than a
   * surprise: once a property is modelled it lives in a node attribute, and the
   * source spelling is gone by the time anything serializes. It comes back in
   * the schema's canonical form and in the schema's order.
   *
   * That is the price of making a property editable, and it is the same price
   * `text-align` has always paid. What must never happen is a declaration going
   * missing, which the fidelity corpus checks declaration by declaration.
   */
  it('re-spells a modelled declaration canonically', () => {
    expect(roundTrip('<p style="line-height: 1.8;">hi</p>')).toBe(
      '<p style="line-height:1.8">hi</p>',
    )
  })

  it('reads the legacy align attribute and writes the modern declaration', () => {
    // Normalization, not loss: the intent survives in the one spelling that is
    // still valid HTML, and the legacy attribute is not emitted alongside it.
    expect(roundTrip('<p align="center">hi</p>')).toBe('<p style="text-align:center">hi</p>')
  })

  it('aligns headings too', () => {
    expect(roundTrip('<h2 style="text-align:right">hi</h2>')).toBe(
      '<h2 style="text-align:right">hi</h2>',
    )
  })

  it('resolves logical alignment against the reading direction', () => {
    const out = roundTrip('<p dir="rtl" style="text-align:start">hi</p>')
    expect(styleOf(out).get('text-align')).toBe('right')
    expect(out).toContain('dir="rtl"')
  })

  it('drops a value that is not an alignment', () => {
    expect(roundTrip('<p style="text-align:nonsense">hi</p>')).toBe('<p>hi</p>')
  })

  it('keeps declarations it does not model alongside the one it does', () => {
    // The carry mechanism is what makes modelling `text-align` safe. Without
    // the declaration-level merge, writing the alignment back replaces the whole
    // attribute and the residue is gone.
    expect(roundTrip('<p style="letter-spacing:0.08em;text-align:center">hi</p>')).toBe(
      '<p style="letter-spacing:0.08em;text-align:center">hi</p>',
    )
  })

  it('keeps both when it models both, in its own order', () => {
    expect(roundTrip('<p style="line-height:1.4;text-align:center">hi</p>')).toBe(
      '<p style="text-align:center;line-height:1.4">hi</p>',
    )
  })

  it('does not emit both spellings when content carried both', () => {
    const out = roundTrip('<p align="left" style="text-align:center">hi</p>')
    expect(styleOf(out).get('text-align')).toBe('center')
    expect(out).not.toContain('align="left"')
  })
})

describe('alignment commands', () => {
  it('centres every block in the selection', () => {
    const state = selectAll(stateFrom('<p>one</p><p>two</p>'))
    const out = html(run(state, setTextAlign('center')))
    expect(alignments(out)).toEqual(['center', 'center'])
  })

  it('clears the alignment when the active one is applied again', () => {
    const state = cursorAt(stateFrom('<p style="text-align:center">hi</p>'), 2)
    expect(html(run(state, toggleTextAlign('center')))).toBe('<p>hi</p>')
  })

  it('switches between alignments without clearing', () => {
    const state = cursorAt(stateFrom('<p style="text-align:center">hi</p>'), 2)
    expect(styleOf(html(run(state, toggleTextAlign('right')))).get('text-align')).toBe('right')
  })

  it('reports the active alignment, and null when the selection is mixed', () => {
    const centred = cursorAt(stateFrom('<p style="text-align:center">hi</p>'), 2)
    expect(activeTextAlign(centred)).toBe('center')

    const mixed = selectAll(stateFrom('<p style="text-align:center">a</p><p>b</p>'))
    expect(activeTextAlign(mixed)).toBeNull()
  })

  it('reports null rather than left for an unaligned paragraph', () => {
    // "No explicit alignment" follows the reading direction, so calling it left
    // would light the wrong button up in an RTL document.
    expect(activeTextAlign(cursorAt(stateFrom('<p>hi</p>'), 2))).toBeNull()
  })

  it('declines where nothing is alignable', () => {
    const state = cursorAt(stateFrom('<pre><code>x</code></pre>'), 2)
    expect(setTextAlign('center')(state)).toBe(false)
  })

  it('reports true for the alignment already in force', () => {
    // Otherwise the toolbar renders the current alignment's button as disabled,
    // because a command's no-dispatch call is what drives enabled state.
    const state = cursorAt(stateFrom('<p style="text-align:center">hi</p>'), 2)
    expect(setTextAlign('center')(state)).toBe(true)
  })

  it('floats a selected image without aligning its parent paragraph', () => {
    const state = selectingImage('<p><img src="/a.png" alt="x"></p>')
    const out = html(run(state, setTextAlign('right')))
    expect(out).toContain('ol-float-right')
    expect(out).not.toMatch(/text-align:\s*right/)
    expect(out).not.toMatch(/\balign="right"/)
  })

  it('centres a figure\'s image and leaves the caption intact', () => {
    const state = selectingImage(
      '<figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>',
    )
    const out = html(run(state, setTextAlign('center')))
    expect(out).toContain('ol-align-center')
    expect(out).toContain('<figure>')
    expect(out).toContain('<figcaption>cap</figcaption>')
  })

  it('still aligns a paragraph that has no image', () => {
    const state = cursorAt(stateFrom('<p>hi</p>'), 2)
    expect(styleOf(html(run(state, setTextAlign('center')))).get('text-align')).toBe('center')
  })

  it('reports true for a selected image even without dispatch', () => {
    expect(setTextAlign('right')(selectingImage('<p><img src="/a.png" alt="x"></p>'))).toBe(true)
    expect(
      setTextAlign('right')(
        selectingImage('<figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>'),
      ),
    ).toBe(true)
  })

  it('reports a selected image\'s alignment and toggling it clears the class', () => {
    const selected = selectingImage('<p><img src="/a.png" alt="x"></p>')
    const right = run(selected, setTextAlign('right'))
    expect(activeTextAlign(right!)).toBe('right')
    expect(html(right)).toContain('ol-float-right')

    const cleared = run(right!, toggleTextAlign('right'))
    expect(activeTextAlign(cleared!)).toBeNull()
    expect(html(cleared)).not.toContain('ol-float-right')
    expect(html(cleared)).not.toMatch(/text-align:\s*right/)
  })

  it('aligns text and images together when the range covers both', () => {
    const state = selectAll(stateFrom('<p>hello <img src="/a.png" alt="x"> there</p>'))
    const out = html(run(state, setTextAlign('right')))
    expect(styleOf(out).get('text-align')).toBe('right')
    expect(out).toContain('ol-float-right')
  })
})

describe('colour round-trips', () => {
  it('keeps a hex colour byte-identical', () => {
    // Two mechanisms have to cooperate for this. ProseMirror matches mark style
    // rules through the CSSOM, which reports `rgb(255, 0, 0)` for an authored
    // `#ff0000`, so `safeColor` folds it back; and the mark writes its attribute
    // with `setAttribute`, so the serializer cannot expand it again.
    expect(roundTrip('<p><span style="color:#ff0000">hi</span></p>')).toBe(
      '<p><span style="color:#ff0000">hi</span></p>',
    )
    expect(markColor('<p><span style="color:#ff0000">hi</span></p>', 'text_color')).toBe('#ff0000')
  })

  it('folds a functional colour onto the shorter hex form', () => {
    expect(markColor('<p><span style="color:rgb(255, 0, 0)">hi</span></p>', 'text_color')).toBe(
      '#ff0000',
    )
  })

  it('is stable on a second pass', () => {
    expect(isStable('<p><span style="color:rgb(255, 0, 0)">hi</span></p>')).toBe(true)
    expect(isStable('<p><span style="color:#ff0000">hi</span></p>')).toBe(true)
    expect(isStable('<p style="text-align:center">hi</p>')).toBe(true)
  })

  it('leaves coloured text editable rather than preserving it as an atom', () => {
    // The whole point. A preserved atom round-trips perfectly and cannot be
    // typed in, spellchecked or partially selected.
    const doc = parseHtml('<p><span style="color:#c00">hi</span></p>', { schema: coreSchema() })
    const paragraph = doc.firstChild
    const inline = paragraph?.firstChild
    expect(inline?.isText).toBe(true)
    expect(inline?.marks[0]?.type.name).toBe('text_color')
  })

  it('handles background colour, and both colours at once', () => {
    expect(
      markColor('<p><span style="background-color:#ff0">hi</span></p>', 'background_color'),
    ).toBe('#ffff00')

    const both = '<p><span style="color:#c00;background-color:#ff0">hi</span></p>'
    expect(markColor(both, 'text_color')).toBe('#cc0000')
    expect(markColor(both, 'background_color')).toBe('#ffff00')
  })

  it('converts a legacy font element', () => {
    const out = roundTrip('<p><font color="red">hi</font></p>')
    expect(out).not.toContain('<font')
    expect(styleColor(out, 'color')).toBe('red')
  })

  it('preserves a font element carrying more than colour', () => {
    // `face` is information this mark cannot hold, so the preservation layer
    // keeps the element intact instead of the mark silently dropping it.
    expect(roundTrip('<p><font color="red" face="Arial">hi</font></p>')).toContain('face="Arial"')
  })

  it('preserves a span carrying more than colour', () => {
    const out = roundTrip('<p><span style="color:red;font-family:Arial">hi</span></p>')
    expect(out).toContain('font-family:Arial')
  })

  it('applies no mark for a colour the validator refuses', () => {
    // The span is still preserved verbatim, because that is what happens to any
    // span carrying a style this schema cannot model -- content is never dropped
    // to make a validator's point. What must not happen is the value reaching a
    // mark, and from there being written back as something the editor vouches
    // for.
    expect(markColor('<p><span style="color:url(evil)">hi</span></p>', 'text_color')).toBeNull()
  })

  it('does not wrap a preserved styled span in a second copy of the same mark', () => {
    // `style:` rules used to fire on elements the preservation layer also
    // kept, so the first save nested a live colour/font span around an atom
    // that already carried the declaration. These must be fixed points, not
    // merely convergent -- a second pass being stable is what the bug did.
    const duplicating = [
      '<p><span style="color:red" class="hl">x</span></p>',
      '<p><span style="font-family:Arial" class="c">x</span></p>',
      '<p><span style="font-size:14px" class="c">x</span></p>',
      '<p><span style="color:red;letter-spacing:1px">x</span></p>',
      '<p><span style="color:red" data-id="1">x</span></p>',
    ]
    const alreadyCorrect = [
      '<p><span class="hl" style="background-color:yellow">x</span></p>',
      '<p><span style="color:red">x</span></p>',
      '<p><font color="red" class="c">x</font></p>',
    ]
    for (const html of [...duplicating, ...alreadyCorrect]) {
      expect(roundTrip(html), html).toBe(html)
    }
  })

  it('still yields a colour mark from a paragraph that carries one', () => {
    // The un-consuming match exists so a host the schema models still
    // produces a mark. A span-only tag rule would miss it.
    expect(markColor('<p style="color:red">x</p>', 'text_color')).toBe('red')
  })
})

describe('colour commands', () => {
  it('applies a colour across the selection', () => {
    const state = selectAll(stateFrom('<p>hi</p>'))
    expect(html(run(state, setTextColor('#cc0000')))).toBe(
      '<p><span style="color:#cc0000">hi</span></p>',
    )
  })

  it('replaces an existing colour rather than nesting one', () => {
    const state = selectAll(stateFrom('<p><span style="color:#cc0000">hi</span></p>'))
    const out = html(run(state, setTextColor('#0000cc')))
    expect(styleColor(out, 'color')).toBe('#0000cc')
    // One span, not a blue one nested in a red one.
    expect(out.match(/<span/g)).toHaveLength(1)
  })

  it('clears a colour', () => {
    const state = selectAll(stateFrom('<p><span style="color:#cc0000">hi</span></p>'))
    expect(html(run(state, clearTextColor))).toBe('<p>hi</p>')
  })

  it('declines to clear when there is no colour to clear', () => {
    expect(clearTextColor(selectAll(stateFrom('<p>hi</p>')))).toBe(false)
    expect(clearBackgroundColor(selectAll(stateFrom('<p>hi</p>')))).toBe(false)
  })

  it('applies to what is typed next when the selection is empty', () => {
    const state = cursorAt(stateFrom('<p>hi</p>'), 2)
    const next = run(state, setTextColor('#cc0000'))
    expect(next?.storedMarks?.[0]?.attrs['color']).toBe('#cc0000')
  })

  it('keeps foreground and background independent', () => {
    const state = selectAll(stateFrom('<p>hi</p>'))
    const coloured = run(state, setTextColor('#cc0000'))
    const both = run(selectAll(coloured as EditorState), setBackgroundColor('#ffff00'))
    const out = html(both)
    expect(styleColor(out, 'color')).toBe('#cc0000')
    expect(styleColor(out, 'background-color')).toBe('#ffff00')
  })

  it('declines a colour the schema would refuse', () => {
    const state = selectAll(stateFrom('<p>hi</p>'))
    expect(setTextColor('expression(alert(1))')(state)).toBe(false)
    expect(setTextColor('url(evil)')(state)).toBe(false)
  })

  it('reports the active colour, and null when mixed', () => {
    const one = selectAll(stateFrom('<p><span style="color:#cc0000">hi</span></p>'))
    expect(activeTextColor(one)).toBe('#cc0000')

    const mixed = selectAll(
      stateFrom('<p><span style="color:#cc0000">a</span><span style="color:#0000cc">b</span></p>'),
    )
    expect(activeTextColor(mixed)).toBeNull()
    expect(activeBackgroundColor(one)).toBeNull()

    // Unmarked then marked used to report the colour: null was both the
    // "not seen" sentinel and the unmarked value, so the second run overwrote.
    const unmarkedThenMarked = selectAll(
      stateFrom('<p>a<span style="color:#cc0000">b</span></p>'),
    )
    expect(activeTextColor(unmarkedThenMarked)).toBeNull()
    const markedThenUnmarked = selectAll(
      stateFrom('<p><span style="color:#cc0000">a</span>b</p>'),
    )
    expect(activeTextColor(markedThenUnmarked)).toBeNull()
  })
})

describe('typography active marks', () => {
  it('reports a uniform font family and size', () => {
    const family = selectAll(
      stateFrom('<p><span style="font-family:Georgia">hi</span></p>'),
    )
    expect(activeFontFamily(family)).toBe('Georgia')

    const size = selectAll(stateFrom('<p><span style="font-size:18px">hi</span></p>'))
    expect(activeFontSize(size)).toBe('18px')
  })

  it('reports null when the selection mixes marked and unmarked text', () => {
    const unmarkedThenMarked = selectAll(
      stateFrom('<p>plain<span style="font-family:Georgia">set</span></p>'),
    )
    expect(activeFontFamily(unmarkedThenMarked)).toBeNull()

    const markedThenUnmarked = selectAll(
      stateFrom('<p><span style="font-size:18px">set</span>plain</p>'),
    )
    expect(activeFontSize(markedThenUnmarked)).toBeNull()

    const twoFamilies = selectAll(
      stateFrom(
        '<p><span style="font-family:Georgia">a</span><span style="font-family:Arial">b</span></p>',
      ),
    )
    expect(activeFontFamily(twoFamilies)).toBeNull()
  })
})

describe('safeColor', () => {
  it('accepts the shapes a colour can take', () => {
    expect(safeColor('#abc')).toBe('#abc')
    expect(safeColor('#AABBCC')).toBe('#aabbcc')
    expect(safeColor('rgb(1 2 3)')).toBe('#010203')
    expect(safeColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)')
    expect(safeColor('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)')
    expect(safeColor('rebeccapurple')).toBe('rebeccapurple')
    expect(safeColor('transparent')).toBe('transparent')
  })

  it('refuses everything that could reach outside the declaration', () => {
    for (const value of [
      'url(https://evil.example/x)',
      'expression(alert(1))',
      'var(--x)',
      'red;position:fixed',
      'image-set("x")',
      '#12',
      'attr(href)',
      '',
    ]) {
      expect(safeColor(value)).toBeNull()
    }
  })
})

describe('safeListStyle', () => {
  it('maps the spellings a list style can arrive in', () => {
    expect(safeListStyle('disc')).toBe('disc')
    expect(safeListStyle('DISC')).toBe('disc')
    expect(safeListStyle('lower-latin')).toBe('lower-alpha')
    expect(safeListStyle('upper-latin')).toBe('upper-alpha')
    expect(safeListStyle('lower-greek')).toBe('lower-greek')
    expect(safeListStyle(' square ')).toBe('square')
  })

  it('keeps the HTML `type` letters case-sensitive', () => {
    // `a` and `A` are different lists, so the exact spelling has to win over
    // the lowercased fallback.
    expect(safeListStyle('a')).toBe('lower-alpha')
    expect(safeListStyle('A')).toBe('upper-alpha')
    expect(safeListStyle('i')).toBe('lower-roman')
    expect(safeListStyle('I')).toBe('upper-roman')
    expect(safeListStyle('1')).toBe('decimal')
  })

  it('does not answer with something off Object.prototype', () => {
    // The alias table used to be an object literal, so `<ol type="constructor">`
    // round-tripped to `list-style-type:function Object() { [native code] }`.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(safeListStyle(key)).toBeNull()
    }
  })

  it('refuses anything that is not a known list style', () => {
    for (const value of ['', 'none', 'url(https://evil.example/x)', 'disc;position:fixed']) {
      expect(safeListStyle(value)).toBeNull()
    }
  })
})
