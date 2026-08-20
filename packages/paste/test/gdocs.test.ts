import { describe, expect, it } from 'vitest'
import { detectSource, normalizePastedHtml } from '../src/index.js'
import { normalizeGoogleDocs } from '../src/gdocs.js'

/** A realistic Google Docs clipboard payload. */
const GDOCS =
  '<meta charset="utf-8">' +
  '<b style="font-weight:normal" id="docs-internal-guid-a1b2c3d4-7fff-1234">' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt">' +
  '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;' +
  'font-style:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap">' +
  'A pasted paragraph with </span>' +
  '<span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;' +
  'white-space:pre-wrap">bold text</span>' +
  '<span style="font-size:11pt;white-space:pre-wrap"> and an </span>' +
  '<a href="https://example.org/spec" style="text-decoration:none">' +
  '<span style="font-size:11pt;color:#1155cc;text-decoration:underline;white-space:pre-wrap">' +
  'inline link</span></a>' +
  '<span style="font-size:11pt;white-space:pre-wrap">.</span>' +
  '</p></b>'

describe('detection', () => {
  it('recognises Google Docs markup', () => {
    expect(detectSource(GDOCS)).toBe('gdocs')
  })
})

describe('the font-weight:normal bold wrapper', () => {
  it('does not bold the entire document', () => {
    // <b style="font-weight:normal"> wraps every Google Docs paste. Trusting
    // the tag name over the style turns the whole paste bold.
    const out = normalizeGoogleDocs(GDOCS)
    expect(out).not.toMatch(/^<(b|strong)>/)
    expect(out).not.toContain('<strong>A pasted paragraph')
  })

  it('still promotes genuinely bold runs', () => {
    expect(normalizeGoogleDocs(GDOCS)).toContain('<strong>bold text</strong>')
  })

  it('removes the internal guid', () => {
    expect(normalizeGoogleDocs(GDOCS)).not.toContain('docs-internal-guid')
  })
})

describe('vendor styling removal', () => {
  const out = normalizeGoogleDocs(GDOCS)

  it('strips the line-height and font-family noise', () => {
    expect(out).not.toContain('line-height')
    expect(out).not.toContain('Arial')
    expect(out).not.toContain('white-space')
    expect(out).not.toContain('style=')
  })

  it('collapses the spans that carried only styling', () => {
    expect(out).not.toContain('<span')
  })

  it('removes the pasted <meta> tag', () => {
    expect(out).not.toContain('<meta')
  })
})

describe('links', () => {
  const out = normalizeGoogleDocs(GDOCS)

  it('keeps the href', () => {
    expect(out).toContain('href="https://example.org/spec"')
  })

  it('does not add a redundant <u> inside the link', () => {
    // Google decorates the span inside every link with
    // text-decoration:underline. Links are underlined already, so promoting it
    // would put a <u> inside every <a> in the document.
    expect(out).not.toContain('<u>')
  })

  it('keeps the link text', () => {
    expect(out).toContain('inline link')
  })
})

describe('content that must survive', () => {
  it('preserves the full sentence', () => {
    const out = normalizeGoogleDocs(GDOCS)
    const text = out.replace(/<[^>]+>/g, '')
    expect(text).toBe('A pasted paragraph with bold text and an inline link.')
  })

  it('preserves dir, which is text direction and not styling', () => {
    expect(normalizeGoogleDocs(GDOCS)).toContain('dir="ltr"')
  })

  it('keeps real lists that Google emits properly', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x">' +
      '<ul><li><p dir="ltr"><span style="font-size:11pt">One</span></p></li>' +
      '<li><p dir="ltr"><span style="font-size:11pt">Two</span></p></li></ul></b>'
    const out = normalizeGoogleDocs(html)
    expect(out).toContain('<ul>')
    expect(out.match(/<li>/g)).toHaveLength(2)
    expect(out).toContain('One')
    expect(out).toContain('Two')
  })

  it('unwraps the Google Sheets origin wrapper so the table is editable', () => {
    const html =
      '<google-sheets-html-origin><table><tbody><tr><td>A</td></tr></tbody></table></google-sheets-html-origin>'
    expect(detectSource(html)).toBe('gdocs')
    const out = normalizePastedHtml(html)
    expect(out).not.toContain('google-sheets-html-origin')
    expect(out).toContain('<table>')
    expect(out).toContain('A')
  })
})

describe('vendor styling', () => {
  /*
   * The guarantee moved here from the schema-level backstop in
   * fidelity.test.ts. `line-height` became a modelled property, so the schema
   * now reads it -- correctly, since an author can set it deliberately and the
   * schema cannot tell that apart from Google Docs' 1.38 default. Which makes
   * this the only place the promise still holds: a paste is the one moment the
   * author has asked for the source's appearance NOT to come along.
   */
  it('brings none of the source styling with it', () => {
    const out = normalizePastedHtml(GDOCS)
    for (const artefact of ['line-height', 'font-size', 'font-family', 'white-space', 'vertical-align']) {
      expect(out, artefact).not.toContain(artefact)
    }
  })

  it('keeps no style attribute at all', () => {
    expect(normalizePastedHtml(GDOCS)).not.toContain('style=')
  })

  // Stripping styles must not cost the formatting they encoded: Google Docs
  // spells bold as `font-weight:700` on a span, so a normalizer that stripped
  // first and promoted second would flatten the whole paste to plain text.
  it('promotes the formatting those styles encoded before dropping them', () => {
    const out = normalizePastedHtml(GDOCS)
    expect(out).toContain('<strong>bold text</strong>')
  })
})

describe('idempotence', () => {
  it('normalizing already-clean output changes nothing', () => {
    const once = normalizePastedHtml(GDOCS)
    expect(normalizePastedHtml(once)).toBe(once)
  })
})
