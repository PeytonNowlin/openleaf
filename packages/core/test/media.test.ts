import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { insertImage, insertVideo, parseHtml, serializeHtml } from '../src/index.js'

function stateFrom(html: string): EditorState {
  const doc = parseHtml(html)
  return EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
}

function apply(html: string, command: (state: EditorState, dispatch?: (tr: any) => void) => boolean): string {
  const state = stateFrom(html)
  let next = state
  command(state, (tr) => {
    next = state.apply(tr)
  })
  return serializeHtml(next.doc)
}

describe('figures and media', () => {
  it('round-trips a captioned image, including leftover data attributes', () => {
    const html =
      '<figure class="caption" role="group"><img src="/a.png" alt="Diagram" data-entity-uuid="aaaa"><figcaption>Figure 1</figcaption></figure>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('<figure')
    expect(out).toContain('class="caption"')
    expect(out).toContain('role="group"')
    expect(out).toContain('src="/a.png"')
    expect(out).toContain('alt="Diagram"')
    expect(out).toContain('data-entity-uuid="aaaa"')
    expect(out).toContain('<figcaption>Figure 1</figcaption>')
  })

  it('round-trips a video with a poster and an extra source', () => {
    const html =
      '<video controls poster="/still.jpg" src="/clip.mp4"><source src="/clip.webm" type="video/webm"></video>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('poster="/still.jpg"')
    expect(out).toContain('src="/clip.mp4"')
    expect(out).toContain('<source src="/clip.webm" type="video/webm">')
  })

  it('declines a figure that is not a single media element, so preservation keeps it', () => {
    const html = '<figure><table><tr><td>A</td></tr></table></figure>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('<figure>')
    expect(out).toContain('<table>')
  })

  it('inserts an image inside a figure when a caption is supplied', () => {
    const out = apply('<p>x</p>', insertImage({ src: '/a.png', alt: 'A', caption: 'A chart' }))
    expect(out).toContain('<figure>')
    expect(out).toContain('<figcaption>A chart</figcaption>')
    expect(out).toContain('alt="A"')
  })

  it('inserts a video with a poster frame', () => {
    const out = apply('<p>x</p>', insertVideo({ src: '/a.mp4', poster: '/a.jpg' }))
    expect(out).toContain('<video')
    expect(out).toContain('src="/a.mp4"')
    expect(out).toContain('poster="/a.jpg"')
  })

  it('keeps class on an image', () => {
    const out = serializeHtml(parseHtml('<p><img src="/a.png" alt="" class="align-center"></p>'))
    expect(out).toContain('class="align-center"')
  })
})