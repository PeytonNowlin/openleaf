import { describe, expect, it } from 'vitest'
import { detectSource, normalizePastedHtml } from '../src/index.js'
import { normalizeWord } from '../src/word.js'

/**
 * Build a Word list paragraph the way Word actually emits one, including the
 * conditional-comment fencing around the marker glyph.
 */
function wordItem(text: string, marker: string, level = 1, listId = 'l0'): string {
  return (
    `<p class="MsoListParagraphCxSpMiddle" style="margin-left:${level * 0.5}in;` +
    `text-indent:-.25in;mso-list:${listId} level${level} lfo1">` +
    `<!--[if !supportLists]--><span style="font-family:Symbol">${marker}` +
    `<span style="font:7.0pt &quot;Times New Roman&quot;">&nbsp;&nbsp; </span></span>` +
    `<!--[endif]-->${text}<o:p></o:p></p>`
  )
}

/** The newer form, where the marker is a span carrying mso-list:Ignore. */
function wordItemIgnoreSpan(text: string, marker: string, level = 1): string {
  return (
    `<p class="MsoListParagraph" style="mso-list:l1 level${level} lfo2">` +
    `<span style="mso-list:Ignore">${marker}<span style="font:7.0pt">&nbsp; </span></span>` +
    `${text}</p>`
  )
}

describe('detection', () => {
  it('recognises Word markup', () => {
    expect(detectSource(wordItem('x', '·'))).toBe('word')
    expect(detectSource('<p class="MsoNormal">plain</p>')).toBe('word')
  })

  it('does not claim ordinary HTML', () => {
    expect(detectSource('<p>just a paragraph</p>')).toBe('unknown')
  })
})

describe('list reconstruction', () => {
  it('turns a flat bullet run into a single <ul>', () => {
    const html = wordItem('Revenue up 12%', '·') + wordItem('Churn down to 3.1%', '·')
    const out = normalizeWord(html)

    expect(out).toContain('<ul>')
    expect(out).not.toContain('<ol>')
    expect(out.match(/<li>/g)).toHaveLength(2)
    expect(out).toContain('Revenue up 12%')
    expect(out).toContain('Churn down to 3.1%')
  })

  it('produces the <li><p>text</p></li> shape the schema requires', () => {
    const out = normalizeWord(wordItem('Only item', '·'))
    expect(out).toContain('<li><p>Only item</p></li>')
  })

  it('deletes the bullet glyph, which a real <li> supplies itself', () => {
    const out = normalizeWord(wordItem('Revenue up 12%', '·'))
    expect(out).not.toContain('·')
    expect(out).not.toContain('Symbol')
  })

  it('recognises a numbered run as <ol>', () => {
    const html = wordItem('First', '1.') + wordItem('Second', '2.')
    const out = normalizeWord(html)
    expect(out).toContain('<ol>')
    expect(out).not.toContain('<ul>')
    expect(out).not.toMatch(/>1\./)
  })

  it('reads lettered and roman markers as ordered', () => {
    // Match the opening tag rather than exactly `<ol>`: a numeric marker also
    // carries a start attribute, which is correct, so `(3)` yields
    // `<ol start="3">`.
    expect(normalizeWord(wordItem('a', 'a.'))).toMatch(/<ol[ >]/)
    expect(normalizeWord(wordItem('b', 'iv.'))).toMatch(/<ol[ >]/)
    expect(normalizeWord(wordItem('c', '(3)'))).toMatch(/<ol start="3">/)
  })

  it("treats Word's bare Courier 'o' bullet as unordered, not as a letter", () => {
    // `o` with no delimiter is the level-2 bullet glyph. `o.` would be a
    // lettered list item. Confusing the two turns every nested bullet list
    // into a numbered one.
    expect(normalizeWord(wordItem('nested', 'o', 2))).toContain('<ul>')
  })

  it('carries a non-default start number onto the <ol>', () => {
    const html = wordItem('Third', '3.') + wordItem('Fourth', '4.')
    expect(normalizeWord(html)).toContain('<ol start="3">')
  })

  it('nests a deeper level inside the last <li> of its parent', () => {
    const html =
      wordItem('Top level', '·', 1) +
      wordItem('Nested one', 'o', 2) +
      wordItem('Nested two', 'o', 2)
    const out = normalizeWord(html)

    // The nested list must live inside the preceding <li>, not as a sibling of
    // the outer <ul>, or the schema rejects it and the structure is lost.
    expect(out).toMatch(/<li><p>Top level<\/p><ul><li><p>Nested one<\/p><\/li>/)
    expect(out.match(/<ul>/g)).toHaveLength(2)
  })

  it('returns to the outer level after a nested run', () => {
    const html =
      wordItem('One', '·', 1) +
      wordItem('One A', 'o', 2) +
      wordItem('Two', '·', 1)
    const out = normalizeWord(html)

    expect(out.match(/<ul>/g)).toHaveLength(2)
    // Three items total, and "Two" is back at the outer level.
    expect(out.match(/<li>/g)).toHaveLength(3)
    expect(out).toMatch(/<\/ul><\/li><li><p>Two<\/p><\/li><\/ul>/)
  })

  it('handles an ordered list with nested bullets', () => {
    const html =
      wordItem('Step one', '1.', 1) +
      wordItem('Detail', '·', 2) +
      wordItem('Step two', '2.', 1)
    const out = normalizeWord(html)

    expect(out.startsWith('<ol>')).toBe(true)
    expect(out).toContain('<ul>')
    expect(out).toContain('Detail')
  })

  it('supports the newer mso-list:Ignore marker form', () => {
    const html = wordItemIgnoreSpan('Modern form', '·') + wordItemIgnoreSpan('Second', '·')
    const out = normalizeWord(html)
    expect(out).toContain('<ul>')
    expect(out.match(/<li>/g)).toHaveLength(2)
    expect(out).not.toContain('·')
  })

  it('leaves an indented non-list paragraph alone', () => {
    // Word applies MsoListParagraph to plain indented text too. Only the
    // mso-list property means "list item".
    const html = '<p class="MsoListParagraph" style="margin-left:.5in">Just indented</p>'
    const out = normalizeWord(html)
    expect(out).not.toContain('<ul>')
    expect(out).not.toContain('<li>')
    expect(out).toContain('Just indented')
  })

  it('keeps two adjacent lists with different identities separate', () => {
    const html =
      wordItem('List A item', '·', 1, 'l0') +
      wordItem('List B item', '1.', 1, 'l5')
    const out = normalizeWord(html)
    expect(out).toContain('<ul>')
    expect(out).toContain('<ol>')
  })

  it('does not wrap ordinary paragraphs in a list', () => {
    const html = '<p class="MsoNormal">Plain paragraph<o:p></o:p></p>'
    const out = normalizeWord(html)
    expect(out).toBe('<p>Plain paragraph</p>')
  })
})

describe('junk removal', () => {
  const messy =
    '<p class="MsoNormal" style="margin-bottom:0in;line-height:normal">' +
    '<span style="font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif">' +
    'Quarterly review of the <b style="mso-bidi-font-weight:normal">Northwind</b> account.' +
    '<o:p></o:p></span></p>'

  it('removes every mso- property', () => {
    expect(normalizeWord(messy)).not.toMatch(/mso-/i)
  })

  it('removes Mso* class names', () => {
    expect(normalizeWord(messy)).not.toMatch(/Mso/i)
  })

  it('removes vendor font and line-height styling', () => {
    const out = normalizeWord(messy)
    expect(out).not.toContain('Calibri')
    expect(out).not.toContain('line-height')
    expect(out).not.toContain('style=')
  })

  it('removes namespaced elements such as <o:p>', () => {
    expect(normalizeWord(messy)).not.toContain('o:p')
  })

  it('removes conditional comments', () => {
    expect(normalizeWord(messy + wordItem('x', '·'))).not.toContain('supportLists')
  })

  it('keeps the text and the real emphasis', () => {
    const out = normalizeWord(messy)
    expect(out).toContain('Quarterly review of the')
    expect(out).toContain('Northwind')
    expect(out).toMatch(/<(b|strong)>Northwind<\/(b|strong)>/)
  })

  it('collapses spans that no longer carry anything', () => {
    expect(normalizeWord(messy)).not.toContain('<span')
  })
})

describe('semantic extraction ordering', () => {
  it('promotes font-weight to <strong> before styles are stripped', () => {
    // If stripping ran first, this bold run would vanish silently -- a
    // content-loss bug that presents as a styling bug.
    const html = '<p class="MsoNormal"><span style="font-weight:bold">Bold run</span></p>'
    expect(normalizeWord(html)).toContain('<strong>Bold run</strong>')
  })

  it('treats numeric weights of 600 and above as bold', () => {
    const html = '<p class="MsoNormal"><span style="font-weight:700">Heavy</span></p>'
    expect(normalizeWord(html)).toContain('<strong>Heavy</strong>')
  })

  it('does not bold a normal numeric weight', () => {
    const html = '<p class="MsoNormal"><span style="font-weight:400">Normal</span></p>'
    expect(normalizeWord(html)).not.toContain('<strong>')
  })

  it('promotes italic and underline', () => {
    const html =
      '<p class="MsoNormal"><span style="font-style:italic">i</span>' +
      '<span style="text-decoration:underline">u</span>' +
      '<span style="text-decoration:line-through">s</span></p>'
    const out = normalizeWord(html)
    expect(out).toContain('<em>i</em>')
    expect(out).toContain('<u>u</u>')
    expect(out).toContain('<s>s</s>')
  })
})

describe('the full paste pipeline', () => {
  it('routes Word content through the Word normalizer', () => {
    const html = wordItem('Routed', '·')
    expect(normalizePastedHtml(html)).toContain('<ul>')
  })

  it('is idempotent -- normalizing clean output changes nothing', () => {
    const once = normalizePastedHtml(wordItem('Stable', '·') + wordItem('Twice', '·'))
    expect(normalizePastedHtml(once)).toBe(once)
  })
})
