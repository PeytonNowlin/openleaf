import { describe, expect, it } from 'vitest'
import {
  configureDOMPurify,
  DEFAULT_POLICY,
  policyForCarriedAttributes,
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
    ['iframe from an unknown host', '<p>ok</p><iframe src="https://evil.example"></iframe>'],
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

  it('keeps an allowlisted YouTube embed', () => {
    const html = '<iframe src="https://www.youtube.com/embed/abc" title="Clip" allowfullscreen></iframe>'
    expect(clean(html)).toContain('youtube.com/embed/abc')
  })

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

describe('the carried-attribute interaction', () => {
  /*
   * The same trap as above, one layer in. Core carries the attributes it does
   * not model on its OWN nodes now, so `<p class="lead">` survives the editor
   * and arrives at the server -- where a policy shaped around preserved
   * *elements* has no entry for it, because `p` was never the element anybody
   * thought needed widening.
   */
  const LEAD = '<p class="lead" data-cms="7" style="padding: 4px;">Lead.</p>'

  it('the DEFAULT policy strips carried residue from a plain <p>', () => {
    const out = clean(LEAD)
    expect(out).not.toContain('class="lead"')
    expect(out).not.toContain('data-cms')
    expect(out).not.toContain('padding')
    expect(out).toContain('Lead.')
  })

  it('policyForCarriedAttributes keeps it once the integrator says so', () => {
    const policy = policyForCarriedAttributes(DEFAULT_POLICY, {
      p: { attributes: ['class', 'data-cms', 'style'], styleProperties: ['padding'] },
    })
    expect(clean(LEAD, policy)).toBe(LEAD)
  })

  it('does not admit a declaration that has no checker, however it is named', () => {
    // The line both helpers stop at: naming a property is not the same as
    // knowing what a safe value of it looks like.
    const policy = policyForCarriedAttributes(DEFAULT_POLICY, {
      p: { attributes: ['style'], styleProperties: ['letter-spacing'] },
    })
    expect(clean('<p style="letter-spacing: 0.05em;">Lead.</p>', policy)).toBe('<p>Lead.</p>')
  })

  it('widens an element rather than replacing what it already allowed', () => {
    const policy = policyForCarriedAttributes(DEFAULT_POLICY, { p: ['class'] })
    const html = '<p class="lead" dir="ltr" style="text-align: center;">Lead.</p>'
    expect(clean(html, policy)).toBe(html)
  })

  it('still strips dangerous attributes from a widened core element', () => {
    const policy = policyForCarriedAttributes(DEFAULT_POLICY, { p: ['class'] })
    const out = clean('<p class="ok" onclick="alert(1)">t</p>', policy)
    expect(out).toContain('class="ok"')
    expect(out).not.toMatch(/onclick/i)
  })

  it('refuses an element from the dropWithContent list, like its sibling', () => {
    expect(() => policyForCarriedAttributes(DEFAULT_POLICY, { script: [] })).toThrow(
      /dropWithContent/,
    )
  })

  it('does not mutate the policy it extends', () => {
    const extended = policyForCarriedAttributes(DEFAULT_POLICY, { p: ['class'] })
    expect(extended.elements['p']?.attributes).toContain('class')
    expect(DEFAULT_POLICY.elements['p']?.attributes).not.toContain('class')
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
    expect(config.ALLOWED_ATTR).not.toContain('style')
    expect(config.FORBID_ATTR).toContain('style')
    expect(config.ALLOW_DATA_ATTR).toBe(false)
  })

  it('installs required hooks before enabling styles and embeds', () => {
    const hooks: string[] = []
    const purify = {
      addHook(name: string): void {
        hooks.push(name)
      },
    }
    const config = configureDOMPurify(purify, DEFAULT_POLICY)
    expect(hooks).toEqual(['uponSanitizeAttribute', 'uponSanitizeElement'])
    expect(config.ALLOWED_ATTR).toContain('style')
    expect(config.FORBID_ATTR).not.toContain('style')
    expect(config.ALLOWED_TAGS).toContain('iframe')
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
    expect(python).toContain('"ol": ["start", "style"]')
    expect(python).toContain('"a": ["href", "title", "target", "rel", "id"]')
    expect(python).toContain('ALLOWED_PROTOCOLS = ["http", "https"')
    expect(python).toContain('DROP_WITH_CONTENT')
    expect(python).toContain('def drop_with_content')
    // The drop must go through a parser. A regex pre-pass reconstitutes the
    // very tag it deletes: removing the inner pair from
    // `<for<form></form>m action=x>` leaves a live `<form action=x>`.
    expect(python).toContain('BeautifulSoup')
    expect(python).toContain('html5lib')
    expect(python).not.toContain('re.sub')
    expect(python).not.toMatch(/ALLOWED_TAGS = \[[^\]]*script/)
  })

  it('HTMLPurifier config encodes tag[attr] pairs', () => {
    const php = toHtmlPurifierConfig(DEFAULT_POLICY)
    expect(php).toContain('HTML.Allowed')
    expect(php).toContain('ol[start|style]')
    expect(php).toContain('a[href|title|target|rel|id]')
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

/**
 * The hardening below is all defence in depth: under DEFAULT_POLICY every one
 * of these cases was already handled. The point is that each was handled as an
 * *emergent property* of the allowlist happening to be narrow, so a caller who
 * widened one element's attribute list -- a supported, documented thing to do
 * -- silently lost the protection. A denial that holds only while nobody uses
 * the extension mechanism is not a security property.
 */
describe('protections that do not depend on the policy staying narrow', () => {
  it('strips on* handlers even when a policy explicitly permits them', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, { div: ['class', 'onclick'] })
    const out = sanitizeHtml('<div class="k" onclick="alert(1)">x</div>', { policy })
    expect(out).not.toContain('onclick')
    expect(out).toContain('class="k"')
  })

  it('strips srcdoc, formaction and ping even when permitted', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, {
      div: ['srcdoc', 'formaction', 'ping'],
    })
    const out = sanitizeHtml(
      '<div srcdoc="<script>alert(1)</script>" formaction="/x" ping="/y">x</div>',
      { policy },
    )
    expect(out).not.toContain('srcdoc')
    expect(out).not.toContain('formaction')
    expect(out).not.toContain('ping')
  })

  /*
   * `DEFAULT_POLICY` permitted `srcset` on `<source>` and no checker read it:
   * not in `NEVER_ALLOWED`, not in `urlAttributes`. So
   * `<picture><source srcset="https://evil.example/track.png 1x"></picture>`
   * survived verbatim, with an attacker-chosen URL list nothing validated --
   * while content-policy classifies the attribute as never-carryable on exactly
   * that ground ("comma-separated URL lists no single-URL check reads") and
   * core's security suite pins that the editor strips it.
   */
  it('drops srcset from the element the default policy used to permit it on', () => {
    const out = clean('<picture><source srcset="https://evil.example/track.png 1x"></picture>')
    expect(out).not.toContain('srcset')
    expect(out).not.toContain('evil.example')
  })

  it('strips srcset and imagesrcset even when a policy permits them', () => {
    const policy = policyForPreserved(DEFAULT_POLICY, {
      div: ['class', 'srcset', 'imagesrcset'],
    })
    const out = sanitizeHtml(
      '<div class="k" srcset="https://evil.example/a.png 1x" imagesrcset="https://evil.example/b.png">x</div>',
      { policy },
    )
    expect(out).not.toContain('srcset')
    expect(out).not.toContain('evil.example')
    // The rest of the widening still works: this is a targeted refusal, not a
    // policy the enforcer ignores.
    expect(out).toContain('class="k"')
  })

  it('keeps the attributes on <source> that are not URL lists', () => {
    const out = clean(
      '<video controls><source src="/a.webm" type="video/webm" media="(min-width: 40em)" sizes="100vw"></video>',
    )
    expect(out).toContain('src="/a.webm"')
    expect(out).toContain('type="video/webm"')
    expect(out).toContain('media="(min-width: 40em)"')
  })

  it('removes HTML comments rather than re-emitting them verbatim', () => {
    // Inert as parsed here, and live the moment a downstream template layer
    // unwraps or regex-strips comments -- a routine thing for one to do.
    const out = clean('<p>a</p><!--<img src=x onerror=alert(1)>--><p>b</p>')
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('onerror')
    expect(out).toBe('<p>a</p><p>b</p>')
  })

  it('removes comments nested inside allowed elements too', () => {
    expect(clean('<p>a<!-- secret -->b</p>')).toBe('<p>ab</p>')
  })
})

describe('the shared policy objects are immutable', () => {
  it('refuses a write to DEFAULT_POLICY', () => {
    // Unfrozen this was a process-wide switch: one line anywhere on the page
    // reconfigured every later sanitizeHtml() call, with no call site changed.
    expect(() => {
      ;(DEFAULT_POLICY.globalAttributes as string[]).push('onclick')
    }).toThrow(TypeError)
    expect(DEFAULT_POLICY.globalAttributes).toHaveLength(0)
  })

  it('refuses a write to a nested element policy', () => {
    expect(() => {
      ;(DEFAULT_POLICY.elements['a']?.attributes as string[]).push('onclick')
    }).toThrow(TypeError)
  })

  it('gives policyForPreserved a policy that does not alias the base', () => {
    const derived = policyForPreserved(DEFAULT_POLICY, { div: ['class'] })
    expect(derived.dropWithContent).not.toBe(DEFAULT_POLICY.dropWithContent)
    expect(derived.urlSchemes).not.toBe(DEFAULT_POLICY.urlSchemes)
    expect(derived.urlAttributes).not.toBe(DEFAULT_POLICY.urlAttributes)
    expect(derived.globalAttributes).not.toBe(DEFAULT_POLICY.globalAttributes)
    expect(derived.elements['a']).not.toBe(DEFAULT_POLICY.elements['a'])

    // And mutating the derived one leaves the default alone, which is the
    // whole reason the copy has to be deep.
    derived.urlSchemes.push('javascript')
    expect(DEFAULT_POLICY.urlSchemes).not.toContain('javascript')
  })
})

describe('the DOMPurify config keeps DOMPurify’s own hardening', () => {
  it('unions FORBID_CONTENTS rather than replacing the default', () => {
    // DOMPurify merges config by assignment, so returning the bare
    // dropWithContent list silently dropped the mXSS defence its maintainers
    // chose -- losing somebody else's hardening as a side effect of naming two
    // tags of our own.
    const contents = toDOMPurifyConfig(DEFAULT_POLICY).FORBID_CONTENTS
    for (const tag of ['annotation-xml', 'foreignobject', 'noembed', 'noframes', 'xmp', 'mtext']) {
      expect(contents).toContain(tag)
    }
    // And still carries our own additions.
    for (const tag of DEFAULT_POLICY.dropWithContent) expect(contents).toContain(tag)
  })
})
