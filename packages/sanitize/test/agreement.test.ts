import {
  EMBED_HOSTS,
  parseHtml,
  safeAlign,
  safeAllowList,
  safeColor,
  serializeHtml,
} from '@openleaf-editor/core'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  EMBED_HOSTS as POLICY_EMBED_HOSTS,
  embedSrcPattern,
  isAllowedDeclaration,
  isAllowedEmbedSrc,
  safeAllowList as policySafeAllowList,
  sanitizeHtml,
  toDOMPurifyConfig,
} from '../src/index.js'

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
  '<p><img class="ol-float-left" src="/a.png" alt="x"></p>',
  '<h2 id="sec">Anchored</h2>',
  '<p><a href="https://example.org" title="T" id="here">link</a></p>',
  '<figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>',
  '<details><summary>More</summary><p>body</p></details>',
  '<hr class="ol-pagebreak">',
  '<video src="/talk.mp4" controls=""></video>',
  '<iframe src="https://www.youtube.com/embed/abc" title="Clip" allowfullscreen=""></iframe>',
  '<iframe src="https://www.youtube.com/embed/abc" title="Clip" ' +
    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; ' +
    'picture-in-picture; web-share" allowfullscreen=""></iframe>',
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

  it('agrees with the editor about which iframe hosts are acceptable', () => {
    expect(POLICY_EMBED_HOSTS.map((rule) => `${rule.host}:${rule.path?.source ?? '*'}`)).toEqual(
      EMBED_HOSTS.map((rule) => `${rule.host}:${rule.path?.source ?? '*'}`),
    )
  })

  it('agrees with the editor about which iframe permissions are acceptable', () => {
    // embed.ts here is a deliberate copy of core's, for the same reason css.ts is.
    for (const value of [
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      'autoplay; fullscreen; picture-in-picture',
      'autoplay; fullscreen;',
      "camera 'self'; microphone; fullscreen *",
      'autoplay fullscreen',
      'AUTOPLAY; Fullscreen',
      'camera; microphone; geolocation',
      '',
    ]) {
      expect(policySafeAllowList(value)).toBe(safeAllowList(value))
    }
  })

  // A permitted host is not on its own enough: `allow` is how a frame asks to
  // step outside the restrictions the rest of the page lives under.
  it('strips permissions the policy does not name from a permitted embed', () => {
    const out = sanitizeHtml(
      '<iframe src="https://www.youtube.com/embed/abc" allow="autoplay; camera; microphone"></iframe>',
      { policy: DEFAULT_POLICY },
    )
    expect(out).toContain('allow="autoplay"')
    expect(out).not.toContain('camera')
    expect(out).not.toContain('microphone')
  })

  it('drops the attribute entirely when no permission survives', () => {
    const out = sanitizeHtml(
      '<iframe src="https://www.youtube.com/embed/abc" allow="camera; geolocation"></iframe>',
      { policy: DEFAULT_POLICY },
    )
    expect(out).not.toContain('allow')
  })

  it('removes an embed from a host the policy does not permit', () => {
    const out = sanitizeHtml('<p>a</p><iframe src="https://evil.example/x"></iframe><p>b</p>', {
      policy: DEFAULT_POLICY,
    })
    expect(out).toBe('<p>a</p><p>b</p>')
  })

  // No DOMPurify config can express a per-element host allowlist, so listing the
  // element without the hook would let an arbitrary nested page through the
  // sanitizer SECURITY.md recommends.
  it('withholds iframe from the DOMPurify config unless the embed hook is declared', () => {
    const guarded = toDOMPurifyConfig(DEFAULT_POLICY)
    expect(guarded.ALLOWED_TAGS).not.toContain('iframe')
    expect(guarded.FORBID_TAGS).toContain('iframe')
    expect(guarded.FORBID_CONTENTS).toContain('iframe')

    const hooked = toDOMPurifyConfig(DEFAULT_POLICY, { embedHook: true })
    expect(hooked.ALLOWED_TAGS).toContain('iframe')
    expect(hooked.FORBID_TAGS).not.toContain('iframe')
  })

  // The emitted pattern is what bleach and HTMLPurifier enforce with, so it has
  // to answer exactly as the code path does -- spoofed hosts included.
  it('generates an embed pattern that agrees with the host check', () => {
    const pattern = new RegExp(embedSrcPattern(), 'i')
    for (const url of [
      'https://www.youtube.com/embed/abc',
      'https://youtube.com/embed/abc',
      'https://youtube-nocookie.com/embed/abc',
      'https://player.vimeo.com/video/1',
      'https://dailymotion.com/embed/video/1',
      'https://player.twitch.tv/?channel=x',
      'https://player.twitch.tv',
      'https://w.soundcloud.com/player/?url=x',
      'https://open.spotify.com/embed/track/1',
      'https://www.google.com/maps/embed?pb=1',
      'https://evil.example/',
      'https://youtube.com.evil.example/embed/x',
      'https://notyoutube.com/embed/x',
      'https://youtube.com/watch?v=x',
      'http://www.youtube.com/embed/abc',
      'https://player.twitch.tv.evil.example/x',
    ]) {
      expect(pattern.test(url), url).toBe(isAllowedEmbedSrc(url))
    }
  })

  it('still strips what the editor would never emit', () => {
    // The guard must not have been satisfied by making the policy permissive.
    const out = sanitizeHtml('<p onclick="x()">t</p><script>y()</script>', {
      policy: DEFAULT_POLICY,
    })
    expect(out).toBe('<p>t</p>')
  })
})
