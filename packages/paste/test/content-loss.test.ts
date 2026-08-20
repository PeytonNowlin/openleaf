import { describe, expect, it } from 'vitest'
import { detectSource, normalizeGeneric, normalizePastedHtml } from '../src/index.js'
import { normalizeWord } from '../src/word.js'
import { normalizeGoogleDocs } from '../src/gdocs.js'
import { parseStyle } from '../src/dom.js'

/**
 * Regressions for the ways the cleanup pipeline used to destroy content.
 *
 * Every case here is content the author put in the source document and got
 * back as nothing -- the worst failure mode a paste handler has, because it is
 * silent and the author only notices later.
 */

/** Wrap a fragment so the Word detector claims it. */
function asWord(inner: string): string {
  return `<p class="MsoNormal">Intro<o:p></o:p></p>${inner}`
}

/** Wrap a fragment in Google's clipboard envelope. */
function asGoogleDocs(inner: string): string {
  return (
    '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-a1b2">' +
    inner +
    '</b>'
  )
}

describe('embedded media survives the empty-block pass', () => {
  const EMBEDS: Array<[string, string]> = [
    ['iframe', '<iframe src="https://www.youtube.com/embed/x"></iframe>'],
    ['video', '<video src="https://example.org/clip.mp4" controls=""></video>'],
    ['audio', '<audio src="https://example.org/take.mp3" controls=""></audio>'],
    ['svg', '<svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"></circle></svg>'],
    ['picture', '<picture><img src="https://example.org/a.png"></picture>'],
    ['object', '<object data="https://example.org/a.pdf"></object>'],
    ['embed', '<embed src="https://example.org/a.swf">'],
    ['canvas', '<canvas width="10" height="10"></canvas>'],
    ['math', '<math><mi>x</mi></math>'],
  ]

  for (const [name, markup] of EMBEDS) {
    it(`keeps a <${name}> that is the only child of a Word paragraph`, () => {
      const out = normalizeWord(asWord(`<p class="MsoNormal">${markup}</p>`))
      expect(out).toContain(`<${name}`)
    })

    it(`keeps a <${name}> that is the only child of a Google Docs paragraph`, () => {
      const out = normalizeGoogleDocs(asGoogleDocs(`<p dir="ltr">${markup}</p>`))
      expect(out).toContain(`<${name}`)
    })
  }

  it('still drops a paragraph that really is empty', () => {
    expect(normalizeWord('<p class="MsoNormal"><o:p></o:p></p>')).toBe('')
    expect(normalizeGoogleDocs(asGoogleDocs('<p dir="ltr"><span> </span></p>'))).toBe('')
  })

  it('still drops nested empty wrappers, innermost first', () => {
    expect(normalizeGoogleDocs(asGoogleDocs('<p><span><span></span></span></p>'))).toBe('')
  })
})

describe('the inversion does not leave empty formatting behind', () => {
  /*
   * The other half of task 89. Widening what counts as meaningful keeps the
   * video -- and would keep `<p><strong></strong></p>` too, which is what
   * Word's empty paragraph becomes once its <o:p> is removed and its span's
   * styling has been promoted. Deleting videos must not be traded for a trail
   * of empty shells.
   */
  it('drops a Word paragraph that held only a styled <o:p>', () => {
    const html =
      '<p class="MsoNormal">Real text<o:p></o:p></p>' +
      '<p class="MsoNormal"><span style="font-weight:bold;font-family:Calibri"><o:p></o:p></span></p>'
    expect(normalizeWord(html)).toBe('<p>Real text</p>')
  })

  it('drops an italic shell', () => {
    const html =
      '<p class="MsoNormal">Real<o:p></o:p></p>' +
      '<p class="MsoNormal"><span style="font-style:italic"><o:p></o:p></span></p>'
    expect(normalizeWord(html)).toBe('<p>Real</p>')
  })

  it('drops a shell holding nothing but a non-breaking space', () => {
    const html =
      '<p class="MsoNormal">Real<o:p></o:p></p>' +
      '<p class="MsoNormal"><span style="text-decoration:underline">&nbsp;</span></p>'
    expect(normalizeWord(html)).toBe('<p>Real</p>')
  })

  it('drops a bookmark-only anchor rather than leaving a preserved atom', () => {
    // <a name="_Ref1"> is a Word bookmark: invisible by construction, and with
    // no node in core, so keeping it puts a grey card in an empty paragraph.
    const html =
      '<p class="MsoNormal">Real<o:p></o:p></p>' +
      '<p class="MsoNormal"><a name="_Ref1"></a><span style="font-weight:bold"><o:p></o:p></span></p>'
    expect(normalizeWord(html)).toBe('<p>Real</p>')
  })

  it('keeps an anchor that has a destination', () => {
    const html = '<p class="MsoNormal">See <a href="https://example.org/">the spec</a>.</p>'
    expect(normalizeWord(html)).toContain('href="https://example.org/"')
  })

  it('drops a Google Docs shell', () => {
    const html = asGoogleDocs(
      '<p dir="ltr"><span style="font-size:11pt">Real</span></p>' +
        '<p dir="ltr"><span style="font-weight:700;font-size:11pt"></span></p>',
    )
    expect(normalizeGoogleDocs(html)).toBe('<p dir="ltr">Real</p>')
  })

  it('still keeps the paragraph when the shell is not empty', () => {
    const html = '<p class="MsoNormal"><span style="font-weight:bold">Kept</span></p>'
    expect(normalizeWord(html)).toBe('<p><strong>Kept</strong></p>')
  })
})

describe('Word tables keep their structural attributes', () => {
  const TABLE =
    '<table class="MsoTableGrid" width="600" style="border-collapse:collapse">' +
    '<tr><td width="200" valign="top" align="center">A</td>' +
    '<th width="400" valign="bottom">B</th></tr></table>'

  it('keeps the table width', () => {
    expect(normalizeWord(TABLE)).toContain('width="600"')
  })

  it('keeps cell widths and alignment', () => {
    const out = normalizeWord(TABLE)
    expect(out).toContain('width="200"')
    expect(out).toContain('valign="top"')
    expect(out).toContain('align="center"')
    expect(out).toContain('width="400"')
    expect(out).toContain('valign="bottom"')
  })

  it('keeps colgroup widths', () => {
    const out = normalizeWord('<table><colgroup><col width="120"></colgroup><tr><td>A</td></tr></table>')
    expect(out).toContain('width="120"')
  })

  it('keeps the dimensions of an embedded iframe, which core models', () => {
    const out = normalizeWord(
      asWord('<p class="MsoNormal"><iframe src="https://www.youtube.com/embed/x" width="560" height="315"></iframe></p>'),
    )
    expect(out).toContain('width="560"')
    expect(out).toContain('height="315"')
  })

  it('still strips width and align from ordinary paragraphs and spans', () => {
    const out = normalizeWord('<p class="MsoNormal" align="center" width="300">Text</p>')
    expect(out).toBe('<p>Text</p>')
  })
})

describe('Word paste keeps a deliberate language marking', () => {
  it('keeps lang on a foreign-language run', () => {
    const out = normalizeWord('<p class="MsoNormal">He said <span lang="fr">bonjour</span> to me.</p>')
    expect(out).toContain('lang="fr"')
    expect(out).toContain('bonjour')
  })

  it('drops the document language Word repeats on every run', () => {
    const out = normalizeWord(
      '<p class="MsoNormal"><span lang="EN-US">He said </span>' +
        '<span lang="FR">bonjour</span><span lang="EN-US"> to me.</span></p>',
    )
    expect(out).not.toContain('EN-US')
    expect(out).toContain('lang="FR"')
  })

  it('drops lang that merely repeats an ancestor', () => {
    const out = normalizeWord('<div lang="fr"><p class="MsoNormal"><span lang="fr">bonjour</span></p></div>')
    expect(out.match(/lang=/g)).toHaveLength(1)
    expect(out).toContain('<div lang="fr">')
  })

  it('drops a lang value that is not a language tag', () => {
    const out = normalizeWord('<p class="MsoNormal"><span lang="javascript:alert(1)">x</span></p>')
    expect(out).not.toContain('lang=')
  })

  it('drops lang from an element with no text of its own', () => {
    const out = normalizeWord('<p class="MsoNormal">Text<span lang="fr"></span></p>')
    expect(out).toBe('<p>Text</p>')
  })

  it('normalises xml:lang onto lang rather than deleting both', () => {
    const out = normalizeWord('<p class="MsoNormal">He said <span xml:lang="de">hallo</span> now.</p>')
    expect(out).not.toContain('xml:lang')
    expect(out).toContain('lang="de"')
  })
})

describe('underline and strikethrough spelled as longhands', () => {
  it('promotes text-decoration-line:underline', () => {
    expect(normalizeGeneric('<p><span style="text-decoration-line:underline">u</span></p>')).toContain(
      '<u>u</u>',
    )
  })

  it('promotes text-decoration-line:line-through', () => {
    expect(normalizeGeneric('<p><span style="text-decoration-line:line-through">gone</span></p>')).toContain(
      '<s>gone</s>',
    )
  })

  it('promotes the longhand on the Word path too', () => {
    const out = normalizeWord('<p class="MsoNormal"><span style="text-decoration-line:underline">u</span></p>')
    expect(out).toContain('<u>u</u>')
  })

  it('does not add a redundant <u> when Google spells the link underline as a longhand', () => {
    const html = asGoogleDocs(
      '<p dir="ltr"><a href="https://example.org/"><span style="text-decoration-line:underline">link</span></a></p>',
    )
    const out = normalizeGoogleDocs(html)
    expect(out).not.toContain('<u>')
    expect(out).toContain('link')
  })
})

describe('the font shorthand carries emphasis too', () => {
  it('promotes bold from the font shorthand', () => {
    expect(normalizeGeneric('<p><span style="font:bold 12px Arial">Bold</span></p>')).toContain(
      '<strong>Bold</strong>',
    )
  })

  it('promotes italic from the font shorthand', () => {
    expect(normalizeGeneric('<p><span style="font:italic 12px Arial">Slanted</span></p>')).toContain(
      '<em>Slanted</em>',
    )
  })

  it('promotes a numeric weight from the font shorthand', () => {
    expect(normalizeGeneric('<p><span style="font:700 12px/1.4 Arial">Heavy</span></p>')).toContain(
      '<strong>Heavy</strong>',
    )
  })

  it("does not read Word's <span style=\"font:7.0pt\"> spacer as bold", () => {
    const out = normalizeGeneric('<p><span style="font:7.0pt &quot;Times New Roman&quot;">x</span></p>')
    expect(out).not.toContain('<strong>')
    expect(out).not.toContain('<em>')
  })
})

describe('copying between OpenLeaf documents', () => {
  // The shape ProseMirror actually puts on the clipboard: the marker lands on
  // the first serialized element, not on a wrapper.
  const PRESERVED =
    '<p data-pm-slice="1 1 []">Real text</p>' +
    '<div class="MsoNormal" data-keep="1" style="background:#eee">preserved</div>'

  it('is detected as an internal paste, not as Word', () => {
    expect(detectSource(PRESERVED)).toBe('openleaf')
  })

  it('does not route preserved Word residue through the Word stripper', () => {
    const out = normalizePastedHtml(PRESERVED)
    expect(out).toContain('class="MsoNormal"')
    expect(out).toContain('data-keep="1"')
  })

  it('keeps the inline styling an OpenLeaf document already saved', () => {
    expect(normalizePastedHtml(PRESERVED)).toContain('style="background:#eee"')
  })

  it('still strips styling from a foreign paste', () => {
    expect(normalizeGeneric('<p style="color:red">Red text</p>')).toBe('<p>Red text</p>')
  })
})

describe('Google Docs cleanup does not destroy italics', () => {
  it('keeps an <i> that carries a font-weight', () => {
    const out = normalizeGoogleDocs(asGoogleDocs('<p><i style="font-weight:normal">italic</i></p>'))
    expect(out).toMatch(/<(i|em)>italic<\/(i|em)>/)
  })

  it('still unwraps the not-bold <b> wrapper', () => {
    const out = normalizeGoogleDocs(asGoogleDocs('<p><b style="font-weight:normal"><i>real italic</i></b></p>'))
    expect(out).toContain('<p><i>real italic</i></p>')
  })
})

describe('parseStyle handles the CSS it claims to', () => {
  function styleOf(css: string): Map<string, string> {
    const el = document.createElement('div')
    el.setAttribute('style', css)
    return parseStyle(el)
  }

  it('does not end a quoted value at an escaped quote', () => {
    const style = styleOf('content:"a\\";b";color:red')
    expect(style.get('color')).toBe('red')
    expect(style.get('content')).toBe('"a\\";b"')
  })

  it('ignores semicolons inside a CSS comment', () => {
    const style = styleOf('color:/* ; */red;font-weight:bold')
    expect(style.get('color')).toBe('red')
    expect(style.get('font-weight')).toBe('bold')
  })

  it('does not treat a comment sequence inside a quoted value as a comment', () => {
    const style = styleOf('font-family:"/*";font-weight:bold')
    expect(style.get('font-weight')).toBe('bold')
  })
})

describe('semantic promotion does not duplicate the tag it already has', () => {
  it('does not wrap a bold <b> in a <strong>', () => {
    expect(normalizeGeneric('<p><b style="font-weight:bold">x</b></p>')).toBe('<p><b>x</b></p>')
  })

  it('does not wrap an italic <em> in an <em>', () => {
    expect(normalizeGeneric('<p><em style="font-style:italic">x</em></p>')).toBe('<p><em>x</em></p>')
  })

  it('still wraps when the tag differs', () => {
    expect(normalizeGeneric('<p><b style="font-style:italic">x</b></p>')).toContain('<em>x</em>')
  })
})

describe('a Word list that changes type at the top level', () => {
  function item(text: string, marker: string, level = 1, listId = 'l0'): string {
    return (
      `<p class="MsoListParagraph" style="mso-list:${listId} level${level} lfo1">` +
      `<span style="mso-list:Ignore">${marker}<span style="font:7.0pt">&nbsp; </span></span>` +
      `${text}</p>`
    )
  }

  /** A continuation paragraph: carries mso-list, but has no marker glyph. */
  function continuation(text: string, level = 1, listId = 'l0'): string {
    return `<p class="MsoListParagraph" style="mso-list:${listId} level${level} lfo1">${text}</p>`
  }

  it('starts a new list when the marker type changes at level 1', () => {
    const out = normalizeWord(item('Bullet', '·') + item('First', '1.') + item('Second', '2.'))
    expect(out).toContain('<ul>')
    expect(out).toMatch(/<ol[ >]/)
    expect(out).toMatch(/<\/ul><ol/)
    expect(out.match(/<li>/g)).toHaveLength(3)
  })

  it('does NOT split on a continuation paragraph, which has no marker at all', () => {
    // A markerless item reads as unordered for want of anywhere else to get an
    // answer. Splitting on that tears one <ol> into three lists around every
    // paragraph of trailing prose inside an item.
    const out = normalizeWord(item('One', '1.') + continuation('continuation text') + item('Two', '2.'))
    expect(out).not.toContain('<ul>')
    expect(out.match(/<ol[ >]/g)).toHaveLength(1)
    expect(out.match(/<li>/g)).toHaveLength(3)
    expect(out).toContain('continuation text')
  })
})
