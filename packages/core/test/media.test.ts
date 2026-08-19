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

  // The node is an atom and only <source>/<track> are modelled, so a fallback
  // message has nowhere to live on it. Modelling the element anyway deleted the
  // fallback on the next save; declining hands it to preservation intact.
  it('declines media carrying fallback content, so preservation keeps it whole', () => {
    const html = '<p><video src="/clip.mp4" controls>Download <a href="/clip.mp4">the video</a></video></p>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('Download')
    expect(out).toContain('<a href="/clip.mp4">the video</a>')
    expect(serializeHtml(parseHtml(out))).toBe(out)
  })

  it('declines source-only media carrying fallback content', () => {
    const html = '<p><audio controls><source src="/a.ogg">No audio support.</audio></p>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toContain('No audio support.')
    expect(out).toContain('<source src="/a.ogg">')
  })

  // Whitespace between the <source> children is layout, not fallback: the
  // element still round-trips as a real node, which is what keeps it editable.
  it('still models media whose only extra children are whitespace', () => {
    const html = '<p><video src="/clip.mp4" controls>\n  <source src="/clip.webm">\n</video></p>'
    const out = serializeHtml(parseHtml(html))
    expect(out).toBe('<p><video src="/clip.mp4" controls=""><source src="/clip.webm"></video></p>')
  })

  // Furniture typed into the insert dialog has not been through readFurniture,
  // so the serializer is the only place left to scrub it.
  it('scrubs furniture supplied by a command rather than by a parse', () => {
    const out = apply(
      '<p>x</p>',
      insertVideo({
        src: '/a.mp4',
        furniture: '<source src="/a.webm" onerror="alert(1)"><source src="javascript:alert(2)">',
      }),
    )
    expect(out).toContain('<source src="/a.webm">')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('javascript:')
  })

  it('keeps class on an image', () => {
    const out = serializeHtml(parseHtml('<p><img src="/a.png" alt="" class="align-center"></p>'))
    expect(out).toContain('class="align-center"')
  })
})