import { describe, expect, it } from 'vitest'
import { parseHtml, serializeHtml } from '../src/index.js'

/**
 * What the preservation layer does with dangerous markup.
 *
 * This is the one place where OpenLeaf's two strongest instincts pull in
 * opposite directions. The preservation layer exists to keep markup the schema
 * does not recognise, because silently deleting a customer's content is the
 * failure this project was built to prevent. But "markup the schema does not
 * recognise" includes `<script>`.
 *
 * Preserving an author's `<div class="callout">` is the product working.
 * Preserving a `<script>` is a vulnerability with extra steps.
 */

function roundTrip(html: string): string {
  return serializeHtml(parseHtml(html))
}

describe('executable content must not survive the round trip', () => {
  it('drops <script> entirely', () => {
    const out = roundTrip('<p>ok</p><script>alert(1)</script>')
    expect(out).not.toContain('script')
    expect(out).toContain('<p>ok</p>')
  })

  it('drops <iframe>', () => {
    expect(roundTrip('<p>ok</p><iframe src="https://evil.example"></iframe>')).not.toContain('iframe')
  })

  it('drops <object> and <embed>', () => {
    expect(roundTrip('<object data="x.swf"></object>')).not.toContain('object')
    expect(roundTrip('<embed src="x.swf">')).not.toContain('embed')
  })

  it('drops <form> and its inputs', () => {
    const out = roundTrip('<form action="/steal"><input name="pw"></form>')
    expect(out).not.toContain('form')
    expect(out).not.toContain('input')
  })

  it('drops <style>, which can exfiltrate and can overlay the page', () => {
    expect(roundTrip('<style>body{display:none}</style>')).not.toContain('style>')
  })

  it('strips event handler attributes from preserved markup', () => {
    const out = roundTrip('<div class="callout" onclick="alert(1)">text</div>')
    expect(out).not.toMatch(/onclick/i)
    // ...while still preserving the wrapper the author cared about.
    expect(out).toContain('class="callout"')
  })

  it('strips event handlers regardless of case or whitespace', () => {
    expect(roundTrip('<div class="x" OnClick="alert(1)">t</div>')).not.toMatch(/onclick/i)
    expect(roundTrip('<div class="x" onmouseover="alert(1)">t</div>')).not.toMatch(/onmouseover/i)
  })
})

describe('dangerous URLs must not survive', () => {
  it('drops a javascript: href', () => {
    expect(roundTrip('<p><a href="javascript:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
  })

  it('drops javascript: obfuscated with whitespace and entities', () => {
    expect(roundTrip('<p><a href="java\tscript:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
    expect(roundTrip('<p><a href=" JAVASCRIPT:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
  })

  it('drops a javascript: image src', () => {
    expect(roundTrip('<p><img src="javascript:alert(1)"></p>')).not.toMatch(/javascript:/i)
  })

  it('keeps ordinary links and images', () => {
    expect(roundTrip('<p><a href="https://example.org">x</a></p>')).toContain('https://example.org')
    expect(roundTrip('<p><a href="/about">x</a></p>')).toContain('/about')
    expect(roundTrip('<p><a href="mailto:a@example.org">x</a></p>')).toContain('mailto:')
    expect(roundTrip('<p><img src="/a.png" alt="a"></p>')).toContain('/a.png')
  })

  it('keeps a preserved element that carries a safe URL', () => {
    const out = roundTrip('<div class="embed" data-src="https://example.org/x"></div>')
    expect(out).toContain('https://example.org/x')
  })
})

describe('what preservation still guarantees', () => {
  it('keeps unrecognised but harmless markup', () => {
    const out = roundTrip('<drupal-media data-entity-uuid="abc"></drupal-media>')
    expect(out).toContain('data-entity-uuid="abc"')
  })

  it('keeps legacy presentational tags', () => {
    expect(roundTrip('<p><font face="Verdana">old</font></p>')).toContain('face="Verdana"')
  })
})
