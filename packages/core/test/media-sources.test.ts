/**
 * `<source>` and `<track>` on video and audio.
 *
 * Source-only media -- a `<video>` with no `src` of its own -- was declined by
 * the schema and then deleted by the preservation layer's drop rule, so the
 * whole player and every address in it vanished on the first save. These are the
 * tests for it surviving.
 */

import { describe, expect, it } from 'vitest'
import { parseHtml, serializeHtml } from '../src/index.js'

/** What the editor would store for this HTML. */
function stored(html: string): string {
  return serializeHtml(parseHtml(html))
}

/** True when a second pass through the editor changes nothing. */
function stable(html: string): boolean {
  const once = stored(html)
  return stored(once) === once
}

describe('source-only media', () => {
  it('keeps a video whose addresses are all in its sources', () => {
    const html = '<video controls><source src="/a.webm" type="video/webm"><source src="/a.mp4"></video>'
    const out = stored(html)
    expect(out).toContain('<source src="/a.webm" type="video/webm">')
    expect(out).toContain('<source src="/a.mp4">')
    expect(stable(html)).toBe(true)
  })

  it('keeps a source-only audio element', () => {
    const out = stored('<audio controls><source src="/a.ogg"></audio>')
    expect(out).toContain('<source src="/a.ogg">')
  })

  it('keeps sources alongside a primary src', () => {
    const out = stored('<video src="/a.mp4" controls><source src="/a.webm"></video>')
    expect(out).toContain('src="/a.mp4"')
    expect(out).toContain('<source src="/a.webm">')
  })

  it('keeps caption tracks', () => {
    const out = stored('<video src="/a.mp4" controls><track kind="captions" src="/c.vtt" srclang="en"></video>')
    expect(out).toContain('<track kind="captions" src="/c.vtt" srclang="en">')
  })

  // Pretty-printed markup puts whitespace between the sources. That is layout,
  // not fallback, so the element still models as an editable node.
  it('models media whose only other children are whitespace', () => {
    expect(stored('<video src="/a.mp4" controls>\n  <source src="/a.webm">\n</video>')).toBe(
      '<video src="/a.mp4" controls=""><source src="/a.webm"></video>',
    )
  })
})

describe('media safety', () => {
  it('drops a source whose address is not safe, rather than emptying it', () => {
    const out = stored('<video src="/a.mp4" controls><source src="javascript:alert(1)"></video>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('<source')
  })

  it('declines media left with nothing playable', () => {
    expect(stored('<video controls><source src="javascript:alert(1)"></video>')).not.toContain('video')
  })

  it('scrubs an event handler off a source', () => {
    const out = stored('<video controls><source src="/a.webm" onerror="alert(1)"></video>')
    expect(out).toContain('<source src="/a.webm">')
    expect(out).not.toContain('onerror')
  })

  it('still drops media whose own src is unsafe', () => {
    expect(stored('<video src="javascript:alert(1)" controls></video>')).not.toContain('video')
  })
})

describe('media carrying fallback content', () => {
  // An atom has nowhere to put it, so the element is preserved whole instead of
  // being modelled and having the fallback deleted on the next save.
  it('keeps a download link offered as fallback', () => {
    const html = '<video src="/a.mp4" controls>Download <a href="/a.mp4">the video</a></video>'
    const out = stored(html)
    expect(out).toContain('Download')
    expect(out).toContain('<a href="/a.mp4">the video</a>')
    expect(stable(html)).toBe(true)
  })

  it('keeps fallback text alongside sources', () => {
    const out = stored('<audio controls><source src="/a.ogg">No audio support.</audio>')
    expect(out).toContain('No audio support.')
    expect(out).toContain('<source src="/a.ogg">')
  })
})
