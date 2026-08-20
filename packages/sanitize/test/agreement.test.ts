import { parseHtml, safeAlign, safeColor, serializeHtml } from '@openleaf-editor/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, isAllowedDeclaration, sanitizeHtml } from '../src/index.js'

/**
 * The default policy and the editor's schema must not drift apart.
 *
 * This exists because they did. Table nodes were added to the schema and the
 * policy was not updated, so a user following SECURITY.md sanitized a table down
 * to `RegionNorth` -- the structure gone, the text run together. Precisely the
 * "content dies on the server" failure this package was written to prevent,
 * shipped by the package that prevents it.
 *
 * The guard is end-to-end on purpose. Comparing two lists of tag names would
 * pass while an attribute the schema emits is quietly stripped; running real
 * documents through both is the only check that cannot be satisfied by
 * coincidence.
 */

/** Every construct the schema can emit, using no preserved markup. */
const SCHEMA_NATIVE = [
  '<h1>H1</h1><h2 dir="rtl">H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>',
  '<p dir="ltr">Text with <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code>.</p>',
  '<p><a href="https://example.org" title="T" target="_blank" rel="noopener">link</a></p>',
  '<p><img src="/a.png" alt="described" title="T" width="10" height="20"></p>',
  '<p>break<br>after</p>',
  // Alignment and colour. The policy allows `style` on these elements for these
  // declarations and nothing else, which is the narrowest widening that lets the
  // editor's own output survive a server-side pass.
  '<p style="text-align:center">centred</p><h3 style="text-align:right">right</h3>',
  '<p><span style="color:#cc0000">red</span> and ' +
    '<span style="background-color:#ffff00">highlighted</span></p>',
  '<blockquote><p>quoted</p></blockquote>',
  '<pre><code class="language-js">const x = 1</code></pre>',
  '<hr>',
  '<ul><li><p>one</p></li></ul>',
  '<ol start="3"><li><p>three</p></li></ol>',
  '<table border="1" cellpadding="4" cellspacing="0" width="100%" class="data">' +
    '<tbody><tr class="odd"><th scope="col" abbr="Q1">Region</th></tr>' +
    '<tr><td colspan="2" rowspan="1" headers="r1">North</td></tr></tbody></table>',
  // Caption and colgroup. The schema preserves both verbatim, so a policy that
  // stripped them would delete a table's accessible name on the way to the
  // database -- the same class of drift that produced `RegionNorth` above.
  '<table><caption class="cap">Q1 <strong>results</strong></caption>' +
    '<colgroup><col width="200"><col width="80"></colgroup>' +
    '<tbody><tr><td>North</td></tr></tbody></table>',
]

describe('the default policy accepts everything the editor emits', () => {
  for (const html of SCHEMA_NATIVE) {
    const label = /<([a-z0-9]+)/.exec(html)?.[1] ?? html.slice(0, 20)
    it(`keeps ${label} exactly`, () => {
      // What the editor would actually store, then what the server would keep.
      const stored = serializeHtml(parseHtml(html))
      expect(sanitizeHtml(stored, { policy: DEFAULT_POLICY })).toBe(stored)
    })
  }

  it('is a no-op over the whole document at once', () => {
    const stored = serializeHtml(parseHtml(SCHEMA_NATIVE.join('')))
    expect(sanitizeHtml(stored, { policy: DEFAULT_POLICY })).toBe(stored)
  })

  it('allows the language class only where the schema writes it', () => {
    // Widening `pre` as well would permit a class the editor never emits:
    // the schema normalizes `language-*` onto <code>. A class on <pre> is
    // preservation residue, which policyForPreserved() exists to opt into.
    const out = sanitizeHtml('<pre class="wide"><code class="language-js">x</code></pre>', {
      policy: DEFAULT_POLICY,
    })
    expect(out).toBe('<pre><code class="language-js">x</code></pre>')
  })

  it('strips a declaration the policy does not name, keeping the rest', () => {
    // The value of allowing `style` at all rests entirely on this: the property
    // list is closed, so an overlay covering the page cannot ride in on the
    // attribute that carries alignment.
    const out = sanitizeHtml(
      '<p style="text-align:center;position:fixed;inset:0">t</p>',
      { policy: DEFAULT_POLICY },
    )
    expect(out).toBe('<p style="text-align:center">t</p>')
  })

  it('strips a permitted property carrying an impermissible value', () => {
    for (const style of [
      'color:url(https://evil.example/x)',
      'color:expression(alert(1))',
      'background-color:var(--x)',
      'text-align:absolute',
    ]) {
      const out = sanitizeHtml(`<p><span style="${style}">t</span></p>`, { policy: DEFAULT_POLICY })
      expect(out).toBe('<p><span>t</span></p>')
    }
  })

  it('leaves an acceptable style attribute exactly as it found it', () => {
    // Spacing included. TinyMCE writes `text-align: center;`, and rewriting that
    // into the editor's own spelling would change the stored bytes of every
    // aligned paragraph in an archive on its first pass through the server.
    const html = '<p style="text-align: center;">t</p>'
    expect(sanitizeHtml(html, { policy: DEFAULT_POLICY })).toBe(html)
  })

  it('agrees with the editor about which CSS values are acceptable', () => {
    // css.ts here is a deliberate copy of core's, because a server that only
    // needs the policy must not have to install ProseMirror. This is the test
    // that keeps the copy honest.
    const colours = [
      '#abc', '#AABBCC', '#ff000080', 'rgb(1 2 3)', 'rgba(255, 0, 0, 0.5)',
      'hsl(120, 50%, 50%)', 'rebeccapurple', 'transparent',
      'url(https://evil.example/x)', 'expression(alert(1))', 'var(--x)',
      'red;position:fixed', 'image-set("x")', '#12', 'attr(href)', '',
    ]
    for (const value of colours) {
      expect(isAllowedDeclaration('color', value)).toBe(safeColor(value) !== null)
      expect(isAllowedDeclaration('background-color', value)).toBe(safeColor(value) !== null)
    }

    for (const value of ['left', 'center', 'right', 'justify', 'start', 'end', 'CENTER', 'middle', '']) {
      expect(isAllowedDeclaration('text-align', value)).toBe(safeAlign(value) !== null)
    }
  })

  it('permits no declaration on an element the policy gave no style properties', () => {
    // `styleProperties` is consulted per element, so `style` being allowed on a
    // paragraph does not make it allowed on a list item.
    expect(sanitizeHtml('<ul><li style="text-align:center">t</li></ul>', { policy: DEFAULT_POLICY }))
      .toBe('<ul><li>t</li></ul>')
  })

  it('still strips what the editor would never emit', () => {
    // The guard must not have been satisfied by making the policy permissive.
    const out = sanitizeHtml('<p onclick="x()">t</p><script>y()</script>', {
      policy: DEFAULT_POLICY,
    })
    expect(out).toBe('<p>t</p>')
  })
})
