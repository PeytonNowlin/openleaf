/**
 * Embed host rules, restated from `@openleaf-editor/core`.
 *
 * Copied rather than imported so a server that only needs the policy does not
 * have to install ProseMirror. `test/agreement.test.ts` pins the two lists
 * host for host.
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
