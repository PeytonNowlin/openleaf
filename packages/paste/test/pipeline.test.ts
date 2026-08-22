import { coreSchema, parseHtml, serializeHtml } from '@openleaf-editor/core'
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
    if (node.type === coreSchema().nodes['unknown_block'] || node.type === coreSchema().nodes['unknown_inline']) {
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
    expect(out).toMatch(/<li><p>Revenue up 12%<\/p><ul><li>North region<\/li><\/ul><\/li>/)
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

describe('copying between OpenLeaf documents', () => {
  /**
   * A generic paste must not strip classes or data attributes.
   *
   * Copying a preserved `<div class="callout">` out of one OpenLeaf document
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

  /**
   * The same document copied out of the editor rather than typed into the test.
   *
   * ProseMirror stamps `data-pm-slice` on the HTML it puts on the clipboard, and
   * the class on this div is `MsoNormal` -- preserved Word residue, which is the
   * canonical thing preservation keeps. Routing on content alone sends this to
   * the Word stripper, which is how the guarantee above used to fail on the one
   * input it was written for.
   */
  const INTERNAL =
    '<p data-pm-slice="1 1 []">Intro.</p>' +
    '<div class="MsoNormal" data-callout-id="7"><p>Preserved.</p></div>'

  it('survives a copy out of the editor and back in', () => {
    const out = normalizePastedHtml(INTERNAL)
    expect(out).toContain('class="MsoNormal"')
    expect(out).toContain('data-callout-id="7"')
    expect(preservedAtoms(out)).toEqual([
      '<div class="MsoNormal" data-callout-id="7"><p>Preserved.</p></div>',
    ])
  })
})

describe('content the cleanup pipeline used to delete', () => {
  /**
   * The end-to-end version of the empty-block and table-attribute fixes: not
   * "did the normalizer keep it" but "does the schema get something it can
   * model". A pasted video that arrives as a preserved atom is a grey card
   * where the author expected a video, which is only marginally better than
   * the deletion it replaced.
   */
  const WORD_EMBED =
    '<p class="MsoNormal">Watch this:<o:p></o:p></p>' +
    '<p class="MsoNormal"><iframe src="https://www.youtube.com/embed/abc" ' +
    'width="560" height="315" title="Clip"></iframe></p>'

  it('keeps a Word-pasted embed and gives the schema a real iframe node', () => {
    const out = through(WORD_EMBED)
    expect(out).toContain('src="https://www.youtube.com/embed/abc"')
    expect(out).toContain('width="560"')
    expect(out).toContain('height="315"')
    expect(preservedAtoms(normalizePastedHtml(WORD_EMBED))).toEqual([])
  })

  const WORD_TABLE =
    '<table class="MsoTableGrid" width="600" style="border-collapse:collapse">' +
    '<tr><td width="200" valign="top">North</td>' +
    '<td width="400" valign="top">12%</td></tr></table>'

  it('keeps Word table geometry and gives the schema a real table', () => {
    const out = through(WORD_TABLE)
    expect(out).toContain('width="600"')
    expect(out).toContain('width="200"')
    expect(out).toContain('valign="top"')
    expect(preservedAtoms(normalizePastedHtml(WORD_TABLE))).toEqual([])
  })

  const WORD_QUOTE =
    '<p class="MsoNormal">He said <span lang="fr">bonjour</span> to me.<o:p></o:p></p>'

  it('keeps a language marking as the language mark the schema models', () => {
    const out = through(WORD_QUOTE)
    expect(out).toBe('<p>He said <span lang="fr">bonjour</span> to me.</p>')
    expect(preservedAtoms(normalizePastedHtml(WORD_QUOTE))).toEqual([])
  })
})
