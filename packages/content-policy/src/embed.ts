/**
 * Canonical iframe policy shared by the editor and sanitizers.
 *
 * An iframe is a nested browsing context. Allowing an arbitrary `src` is
 * allowing a third-party page to run in yours, which is why the preservation
 * layer used to drop every iframe it saw. Modelling embeds at all means
 * answering "which hosts, on which paths, over which scheme" in one place --
 * here -- so the schema, the insert command and `@openleaf-editor/sanitize`
 * cannot drift.
 *
 * Relative iframe URLs are refused: a CMS that later hosts an uploaded HTML
 * file at a relative path would otherwise turn a stored embed into a stored
 * XSS. `http:` is refused for the same reason every other URL check prefers
 * an allowlist of schemes: mixed content is not an embed, it is a warning.
 */

import { deepFreeze } from './freeze.js'
import { isSafeUrl } from './url.js'

export interface EmbedHostRule {
  /** Hostname, compared case-insensitively, with a leading `www.` ignored. */
  readonly host: string
  /** Path that must match. Absent means any path on that host. */
  readonly path?: RegExp
}

/**
 * Hosts an author may embed.
 *
 * Each rule is a known player page, not a whole site. `youtube.com/` would
 * let an author embed `youtube.com/watch` as a nested YouTube UI; `/embed/`
 * is the documented iframe URL.
 *
 * Frozen, not merely `readonly`: this list is the entire difference between an
 * iframe the editor renders and an attacker-controlled page nested inside the
 * document, and `readonly` is a compile-time annotation that a plain JavaScript
 * consumer or a single cast walks straight past. See `freeze.ts`.
 */
export const EMBED_HOSTS: readonly EmbedHostRule[] = deepFreeze([
  { host: 'youtube.com', path: /^\/embed\// },
  { host: 'youtube-nocookie.com', path: /^\/embed\// },
  { host: 'player.vimeo.com', path: /^\/video\// },
  { host: 'dailymotion.com', path: /^\/embed\// },
  { host: 'player.twitch.tv' },
  { host: 'w.soundcloud.com', path: /^\/player\/?/ },
  { host: 'open.spotify.com', path: /^\/embed\// },
  { host: 'google.com', path: /^\/maps\/embed/ },
])

export const EMBED_ALLOW_TOKENS = deepFreeze([
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
] as const)

const ALLOW_TOKENS = new Set<string>(EMBED_ALLOW_TOKENS)

function hostnameOf(value: string): string {
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function parsed(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** True when this URL is an https embed the schema will store. */
export function isAllowedEmbedSrc(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  if (!isSafeUrl(value)) return false
  const url = parsed(value.trim())
  if (!url) return false
  if (url.protocol !== 'https:') return false
  const host = hostnameOf(value)
  return EMBED_HOSTS.some((rule) => {
    if (rule.host !== host) return false
    if (!rule.path) return true
    return rule.path.test(url.pathname)
  })
}

/** The URL, or null when it must not be stored as an iframe `src`. */
export function safeEmbedSrc(value: string | null | undefined): string | null {
  return isAllowedEmbedSrc(value) ? (value as string) : null
}

/**
 * Permissions policy tokens an iframe may advertise.
 *
 * Anything not in the closed set is dropped rather than stored: `allow` is how
 * an embed asks to skip the sandbox the rest of the page lives in.
 *
 * The attribute is a **semicolon**-delimited list of directives, each one a
 * feature name followed by an optional origin allowlist -- `camera 'self';
 * fullscreen *`. Splitting on whitespace instead read the standard YouTube
 * string `allow="autoplay; fullscreen; picture-in-picture"` as the tokens
 * "autoplay;" and "fullscreen;", so only the last survived, and a trailing
 * semicolon lost every permission the author had.
 *
 * Only the feature name is kept. Dropping the origin allowlist leaves the
 * attribute's default, which is the frame's own origin -- so `camera *` narrows
 * to the embed itself rather than being stored as written.
 */
export function safeAllowList(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const kept: string[] = []
  const seen = new Set<string>()
  for (const directive of value.split(';')) {
    const name = (directive.trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (!ALLOW_TOKENS.has(name) || seen.has(name)) continue
    seen.add(name)
    kept.push(name)
  }
  return kept.length > 0 ? kept.join('; ') : null
}

/**
 * Rewrite a player *page* into the embed URL the policy above allows.
 *
 * `EMBED_HOSTS` deliberately refuses `youtube.com/watch`: embedding a watch page
 * nests the whole YouTube UI in the document, so only the documented `/embed/`
 * path is storable. That is the right policy and the wrong thing to hand an
 * author, because a watch page is the only URL they have -- nobody copies an
 * `<iframe>` out of a share dialog. The result was an insert that silently did
 * nothing: the toolbar routed a YouTube link to the iframe command, and
 * `safeEmbedSrc` then refused it.
 *
 * So the conversion lives here, next to the allowlist it has to satisfy, rather
 * than in a dialog where a second copy of the host list would drift from this
 * one. Each rule extracts an id with a strict pattern and rebuilds a canonical
 * URL; nothing is passed through. The return value goes back through
 * `safeEmbedSrc`, so this function can only ever produce a URL the policy would
 * have accepted anyway -- it narrows what an author must type, never what the
 * editor will store.
 */
export function embedSrcFor(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const direct = safeEmbedSrc(value)
  if (direct) return direct

  const url = parsed(value.trim())
  if (!url || url.protocol !== 'https:') return null
  const host = hostnameOf(value)
  const path = url.pathname

  // Each id pattern is anchored and character-classed. A loose `(.+)` here would
  // let a crafted path smuggle a second path segment into the rebuilt URL.
  const ID = /^[\w-]{1,64}$/

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (path === '/watch') {
      const id = url.searchParams.get('v') ?? ''
      if (ID.test(id)) return safeEmbedSrc(`https://www.${host}/embed/${id}`)
    }
    // `/shorts/ID` and `/live/ID` are watch pages under another name.
    const named = /^\/(?:shorts|live)\/([\w-]{1,64})$/.exec(path)
    if (named) return safeEmbedSrc(`https://www.${host}/embed/${named[1]}`)
    return null
  }

  if (host === 'youtu.be') {
    const id = path.slice(1)
    if (ID.test(id)) return safeEmbedSrc(`https://www.youtube.com/embed/${id}`)
    return null
  }

  if (host === 'vimeo.com') {
    const id = /^\/(\d{1,32})$/.exec(path)
    if (id) return safeEmbedSrc(`https://player.vimeo.com/video/${id[1]}`)
    return null
  }

  if (host === 'dailymotion.com') {
    const id = /^\/video\/([\w-]{1,64})$/.exec(path)
    if (id) return safeEmbedSrc(`https://www.dailymotion.com/embed/video/${id[1]}`)
    return null
  }

  if (host === 'twitch.tv') {
    const channel = /^\/([\w-]{1,64})$/.exec(path)
    if (channel) return safeEmbedSrc(`https://player.twitch.tv/?channel=${channel[1]}`)
    return null
  }

  if (host === 'open.spotify.com') {
    const found = /^\/(track|album|playlist|episode|show|artist)\/([\w-]{1,64})$/.exec(path)
    if (found) return safeEmbedSrc(`https://open.spotify.com/embed/${found[1]}/${found[2]}`)
    return null
  }

  return null
}
