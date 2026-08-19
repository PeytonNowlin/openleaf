/**
 * Embed host and permission rules, restated from `@openleaf-editor/core`.
 *
 * Copied rather than imported so a server that only needs the policy does not
 * have to install ProseMirror. `test/agreement.test.ts` pins the two lists
 * host for host, and the two `allow` filters answer for answer.
 */

export interface EmbedHostRule {
  readonly host: string
  readonly path?: RegExp
}

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

export function isAllowedEmbedSrc(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  return EMBED_HOSTS.some((rule) => {
    if (rule.host !== host) return false
    if (!rule.path) return true
    return rule.path.test(url.pathname)
  })
}

/** Permissions an embed may ask for. Restated from core; see the module note. */
export const EMBED_ALLOW_TOKENS: readonly string[] = [
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
]

const ALLOW_TOKENS = new Set([
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
])

/**
 * Filter an iframe `allow` attribute down to the permitted features.
 *
 * `allow` is how an embed asks to step outside the restrictions the rest of the
 * page lives under, so an allowlisted host is not on its own enough: a permitted
 * player URL carrying `allow="camera; microphone"` would be handed the camera.
 *
 * The attribute is a semicolon-delimited list of directives, each a feature name
 * followed by an optional origin allowlist. Only the feature name is kept, which
 * leaves the default allowlist -- the frame's own origin -- so `camera *`
 * narrows rather than being stored as written.
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
