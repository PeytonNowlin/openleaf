import { DROP_WITH_CONTENT } from '@openleaf-editor/content-policy'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  EMBED_HOSTS,
  coreSchema,
  insertImage,
  parseHtml,
  serializeHtml,
  setLink,
} from '../src/index.js'
import { NEVER_PRESERVE } from '../src/preserve.js'

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

  it('drops a hostile iframe and keeps an allowlisted player', () => {
    expect(roundTrip('<p>ok</p><iframe src="https://evil.example"></iframe>')).not.toContain('iframe')
    expect(roundTrip('<iframe src="https://www.youtube.com/embed/abc" title="Clip"></iframe>')).toContain(
      'youtube.com/embed/abc',
    )
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
    // `face` on its own is the font-family mark now, so it converts. Two
    // attributes is the case no mark can hold, which is what preservation is for.
    expect(roundTrip('<p><font face="Verdana" size="2">old</font></p>')).toContain('face="Verdana"')
  })
})

describe('the embed allowlist is immutable at runtime', () => {
  /*
   * `EMBED_HOSTS` is the entire difference between an iframe the editor renders
   * and an attacker-controlled page nested inside the document. It was declared
   * `readonly EmbedHostRule[]`, which is a compile-time annotation: erased at
   * build time, so it stops a TypeScript consumer and nobody else -- not plain
   * JavaScript, not a cast, and not the compromised transitive dependency that
   * is the reason to care in the first place.
   */
  it('refuses a pushed host', () => {
    expect(Object.isFrozen(EMBED_HOSTS)).toBe(true)
    expect(() => {
      ;(EMBED_HOSTS as unknown as { push(rule: unknown): void }).push({ host: 'evil.example' })
    }).toThrow(TypeError)
    expect(EMBED_HOSTS.some((rule) => rule.host === 'evil.example')).toBe(false)
  })

  it('refuses an edit to an existing rule', () => {
    expect(() => {
      ;(EMBED_HOSTS[0] as { host: string }).host = 'evil.example'
    }).toThrow(TypeError)
  })
})

/**
 * `srcdoc` is not a URL, and treating it as one waved a whole HTML document
 * through the scheme check. `SCHEME.exec('<script>alert(1)</script>')` finds no
 * scheme, and "no scheme" meant "relative, therefore safe". A `srcdoc` frame is
 * same-origin with the page that embeds it, so what came through was script
 * execution in the author's own session.
 *
 * The three-state answer is the fix: an attribute is a URL, or it is inert, or
 * it carries markup and is never carried at all.
 */
describe('markup-bearing attributes are never carried', () => {
  it('drops srcdoc from an iframe inside a preserved wrapper', () => {
    // The wrapper's `class` is the entire bypass: it makes the <div> opaque, so
    // the subtree is claimed as an atom and scrub() becomes the only filter.
    const out = roundTrip('<div class="c"><iframe srcdoc="<script>alert(1)</script>"></iframe></div>')
    expect(out).not.toMatch(/srcdoc/i)
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(1\)/)
  })

  it('drops srcdoc from an allowlisted embed', () => {
    // `srcdoc` takes precedence over `src` per the HTML spec, so an allowlisted
    // host is no defence at all: the frame renders the attacker's document and
    // never fetches YouTube. This path never reaches scrub(), because the iframe
    // node claims the element and the residue rides in on the carry mechanism.
    const out = roundTrip(
      '<iframe src="https://www.youtube.com/embed/abc" srcdoc="<script>alert(1)</script>">',
    )
    expect(out).toContain('youtube.com/embed/abc')
    expect(out).not.toMatch(/srcdoc/i)
    expect(out).not.toMatch(/<script/i)
  })

  it('drops srcdoc whatever case it is written in', () => {
    expect(roundTrip('<div class="c"><iframe SRCDOC="<script>alert(1)</script>"></iframe></div>'))
      .not.toMatch(/srcdoc/i)
    expect(
      roundTrip('<iframe src="https://www.youtube.com/embed/abc" SrcDoc="<b>x</b>">'),
    ).not.toMatch(/srcdoc/i)
  })

  it('drops the other attributes that resolve to markup or to a second URL', () => {
    // Each of these is a relative URL by the scheme check's reckoning, so each
    // survived it. `srcset` and `imagesrcset` name URLs the check never sees;
    // `formaction` retargets a submission; `xlink:href` is the SVG spelling of
    // href and is not covered by the HTML one.
    const out = roundTrip(
      '<div class="c" formaction="/steal" xlink:href="/x">' +
        '<img src="/a.png" srcset="/evil.png 1x" imagesrcset="/evil.png 2x">' +
        '</div>',
    )
    expect(out).not.toMatch(/formaction/i)
    expect(out).not.toMatch(/srcset/i)
    expect(out).not.toMatch(/imagesrcset/i)
    expect(out).not.toMatch(/xlink:href/i)
    // ...while the wrapper the author cared about is still there.
    expect(out).toContain('class="c"')
  })
})

/**
 * A bare `<iframe src="https://evil.example/">` was always dropped. One
 * attribute-bearing ancestor turned that off: the catch-all claimed the subtree
 * as an opaque atom and scrub() filtered by tag name against a list with no
 * `iframe` in it. `class="c"` on a wrapper defeated both the host allowlist and
 * the permissions filter.
 */
describe('a frame never rides in inside a preserved atom', () => {
  it('drops a hostile iframe wrapped in a preserved div', () => {
    const out = roundTrip(
      '<div class="c"><iframe src="https://evil.example/" ' +
        'allow="camera; microphone; geolocation"></iframe></div>',
    )
    expect(out).not.toMatch(/iframe/i)
    expect(out).not.toContain('evil.example')
    expect(out).not.toMatch(/camera/i)
    expect(out).toContain('class="c"')
  })

  it('drops even an allowlisted player when it is wrapped', () => {
    // Preservation stores markup as a string and re-emits it verbatim, so a
    // frame inside an atom is never re-checked on the way out. The modelled
    // embed node is the only place an iframe is allowed to live.
    const out = roundTrip('<div class="c"><iframe src="https://www.youtube.com/embed/abc"></iframe></div>')
    expect(out).not.toMatch(/iframe/i)
  })

  it('still keeps the allowlisted player at the top level', () => {
    expect(roundTrip('<iframe src="https://www.youtube.com/embed/abc" title="Clip"></iframe>'))
      .toContain('youtube.com/embed/abc')
  })
})

/**
 * SVG SMIL rewrites an attribute after every static check has run.
 * `<animate attributeName="href" values="javascript:alert(1)">` moves the URL
 * out of the attribute the checker watches and into one it has no reason to
 * read. This is the canonical static-analysis bypass, and the answer is not to
 * chase `values`/`to`/`from` but to stop preserving foreign-namespace content
 * at all: SVG and MathML are where namespace-confusion mXSS lives.
 */
describe('foreign-namespace content is not preserved', () => {
  it('drops an SVG carrying a SMIL href rewrite', () => {
    const out = roundTrip(
      '<svg><a href="/x"><animate attributeName="href" values="javascript:alert(1)"/>' +
        '<text y="20">click</text></a></svg>',
    )
    expect(out).not.toMatch(/<svg/i)
    expect(out).not.toMatch(/animate/i)
    expect(out).not.toMatch(/javascript:/i)
  })

  it('drops an SVG wrapped in a preserved atom', () => {
    const out = roundTrip(
      '<div class="c"><svg><set attributeName="href" to="javascript:alert(1)"/></svg></div>',
    )
    expect(out).not.toMatch(/<svg/i)
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('class="c"')
  })

  it('drops MathML', () => {
    const out = roundTrip('<div class="c"><math><mtext><a href="/x">m</a></mtext></math></div>')
    expect(out).not.toMatch(/<math/i)
    expect(out).not.toMatch(/mtext/i)
  })
})

/**
 * The raw-text elements. `<plaintext>` has no end tag at all, so serializing a
 * preserved one emits a `</plaintext>` the next parse cannot consume -- the
 * document grew 36 bytes on every save, without bound. `<xmp>` and `<noembed>`
 * hand their contents back unescaped.
 *
 * GOVERNANCE.md ranks silent content corruption above security issues, and this
 * was unbounded archive corruption inside the layer built to prevent it.
 */
describe('raw-text elements neither corrupt nor grow the document', () => {
  it('is byte-stable across three consecutive round trips', () => {
    const once = roundTrip('<div class="x"><plaintext>hello')
    const twice = roundTrip(once)
    const thrice = roundTrip(twice)
    expect(twice).toBe(once)
    expect(thrice).toBe(once)
    expect(once).not.toMatch(/plaintext/i)
  })

  it('does not hand back <xmp> or <noembed> contents unescaped', () => {
    for (const tag of ['xmp', 'noembed', 'noframes']) {
      const out = roundTrip(`<div class="x"><${tag}><img src=x onerror=alert(1)></${tag}></div>`)
      expect(out, tag).not.toMatch(new RegExp(tag, 'i'))
      expect(out, tag).not.toMatch(/onerror/i)
    }
  })
})

/**
 * The defect underneath every case above: two hand-maintained lists that must
 * agree -- core's `NEVER_PRESERVE` and the sanitize policy's `dropWithContent`
 * -- with no mechanism forcing it. Both are now spread from one constant in
 * @openleaf-editor/content-policy, and this asserts the spread was not quietly
 * replaced by a copy.
 */
describe('the drop list cannot diverge from the published policy', () => {
  it('never preserves anything the shared policy drops with its content', () => {
    const missing = DROP_WITH_CONTENT.filter((tag) => !NEVER_PRESERVE.includes(tag))
    expect(missing).toEqual([])
  })

  it('covers the elements each fix in this file depends on', () => {
    for (const tag of ['svg', 'math', 'plaintext', 'xmp', 'noembed', 'noframes']) {
      expect(NEVER_PRESERVE, tag).toContain(tag)
    }
  })
})

/**
 * The write path: the commands that put a URL into the document.
 *
 * Every test above starts from `parseHtml`, and that is exactly what made this
 * gap comfortable to miss. `setLink` and `insertImage` write straight into the
 * live document, and the parse rule that drops `javascript:` does not run again
 * until the document is loaded back -- one HTTP round trip after the server
 * stored it. By then the bytes are in the database, and any consumer rendering
 * that stored HTML has a click-to-execute XSS no matter what the editor does on
 * the way back in.
 *
 * `insertVideo` and `insertAudio`, in the same module, always checked. These
 * tests exist so the two halves cannot drift apart again.
 */

function docState(html: string): EditorState {
  return EditorState.create({ doc: parseHtml(html), schema: coreSchema() })
}

/** Select the whole document's text, which is what `setLink` requires. */
function withTextSelected(state: EditorState): EditorState {
  const { doc } = state
  return state.apply(state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)))
}

/** Run a command: the serialized result, or null when the command declined. */
function runCommand(state: EditorState, command: Command): string | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied && next !== null ? serializeHtml((next as EditorState).doc) : null
}

function linkOn(href: string): string | null {
  return runCommand(withTextSelected(docState('<p>hello</p>')), setLink({ href }))
}

function imageWith(src: string): string | null {
  return runCommand(docState('<p>x</p>'), insertImage({ src }))
}

/**
 * Schemes that execute, and the ways they get past a naive string check.
 *
 * `isSafeUrl` strips ASCII whitespace and control characters before reading the
 * scheme, because browsers do the same while parsing one. So every entry here
 * is the *same* payload as far as navigation is concerned and must be refused
 * identically. They are listed rather than generated so a regression names the
 * variant that broke.
 */
const EXECUTABLE_URLS: ReadonlyArray<readonly [name: string, url: string]> = [
  ['plain javascript:', 'javascript:alert(document.cookie)'],
  ['data:text/html', 'data:text/html,<script>alert(1)</script>'],
  ['data:text/html;base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['mixed case', 'JaVaScRiPt:alert(1)'],
  ['embedded tab', 'java\tscript:alert(1)'],
  ['embedded newline', 'java\nscript:alert(1)'],
  ['embedded carriage return', 'java\rscript:alert(1)'],
  ['embedded NUL', 'java\u0000script:alert(1)'],
  ['leading whitespace', '   javascript:alert(1)'],
  ['leading control character', '\u0001javascript:alert(1)'],
  ['non-breaking space', 'java\u00a0script:alert(1)'],
]

describe('dangerous URLs must not reach the document in the first place', () => {
  for (const [name, url] of EXECUTABLE_URLS) {
    it(`setLink declines ${name}`, () => {
      expect(linkOn(url)).toBeNull()
    })

    it(`insertImage declines ${name}`, () => {
      expect(imageWith(url)).toBeNull()
    })
  }

  it('declines a captioned image, not only a bare one', () => {
    // The caption branch builds a different node and returns early, so it needs
    // its own assertion rather than trusting the shared guard by inspection.
    expect(runCommand(docState('<p>x</p>'), insertImage({ src: 'javascript:alert(1)', caption: 'Fig 1' }))).toBeNull()
  })

  it('declines an empty address instead of writing one', () => {
    expect(linkOn('')).toBeNull()
    expect(imageWith('')).toBeNull()
  })

  it('still accepts the addresses authors actually use', () => {
    expect(linkOn('https://example.org')).toContain('href="https://example.org"')
    expect(linkOn('/about')).toContain('href="/about"')
    expect(linkOn('#section')).toContain('href="#section"')
    expect(linkOn('mailto:a@example.org')).toContain('mailto:')
    expect(linkOn('//cdn.example.org/x')).toContain('//cdn.example.org/x')
    expect(imageWith('/a.png')).toContain('src="/a.png"')
  })

  it('stores an entity-encoded payload as the relative URL it actually is', () => {
    // `&#106;avascript:` carries no scheme -- `&` cannot begin one -- so it is a
    // relative URL and `isSafeUrl` allows it. That is only correct because
    // serialization escapes the ampersand, so the stored bytes never decode
    // back into `javascript:`. Entity decoding happens in `getAttribute`,
    // upstream of every check, which is why the escaping is the load-bearing
    // half and gets asserted here rather than the scheme test.
    for (const entity of ['&#106;avascript:alert(1)', '&#x6a;avascript:alert(1)', '&NewLine;javascript:alert(1)']) {
      const out = linkOn(entity)
      expect(out).not.toBeNull()
      expect(out).toContain('&amp;')
      expect(out).not.toContain('href="javascript:')
      // Reparsing is the real proof: the schema, which is the authority on what
      // may execute, reads the stored bytes as an ordinary relative URL and
      // keeps the link rather than dropping it as a dangerous scheme.
      expect(roundTrip(out as string)).toContain('&amp;')
    }
  })
})
