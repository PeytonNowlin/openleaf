import { parseHtml, serializeHtml } from '@openleaf/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, sanitizeHtml } from '../src/index.js'

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
  '<blockquote><p>quoted</p></blockquote>',
  '<pre><code class="language-js">const x = 1</code></pre>',
  '<hr>',
  '<ul><li><p>one</p></li></ul>',
  '<ol start="3"><li><p>three</p></li></ol>',
  '<table border="1" cellpadding="4" cellspacing="0" width="100%" class="data">' +
    '<tbody><tr class="odd"><th scope="col" abbr="Q1">Region</th></tr>' +
    '<tr><td colspan="2" rowspan="1" headers="r1">North</td></tr></tbody></table>',
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

  it('still strips what the editor would never emit', () => {
    // The guard must not have been satisfied by making the policy permissive.
    const out = sanitizeHtml('<p onclick="x()">t</p><script>y()</script>', {
      policy: DEFAULT_POLICY,
    })
    expect(out).toBe('<p>t</p>')
  })
})
