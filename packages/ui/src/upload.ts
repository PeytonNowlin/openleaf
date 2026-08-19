/**
 * Image upload: the hook, and where the bytes are allowed to go.
 *
 * OpenLeaf has no server, so it cannot upload anything. What it can do is own
 * the *flow* -- pick or drop a file, hand it to the host, get a URL back, ask for
 * alternative text, insert -- and leave the transport to the one piece of the
 * stack that knows the CMS's endpoint, its CSRF token and its media library.
 *
 * ## Why there is no data: URL fallback
 *
 * The tempting default for an editor with no server is to inline the file as a
 * `data:` URI, so the feature "works" out of the box. Core refuses `data:` URLs
 * on purpose -- `data:text/html` is a full XSS vector and separating the safe
 * media types from the dangerous ones by sniffing is exactly the parsing that
 * gets defeated -- and a fallback that silently produces content the schema will
 * refuse on the next parse is worse than no fallback: the author sees their image
 * appear, saves, and finds it gone.
 *
 * So with no uploader registered the file picker is not offered at all, and the
 * dialog is what it has always been: insert by URL, with alt text.
 *
 * ## Registration
 *
 * Global by default, because that matches every other extension point here and
 * because most pages have one upload endpoint:
 *
 * ```js
 * OpenLeaf.registerImageUploader(async (file) => {
 *   const body = new FormData()
 *   body.append('file', file)
 *   const res = await fetch('/admin/media', { method: 'POST', body })
 *   if (!res.ok) throw new Error('The server rejected the upload.')
 *   const { url, width, height } = await res.json()
 *   return { src: url, width, height }
 * })
 * ```
 *
 * A single page with two editors posting to different endpoints sets
 * `element.imageUploader` instead, which takes precedence for that editor. Both
 * exist because the global one is the common case and the per-editor one is the
 * case that is impossible to express otherwise.
 */

import { isSafeUrl } from '@openleaf-editor/core'

/** What an uploader reports back. A bare string is shorthand for `{ src }`. */
export interface ImageUploadResult {
  src: string
  /**
   * Alternative text, if the media library already holds a description.
   *
   * Used to pre-fill the field the author is asked to confirm, never to skip
   * asking: a filename-derived description is worse than none, because it looks
   * like a description to everything except the person relying on it.
   */
  alt?: string | null
  title?: string | null
  /** Intrinsic dimensions, which prevent the page reflowing as images load. */
  width?: string | number | null
  height?: string | number | null
}

export type ImageUploader = (
  file: File,
  context: { host: HTMLElement },
) => Promise<ImageUploadResult | string>

/** An element that carries its own uploader, overriding the global one. */
interface HostWithUploader extends HTMLElement {
  imageUploader?: ImageUploader | null
}

let globalUploader: ImageUploader | null = null

/** Register the uploader for every editor on the page. `null` removes it. */
export function registerImageUploader(uploader: ImageUploader | null): void {
  globalUploader = uploader
}

/** The uploader this editor should use: its own if it has one, else the global. */
export function imageUploaderFor(host: HTMLElement | null | undefined): ImageUploader | null {
  const own = (host as HostWithUploader | null | undefined)?.imageUploader
  return own ?? globalUploader
}

/** Can this editor upload at all? Drives whether a file picker is offered. */
export function canUploadImages(host: HTMLElement | null | undefined): boolean {
  return imageUploaderFor(host) !== null
}

/** What the file picker offers. Advisory: a picker's accept list is not a check. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif'

/**
 * Is this a file the image flow will accept?
 *
 * Any `image/*` except SVG, which is deliberately excluded. An SVG is a document,
 * not a bitmap: it can carry `<script>` and event handlers, and while those do
 * not execute in an `<img>`, the same file opened directly -- or embedded with
 * `<object>` by some other part of the CMS -- is a stored XSS. Deciding an SVG is
 * safe requires sanitizing its interior, which is a job for the server that
 * accepts the upload, not for a drop handler.
 */
export function isUploadableImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml'
}

/** The uploadable images in a drop or a paste, in the order they arrived. */
export function imageFilesFrom(transfer: DataTransfer | null | undefined): File[] {
  return [...(transfer?.files ?? [])].filter(isUploadableImage)
}

/**
 * Run an uploader and normalize what it returns.
 *
 * Rejects a URL core would refuse rather than inserting it: an uploader that
 * hands back `javascript:` -- through a compromised media library, or a
 * misconfigured proxy that echoes a URL parameter -- would otherwise put it in
 * the document, where the schema drops it on the next parse and the author
 * cannot tell whether the upload or the editor lost their image.
 */
export async function runUploader(
  uploader: ImageUploader,
  file: File,
  host: HTMLElement,
): Promise<ImageUploadResult> {
  const raw = await uploader(file, { host })
  const result = typeof raw === 'string' ? { src: raw } : raw

  if (!result || typeof result.src !== 'string' || result.src === '') {
    throw new Error('The upload finished but reported no address for the image.')
  }
  if (!isSafeUrl(result.src)) {
    throw new Error('The upload reported an address the editor will not store.')
  }
  return result
}

/** Dimensions as attribute strings, dropping anything that is not a number. */
export function dimension(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(number) && number > 0 ? String(Math.round(number)) : null
}
