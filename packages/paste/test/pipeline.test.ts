import { parseHtml, schema, serializeHtml } from '@openleaf/core'
import { describe, expect, it } from 'vitest'
import { normalizeGeneric, normalizePastedHtml } from '../src/index.js'

/**
 * The normalizers and the schema tested together, because either one can be
 * correct in isolation while the pair is broken.
 *
 * The strongest signal available here: **how much of a normalized paste ends
 * up in the preservation layer.** Unrecognised markup is preserved as an opaque
 * atom, which is the right behaviour for a customer's stored document but the
 * wrong outcome for a paste -- the author sees an inert grey card where they
 * expected a list. So a normalizer's real quality bar is not "did it strip the
 * junk" but "does the result parse to zero preserved atoms".
 */

function through(html: string): string {
  return serializeHtml(parseHtml(normalizePastedHtml(html)))
}

/** Count nodes that landed in the preservation layer. */
function preservedAtoms(html: string): string[] {
  const doc = parseHtml(html)
  const found: string[] = []
  doc.descendants((node) => {
    if (node.type === schema.nodes['unknown_block'] || node.type === schema.nodes['unknown_inline']) {
      found.push(node.attrs['html'] as string)
    }
    return true
  })
  return found
}

const WORD_LIST =
  '<p class="MsoNormal" style="line-height:normal"><span style="font-family:Calibri">' +
  'Quarterly review<o:p></o:p></span></p>' +
  '<p class="MsoListParagraphCxSpFirst" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Symbol">·<span style="font:7.0pt">&nbsp; ' +
  '</span></span><!--[endif]-->Revenue up 12%<o:p></o:p></p>' +
  '<p class="MsoListParagraphCxSpMiddle" style="text-indent:-.25in;mso-list:l0 level2 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Courier New">o<span style="font:7.0pt">&nbsp; ' +
  '</span></span><!--[endif]-->North region<o:p></o:p></p>' +
  '<p class="MsoListParagraphCxSpLast" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Symbol">·<span style="font:7.0pt">&nbsp; ' +
  '</span></span><!--[endif]-->Churn down to 3.1%<o:p></o:p></p>'

const GDOCS =
  '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-abc">' +
  '<p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;white-space:pre-wrap">' +
  'Plain and </span><span style="font-weight:700;white-space:pre-wrap">bold</span></p></b>'

describe('Word paste through the full pipeline', () => {
  const out = through(WORD_LIST)

  it('produces real nested lists the schema accepts', () => {
    expect(out).toContain('<ul>')
    expect(out).toMatch(/<li><p>Revenue up 12%<\/p><ul><li><p>North region<\/p><\/li><\/ul><\/li>/)
  })

  it('keeps every word of the content', () => {
    const text = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(text).toBe('Quarterly review Revenue up 12% North region Churn down to 3.1%')
  })

  it('leaves no bullet glyphs behind', () => {
    expect(out).not.toContain('·')
    expect(out).not.toMatch(/>o</)
  })

  it('leaves no vendor styling behind', () => {
    expect(out).not.toMatch(/mso-|Mso|Calibri|Symbol|Courier|style=/i)
  })

  it('produces ZERO preserved atoms -- the real quality bar', () => {
    // Anything here would surface to the author as an inert grey card in place
    // of their content.
    expect(preservedAtoms(normalizePastedHtml(WORD_LIST))).toEqual([])
  })

  it('is stable through a second round trip', () => {
    expect(serializeHtml(parseHtml(out))).toBe(out)
  })
})

describe('Google Docs paste through the full pipeline', () => {
  const out = through(GDOCS)

  it('yields clean semantic markup', () => {
    expect(out).toContain('<strong>bold</strong>')
    expect(out).not.toContain('<span')
    expect(out).not.toContain('style=')
  })

  it('preserves text direction', () => {
    expect(out).toContain('dir="ltr"')
  })

  it('produces zero preserved atoms', () => {
    expect(preservedAtoms(normalizePastedHtml(GDOCS))).toEqual([])
  })
})

describe('copying between Openleaf documents', () => {
  /**
   * A generic paste must not strip classes or data attributes.
   *
   * Copying a preserved `<div class="callout">` out of one Openleaf document
   * and into another goes through the generic normalizer. If that stripped
   * classes -- as an aggressive paste cleaner reasonably might -- it would
   * silently destroy exactly the markup the preservation layer exists to
   * protect, and it would do so on the most ordinary user action there is.
   */
  const CALLOUT = '<p>Intro.</p><div class="callout" data-callout-id="7"><p>Preserved.</p></div>'

  it('keeps the class and data attributes intact', () => {
    const out = normalizeGeneric(CALLOUT)
    expect(out).toContain('class="callout"')
    expect(out).toContain('data-callout-id="7"')
  })

  it('survives a full copy, paste and save cycle unchanged', () => {
    expect(serializeHtml(parseHtml(normalizeGeneric(CALLOUT)))).toBe(CALLOUT)
  })

  it('still strips inline styling from a generic paste', () => {
    const out = normalizeGeneric('<p style="color:red">Red text</p>')
    expect(out).toBe('<p>Red text</p>')
  })

  it('promotes emphasis from a plain website paste', () => {
    const out = normalizeGeneric('<p><span style="font-weight:bold">Bold</span></p>')
    expect(out).toContain('<strong>Bold</strong>')
  })
})
