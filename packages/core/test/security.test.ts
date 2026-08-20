import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { coreSchema, insertImage, parseHtml, serializeHtml, setLink } from '../src/index.js'

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
