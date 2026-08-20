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
 */
export const EMBED_HOSTS: readonly EmbedHostRule[] = [
  { host: 'youtube.com', path: /^\/embed\// },
  { host: 'youtube-nocookie.com', path: /^\/embed\// },
  { host: 'player.vimeo.com', path: /^\/video\// },
  { host: 'dailymotion.com', path: /^\/embed\// },
  { host: 'player.twitch.tv' },
  { host: 'w.soundcloud.com', path: /^\/player\/?/ },
  { host: 'open.spotify.com', path: /^\/embed\// },
  { host: 'google.com', path: /^\/maps\/embed/ },
]

export const EMBED_ALLOW_TOKENS = [
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
] as const

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
