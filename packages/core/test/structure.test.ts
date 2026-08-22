import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  coreSchema,
  insertAudio,
  insertDetails,
  insertHtml,
  insertIframe,
  insertImage,
  insertNamedAnchor,
  insertNonBreakingSpace,
  insertPageBreak,
  insertText,
  insertVideo,
  isAllowedEmbedSrc,
  parseHtml,
  roundTrip,
  serializeHtml,
  setHeadingId,
} from '../src/index.js'

function stateFrom(html: string): EditorState {
  const doc = parseHtml(html)
  return EditorState.create({
    doc,
    schema: coreSchema(),
    selection: TextSelection.create(doc, 1),
  })
}

function run(state: EditorState, command: Command): string | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied && next ? serializeHtml((next as EditorState).doc) : null
}

describe('structure round-trips', () => {
  const cases: Array<[string, string]> = [
    ['details', '<details><summary>More</summary>body</details>'],
    ['figure', '<figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>'],
    ['heading id', '<h2 id="sec">Title</h2>'],
    ['named anchor', '<p><a id="here"></a>text</p>'],
    ['page break', '<hr class="ol-pagebreak">'],
    ['video', '<video src="/talk.mp4" controls=""></video>'],
    ['audio', '<audio src="/talk.mp3" controls=""></audio>'],
    [
      'youtube iframe',
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Video" allowfullscreen=""></iframe>',
    ],
    ['floated image', '<p><img class="ol-float-left" src="/a.png" alt="x"></p>'],
  ]

  for (const [name, html] of cases) {
    it(`${name} survives a round trip`, () => {
      expect(roundTrip(html)).toBe(html)
    })
  }
})

describe('named_anchor does not eat wrapped text', () => {
  const cases: Array<[string, string]> = [
    ['wrapped text', '<p><a id="jump">Jump target with text</a></p>'],
    ['heading wrap', '<h2><a id="sec">Section One</a></h2>'],
    ['empty jump target', '<p><a id="jump"></a>heading text</p>'],
    ['a[name] unmatched', '<p><a name="old">Old style anchor text</a></p>'],
  ]

  for (const [name, html] of cases) {
    it(`${name} survives a round trip`, () => {
      expect(roundTrip(html)).toBe(html)
    })
  }

  it('id and href is a link, not the empty atom', () => {
    const html = '<p><a id="jump" href="/x">both</a></p>'
    const out = roundTrip(html)
    expect(out).toContain('href="/x"')
    expect(out).toContain('id="jump"')
    expect(out).toContain('>both</a>')
    const doc = parseHtml(html)
    let namedAnchors = 0
    doc.descendants((node) => {
      if (node.type.name === 'named_anchor') namedAnchors += 1
    })
    expect(namedAnchors).toBe(0)
  })

  it('keeps heading text when an <a id> wraps the heading', () => {
    const html =
      '<h2><a id="revenue">Revenue by region</a></h2><p>Body text.</p><p>See <a href="#revenue">the section</a>.</p>'
    const out = roundTrip(html)
    expect(out).toContain('Revenue by region')
    expect(out).toBe(html)

    const doc = parseHtml(html)
    let namedAnchors = 0
    let linkMarks = 0
    doc.descendants((node) => {
      if (node.type.name === 'named_anchor') namedAnchors += 1
      if (node.marks.some((mark) => mark.type.name === 'link' && mark.attrs['id'] === 'revenue')) {
        linkMarks += 1
      }
    })
    expect(namedAnchors).toBe(0)
    expect(linkMarks).toBeGreaterThan(0)
    expect(doc.textContent).toContain('Revenue by region')
  })

  it('still models a genuinely empty <a id> as the atom', () => {
    const doc = parseHtml('<p><a id="jump"></a>heading text</p>')
    let namedAnchors = 0
    doc.descendants((node) => {
      if (node.type.name === 'named_anchor') namedAnchors += 1
    })
    expect(namedAnchors).toBe(1)
  })

  it('treats whitespace-only <a id> as the empty atom', () => {
    const html = '<p><a id="jump">\n</a>Heading</p>'
    const doc = parseHtml(html)
    let namedAnchors = 0
    doc.descendants((node) => {
      if (node.type.name === 'named_anchor') namedAnchors += 1
    })
    expect(namedAnchors).toBe(1)
    expect(doc.textContent).toContain('Heading')
    const out = roundTrip(html)
    expect(out).toContain('id="jump"')
    expect(out).toContain('Heading')
  })
})

describe('unsafe media is dropped', () => {
  it('drops an iframe that is not an allowlisted player', () => {
    expect(roundTrip('<p>ok</p><iframe src="https://evil.example/embed"></iframe>')).not.toContain('iframe')
  })

  it('drops a javascript video src', () => {
    expect(roundTrip('<video src="javascript:alert(1)"></video>')).not.toMatch(/javascript:/i)
  })
})

describe('embed allowlist', () => {
  it('accepts https YouTube embed URLs only', () => {
    expect(isAllowedEmbedSrc('https://www.youtube.com/embed/abc')).toBe(true)
    expect(isAllowedEmbedSrc('https://youtube.com/watch?v=abc')).toBe(false)
    expect(isAllowedEmbedSrc('http://www.youtube.com/embed/abc')).toBe(false)
    expect(isAllowedEmbedSrc('/embed/abc')).toBe(false)
  })
})

describe('insert commands', () => {
  it('inserts a collapsible section', () => {
    const out = run(stateFrom('<p>x</p>'), insertDetails('More'))
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>More</summary>')
  })

  it('inserts a page break', () => {
    expect(run(stateFrom('<p>x</p>'), insertPageBreak)).toContain('ol-pagebreak')
  })

  it('inserts a non-breaking space', () => {
    expect(run(stateFrom('<p></p>'), insertNonBreakingSpace)).toContain('&nbsp;')
  })

  it('inserts text', () => {
    expect(run(stateFrom('<p></p>'), insertText('hi'))).toContain('hi')
  })

  it('sets a heading id', () => {
    const state = stateFrom('<h2>Title</h2>')
    expect(run(state, setHeadingId('intro'))).toBe('<h2 id="intro">Title</h2>')
  })

  it('inserts a named anchor', () => {
    expect(run(stateFrom('<p>x</p>'), insertNamedAnchor('here'))).toContain('<a id="here">')
  })

  it('wraps a captioned image in a figure', () => {
    const out = run(stateFrom('<p>x</p>'), insertImage({ src: '/a.png', alt: 'x', caption: 'cap' }))
    expect(out).toContain('<figure>')
    expect(out).toContain('<figcaption>cap</figcaption>')
  })

  it('refuses an iframe that is not an allowlisted player', () => {
    expect(run(stateFrom('<p>x</p>'), insertIframe({ src: 'https://evil.example/x' }))).toBeNull()
  })

  it('inserts an allowlisted iframe', () => {
    const out = run(
      stateFrom('<p>x</p>'),
      insertIframe({ src: 'https://www.youtube.com/embed/abc', title: 'Clip' }),
    )
    expect(out).toContain('youtube.com/embed/abc')
  })

  it('inserts video and audio with a safe src', () => {
    expect(run(stateFrom('<p>x</p>'), insertVideo({ src: '/a.mp4' }))).toContain('<video')
    expect(run(stateFrom('<p>x</p>'), insertAudio({ src: '/a.mp3' }))).toContain('<audio')
  })

  it('inserts a snippet through the HTML parse pipeline', () => {
    const out = run(stateFrom('<p>x</p>'), insertHtml('<p><em>staff</em></p>'))
    expect(out).toContain('<em>staff</em>')
    expect(run(stateFrom('<p>x</p>'), insertHtml('<script>alert(1)</script><p>ok</p>'))).not.toMatch(/script/i)
  })
})
