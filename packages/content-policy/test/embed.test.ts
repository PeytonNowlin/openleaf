/**
 * Converting a player page into the embed URL the allowlist accepts.
 *
 * The conversion exists because `EMBED_HOSTS` refuses `youtube.com/watch` on
 * purpose, and a watch page is the only URL an author has. It is security-
 * adjacent for the same reason: it is the one place that *builds* an iframe
 * `src` rather than merely checking one, so the tests below care as much about
 * what it declines as what it converts.
 */

import { describe, expect, it } from 'vitest'
import { embedSrcFor, isAllowedEmbedSrc, safeEmbedSrc } from '../src/embed.js'

describe('embedSrcFor', () => {
  it('passes an address that is already an embed URL through unchanged', () => {
    const already = 'https://www.youtube.com/embed/dQw4w9WgXcQ'
    expect(embedSrcFor(already)).toBe(already)
  })

  it('converts a YouTube watch page', () => {
    expect(embedSrcFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('keeps the extra query parameters out of the rebuilt URL', () => {
    // `&t=42s&list=...` belongs to the watch page, not the embed, and copying it
    // across would mean trusting whatever else was in the query string.
    expect(embedSrcFor('https://www.youtube.com/watch?v=abc123&t=42s&list=PLxx')).toBe(
      'https://www.youtube.com/embed/abc123',
    )
  })

  it('converts the short and alternate YouTube forms', () => {
    expect(embedSrcFor('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(embedSrcFor('https://www.youtube.com/shorts/abc_123')).toBe(
      'https://www.youtube.com/embed/abc_123',
    )
    expect(embedSrcFor('https://www.youtube.com/live/abc-123')).toBe(
      'https://www.youtube.com/embed/abc-123',
    )
  })

  it('converts Vimeo, Dailymotion, Twitch and Spotify pages', () => {
    expect(embedSrcFor('https://vimeo.com/123456789')).toBe(
      'https://player.vimeo.com/video/123456789',
    )
    expect(embedSrcFor('https://www.dailymotion.com/video/x8abcde')).toBe(
      'https://www.dailymotion.com/embed/video/x8abcde',
    )
    expect(embedSrcFor('https://www.twitch.tv/somechannel')).toBe(
      'https://player.twitch.tv/?channel=somechannel',
    )
    expect(embedSrcFor('https://open.spotify.com/track/abc123')).toBe(
      'https://open.spotify.com/embed/track/abc123',
    )
  })

  it('only ever returns something the allowlist would accept anyway', () => {
    const pages = [
      'https://www.youtube.com/watch?v=abc123',
      'https://youtu.be/abc123',
      'https://vimeo.com/123',
      'https://www.twitch.tv/chan',
      'https://open.spotify.com/album/abc',
    ]
    for (const page of pages) {
      const converted = embedSrcFor(page)
      expect(converted).not.toBeNull()
      expect(isAllowedEmbedSrc(converted)).toBe(true)
      expect(safeEmbedSrc(converted)).toBe(converted)
    }
  })

  it('declines a host that is not on the list', () => {
    expect(embedSrcFor('https://evil.example/watch?v=abc')).toBeNull()
    expect(embedSrcFor('https://notyoutube.com/watch?v=abc')).toBeNull()
  })

  it('declines a lookalike host that merely ends with an allowed one', () => {
    expect(embedSrcFor('https://youtube.com.evil.example/watch?v=abc')).toBeNull()
    expect(embedSrcFor('https://evilyoutube.com/watch?v=abc')).toBeNull()
  })

  it('refuses http, because a mixed-content embed is a warning not a player', () => {
    expect(embedSrcFor('http://www.youtube.com/watch?v=abc123')).toBeNull()
  })

  it('refuses a non-URL and an empty value', () => {
    expect(embedSrcFor('not a url')).toBeNull()
    expect(embedSrcFor('')).toBeNull()
    expect(embedSrcFor(null)).toBeNull()
    expect(embedSrcFor(undefined)).toBeNull()
  })

  it('refuses a javascript: address however it is dressed up', () => {
    expect(embedSrcFor('javascript:alert(1)')).toBeNull()
    expect(embedSrcFor('JaVaScRiPt:alert(1)')).toBeNull()
    expect(embedSrcFor(' javascript:alert(1)')).toBeNull()
  })

  it('cannot be made to smuggle a second path segment through the id', () => {
    // A loose id pattern would let this rebuild as
    // `https://www.youtube.com/embed/../../evil`, which resolves off the
    // allowed path entirely.
    expect(embedSrcFor('https://www.youtube.com/watch?v=../../evil')).toBeNull()
    expect(embedSrcFor('https://youtu.be/../..%2Fevil')).toBeNull()
    expect(embedSrcFor('https://vimeo.com/123/../evil')).toBeNull()
  })

  it('refuses an id with a query or fragment spliced into it', () => {
    expect(embedSrcFor('https://youtu.be/abc?x=1#y')).toBe(
      'https://www.youtube.com/embed/abc',
    )
    expect(embedSrcFor('https://www.youtube.com/watch?v=abc%20def')).toBeNull()
  })

  it('refuses an over-long id rather than building a huge URL', () => {
    expect(embedSrcFor(`https://youtu.be/${'a'.repeat(200)}`)).toBeNull()
  })

  it('declines a watch page on a host whose rule has no watch form', () => {
    // Google Maps embeds are a documented path with no page equivalent to
    // convert, so there is nothing to guess and it says so.
    expect(embedSrcFor('https://www.google.com/maps/place/Somewhere')).toBeNull()
  })

  it('declines a bare host with no id to extract', () => {
    expect(embedSrcFor('https://www.youtube.com/')).toBeNull()
    expect(embedSrcFor('https://vimeo.com/')).toBeNull()
    expect(embedSrcFor('https://youtu.be/')).toBeNull()
  })
})
