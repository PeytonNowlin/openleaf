import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  policyForPreserved,
  sanitizeHtml,
  toBleachConfig,
  toDOMPurifyConfig,
  toHtmlPurifierConfig,
} from '../src/index.js'

const clean = (html: string, policy = DEFAULT_POLICY): string =>
  sanitizeHtml(html, { policy })

describe('executable content', () => {
  const vectors: Array<[string, string]> = [
    ['script tag', '<p>ok</p><script>alert(1)</script>'],
    ['iframe', '<p>ok</p><iframe src="https://evil.example"></iframe>'],
    ['object', '<p>ok</p><object data="x.swf"></object>'],
    ['embed', '<p>ok</p><embed src="x.swf">'],
    ['form and input', '<p>ok</p><form action="/steal"><input name="pw"></form>'],
    ['style block', '<p>ok</p><style>body{display:none}</style>'],
    ['svg with script', '<p>ok</p><svg><script>alert(1)</script></svg>'],
    ['math', '<p>ok</p><math><mtext></mtext></math>'],
    ['base tag', '<p>ok</p><base href="https://evil.example/">'],
    ['meta refresh', '<p>ok</p><meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ]

  for (const [name, vector] of vectors) {
    it(`neutralizes ${name}`, () => {
      const out = clean(vector)
      expect(out).toContain('<p>ok</p>')
      expect(out).not.toMatch(/<(script|iframe|object|embed|form|input|style|svg|math|base|meta)\b/i)
      expect(out).not.toContain('alert(1)')
    })
  }

  it('removes the CONTENT of a dropped element, not just its tags', () => {
    // Unwrapping a <script> would leave the literal text "alert(1)" in the
    // document -- a different kind of wrong, and one that looks like it worked.
    expect(clean('<script>alert(1)</script>')).toBe('')
    expect(clean('<style>body{x:y}</style>')).toBe('')
  })

  it('strips event handler attributes', () => {
    const out = clean('<p onclick="alert(1)" onmouseover="alert(2)">text</p>')
    expect(out).toBe('<p>text</p>')
  })

  it('strips event handlers regardless of case', () => {
    expect(clean('<p OnClick="alert(1)">t</p>')).toBe('<p>t</p>')
  })
})

describe('dangerous URLs', () => {
  it('drops a javascript: href but keeps the link text', () => {
    const out = clean('<p><a href="javascript:alert(1)">click me</a></p>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('click me')
  })

  it('drops javascript: obfuscated with control characters', () => {
    expect(clean('<p><a href="java\tscript:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
    expect(clean('<p><a href="java\nscript:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
    expect(clean('<p><a href="  JAVASCRIPT:alert(1)">x</a></p>')).not.toMatch(/javascript:/i)
  })

  it('drops data: URLs, including data:text/html', () => {
    expect(clean('<p><a href="data:text/html,<script>alert(1)</script>">x</a></p>'))
      .not.toMatch(/data:/i)
    // Even data:image is refused by the default policy, because separating safe
    // data URLs from dangerous ones by media type is the parsing that gets defeated.
    expect(clean('<p><img src="data:image/png;base64,iVBOR"></p>')).not.toMatch(/data:/i)
  })

  it('drops vbscript:', () => {
    expect(clean('<p><a href="vbscript:msgbox(1)">x</a></p>')).not.toMatch(/vbscript:/i)
  })

  it('keeps ordinary URLs', () => {
    expect(clean('<p><a href="https://example.org">x</a></p>')).toContain('https://example.org')
    expect(clean('<p><a href="/about">x</a></p>')).toContain('/about')
    expect(clean('<p><a href="#section">x</a></p>')).toContain('#section')
    expect(clean('<p><a href="mailto:a@example.org">x</a></p>')).toContain('mailto:')
    expect(clean('<p><a href="tel:+15551234">x</a></p>')).toContain('tel:')
  })

  it('adds noopener to a link that opens a new window', () => {
    // Without it the opened page gets a handle on the opener's window.
    const out = clean('<p><a href="https://example.org" target="_blank">x</a></p>')
    expect(out).toContain('noopener')
  })
})

describe('ordinary content survives', () => {
  it('keeps the schema\'s own output untouched', () => {
    const html =
      '<h2>Heading</h2><p>Text with <strong>bold</strong>, <em>italic</em>, ' +
      '<u>underline</u> and <s>strike</s>.</p>' +
      '<blockquote><p>Quoted.</p></blockquote>' +
      '<ul><li><p>One</p></li></ul>' +
      '<ol start="3"><li><p>Three</p></li></ol>' +
      '<pre><code>const x = 1</code></pre><hr>' +
      '<p><a href="https://example.org" title="T">link</a> and ' +
      '<img src="/a.png" alt="described"></p>'
    expect(clean(html)).toBe(html)
  })

  it('keeps dir, which is text direction and not formatting', () => {
    expect(clean('<p dir="rtl">نص</p>')).toBe('<p dir="rtl">نص</p>')
  })

  it('unwraps an unknown element rather than deleting its text', () => {
    // Deleting a paragraph because it sat inside an unrecognised styling
    // wrapper would be a content-loss bug of exactly the kind this project
    // exists to avoid.
    expect(clean('<section><p>kept</p></section>')).toBe('<p>kept</p>')
  })
})

describe('the preservation interaction', () => {
  const CALLOUT = '<p>Intro.</p><div class="callout" data-callout-id="7"><p>Preserved.</p></div>'

  it('the DEFAULT policy strips preserved markup — by design, and this is the trap', () => {
    // OpenLeaf's preservation layer deliberately keeps a <div class="callout">
    // that the schema does not recognise. A default-safe policy then removes it
    // on the server, destroying the content the editor worked to save. Asserted
    // here so the behaviour is documented rather than discovered.
    const out = clean(CALLOUT)
    expect(out).not.toContain('class="callout"')
    expect(out).toContain('Preserved.')
  })

  it('policyForPreserved keeps it once the integrator says so explicitly', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, {
      div: ['class', 'data-callout-id'],
    })
    const out = clean(CALLOUT, policy)
    expect(out).toContain('class="callout"')
    expect(out).toContain('data-callout-id="7"')
    expect(out).toBe(CALLOUT)
  })

  it('supports custom elements such as Drupal media', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, {
      'drupal-media': ['data-entity-type', 'data-entity-uuid', 'data-view-mode'],
    })
    const html = '<drupal-media data-entity-uuid="abc-123" data-view-mode="wide"></drupal-media>'
    expect(clean(html, policy)).toBe(html)
  })

  it('still strips dangerous attributes from newly allowed elements', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, { div: ['class'] })
    const out = clean('<div class="ok" onclick="alert(1)">t</div>', policy)
    expect(out).toContain('class="ok"')
    expect(out).not.toMatch(/onclick/i)
  })

  it('refuses to allow an element from the dropWithContent list', () => {
    // An integrator asking for <script> has almost certainly made a mistake.
    // Failing loudly beats quietly permitting it.
    expect(() => policyForPreserved(DEFAULT_POLICY, { script: [] })).toThrow(/dropWithContent/)
  })

  it('does not mutate the policy it extends', () => {
    const extended = policyForPreserved(DEFAULT_POLICY, { div: ['class'] })
    expect(extended.elements['div']).toBeDefined()
    expect(DEFAULT_POLICY.elements['div']).toBeUndefined()
  })
})

describe('adapters keep the runtimes in agreement', () => {
  it('DOMPurify config lists the policy tags and forbids the dangerous ones', () => {
    const config = toDOMPurifyConfig(DEFAULT_POLICY)
    expect(config.ALLOWED_TAGS).toContain('p')
    expect(config.ALLOWED_TAGS).toContain('img')
    expect(config.ALLOWED_TAGS).not.toContain('script')
    expect(config.FORBID_TAGS).toContain('script')
    expect(config.FORBID_CONTENTS).toContain('form')
    expect(config.ALLOWED_ATTR).toContain('href')
    expect(config.ALLOW_DATA_ATTR).toBe(false)
  })

  it('the DOMPurify URI pattern accepts safe schemes and rejects javascript:', () => {
    const { ALLOWED_URI_REGEXP } = toDOMPurifyConfig(DEFAULT_POLICY)
    expect(ALLOWED_URI_REGEXP.test('https://example.org')).toBe(true)
    expect(ALLOWED_URI_REGEXP.test('mailto:a@example.org')).toBe(true)
    expect(ALLOWED_URI_REGEXP.test('javascript:alert(1)')).toBe(false)
    expect(ALLOWED_URI_REGEXP.test('data:text/html,x')).toBe(false)
  })

  it('bleach config keeps per-element attribute precision', () => {
    const python = toBleachConfig(DEFAULT_POLICY)
    expect(python).toContain('ALLOWED_TAGS')
    expect(python).toContain('"ol": ["start"]')
    expect(python).toContain('"a": ["href", "title", "target", "rel"]')
    expect(python).toContain('ALLOWED_PROTOCOLS = ["http", "https"')
    expect(python).toContain('DROP_WITH_CONTENT')
    expect(python).toContain('def drop_with_content')
    expect(python).not.toMatch(/ALLOWED_TAGS = \[[^\]]*script/)
  })

  it('HTMLPurifier config encodes tag[attr] pairs', () => {
    const php = toHtmlPurifierConfig(DEFAULT_POLICY)
    expect(php).toContain('HTML.Allowed')
    expect(php).toContain('ol[start]')
    expect(php).toContain('a[href|title|target|rel]')
    expect(php).toContain('"https" => true')
    expect(php).toContain('TargetNoopener')
    expect(php).toContain("'_self'")
    expect(php).toContain("'_parent'")
    expect(php).toContain("'_top'")
  })

  it('every adapter reflects a policy extension', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, { 'drupal-media': ['data-entity-uuid'] })
    expect(toDOMPurifyConfig(policy).ALLOWED_TAGS).toContain('drupal-media')
    expect(toBleachConfig(policy)).toContain('drupal-media')
    expect(toHtmlPurifierConfig(policy)).toContain('drupal-media[data-entity-uuid]')
  })
})
