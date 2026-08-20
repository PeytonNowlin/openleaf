/**
 * A reference policy enforcer.
 *
 * ## Read this before using it
 *
 * This is **not** a hardened sanitizer and does not claim to be. It walks a
 * parsed DOM and removes what the policy does not permit. That handles the
 * ordinary cases correctly, and it does not attempt to defend against:
 *
 *   - **Mutation XSS.** Markup that is harmless when parsed and becomes
 *     dangerous when re-serialized and re-parsed by a different parser. This is
 *     the class of bug that has repeatedly defeated experienced implementations.
 *   - **Parser differentials.** Your renderer's HTML parser and the one used
 *     here disagreeing about the same bytes.
 *   - **SVG and MathML namespace confusion.** Both are dropped wholesale by the
 *     default policy rather than reasoned about, because reasoning about them
 *     correctly is a research project.
 *
 * **If you can add a dependency, use `configureDOMPurify()` with DOMPurify
 * instead.** DOMPurify has had years of adversarial attention; this function has
 * had an afternoon. It exists because "add no dependencies" is a real constraint
 * in real CMS deployments, and shipping nothing would leave those integrators
 * writing their own, which is worse.
 *
 * And regardless of which you use: sanitize on the **server**. Anything the
 * client strips can be put back with developer tools, because the client runs
 * under the attacker's control.
 *
 * ## Never fall back to the unsanitized original
 *
 * Because you are running this on a server, the tempting shape is
 *
 *     let clean
 *     try { clean = sanitizeHtml(dirty) } catch { clean = dirty }
 *
 * Do not. Every `catch` that keeps the input is a bypass an attacker only has
 * to *reach* rather than defeat, and before the depth limit below existed,
 * reaching it took about 43 KB of nested `<div>`. If sanitizing fails, reject
 * the content. See {@link SanitizeDepthError}.
 */

import { isAllowedEmbedSrc, safeAllowList } from './embed.js'
import { filterStyle } from './css.js'
import {
  DEFAULT_POLICY,
  allowedAttributes,
  allowedStyleProperties,
  isAllowedElement,
  type Policy,
} from './policy.js'

export interface SanitizeOptions {
  policy?: Policy
  /** DOM implementation. Defaults to the global `document`. */
  document?: Document
  /**
   * Maximum element nesting. Defaults to {@link MAX_SANITIZE_DEPTH}. Raise it
   * only if you have measured your DOM implementation's limits, and read what
   * {@link SanitizeDepthError} says about handling the failure first.
   */
  maxDepth?: number
}

/**
 * How deep a document may nest before this refuses to sanitize it.
 *
 * Not our own limit -- the DOM implementation's. Measured on jsdom 26 at Node
 * 26's default stack size, every step of this function is recursive somewhere
 * inside jsdom and each gives out at a different depth: reading `innerHTML` back
 * at the end throws `RangeError` at about 3,000 levels, moving the parsed
 * fragment into a host element at about 5,000, and the parser itself at about
 * 20,000. So there is no arrangement of this code that can return a result for
 * a document nested past a few thousand elements, and pretending otherwise just
 * moves which line throws.
 *
 * 500 leaves a wide margin below the lowest of those cliffs -- stack limits vary
 * by engine, by platform and by how deep the call stack already was -- and sits
 * far above anything a person writes. It matches `MAX_PARSE_DEPTH` in
 * @openleaf-editor/core, deliberately: one number, one story.
 */
export const MAX_SANITIZE_DEPTH = 500

/**
 * Thrown for input nested past the depth limit.
 *
 * ## Do not catch this and keep the original HTML
 *
 * That pattern --
 *
 *     let clean
 *     try { clean = sanitizeHtml(dirty) } catch { clean = dirty }
 *
 * -- is a **sanitizer bypass**, and it is the reason this is a named error
 * rather than a bare `Error`. An attacker who can make the sanitizer throw can
 * then store whatever they like, and making it throw took about 43 KB of
 * nested `<div>` before the depth limit existed.
 *
 * Reject the submission instead. Content nested 500 elements deep is not
 * something an author produced, so refusing it costs nobody anything:
 *
 *     try {
 *       clean = sanitizeHtml(dirty)
 *     } catch (error) {
 *       if (error instanceof SanitizeDepthError) return badRequest('Content too deeply nested')
 *       throw error
 *     }
 */
export class SanitizeDepthError extends Error {
  readonly depthLimit: number

  constructor(limit: number, options?: ErrorOptions) {
    super(
      `@openleaf-editor/sanitize: HTML nests more than ${limit} elements deep, which is past ` +
        'what a DOM implementation can serialize without overflowing its stack. Reject this ' +
        'content -- do NOT fall back to storing the unsanitized original, which is a bypass.',
      options,
    )
    this.name = 'SanitizeDepthError'
    this.depthLimit = limit
  }
}

/**
 * Deepest element nesting under `root`, measured on an explicit stack.
 *
 * Iterative so that measuring cannot itself overflow, which is the whole point:
 * this has to survive input that every recursive step downstream would not.
 * Stops as soon as the limit is beaten, so the common case does not pay for the
 * pathological one.
 */
function exceedsDepth(root: ParentNode, limit: number): boolean {
  const nodes: Element[] = []
  const depths: number[] = []
  for (const child of Array.from(root.children)) {
    nodes.push(child)
    depths.push(1)
  }
  while (nodes.length > 0) {
    const node = nodes.pop() as Element
    const depth = depths.pop() as number
    if (depth > limit) return true
    for (const child of Array.from(node.children)) {
      nodes.push(child)
      depths.push(depth + 1)
    }
  }
  return false
}

/** Strip the characters browsers ignore when resolving a URL scheme. */
function normalizeUrl(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f-\u00a0]/g, '').toLowerCase()
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i

export function isUrlAllowed(value: string, policy: Policy): boolean {
  const candidate = normalizeUrl(value)
  if (candidate === '') return false
  const match = SCHEME.exec(candidate)
  if (!match) return policy.allowRelativeUrls
  return policy.urlSchemes.includes(match[1] as string)
}

function resolveDocument(explicit?: Document): Document {
  const doc = explicit ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) {
    throw new Error(
      '@openleaf-editor/sanitize: no Document available. Pass { document } when running ' +
        'outside a browser, or use the policy with a server-side sanitizer.',
    )
  }
  return doc
}

/**
 * Apply a policy to an HTML string.
 *
 * Elements not in the policy are **unwrapped**, keeping their text, rather than
 * deleted. An unknown wrapper is usually a styling div, and deleting a
 * paragraph because it sat inside one would be its own content-loss bug. The
 * exception is `dropWithContent`, where the element and everything in it goes.
 */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const policy = options.policy ?? DEFAULT_POLICY
  const doc = resolveDocument(options.document)

  const maxDepth = options.maxDepth ?? MAX_SANITIZE_DEPTH
  const template = doc.createElement('template')
  // The parser is itself recursive and gives out at around 20,000 levels on
  // jsdom, which is *before* the depth check below could ever run. Converting
  // its `RangeError` here rather than letting it escape is the difference
  // between a caller seeing a refusal it can act on and seeing an engine-level
  // crash it is likely to treat as a transient failure and retry or swallow.
  try {
    template.innerHTML = html
  } catch (error) {
    throw new SanitizeDepthError(maxDepth, { cause: error })
  }

  // Checked after the parse, which survives far deeper than anything after it,
  // and before the first operation that recurses inside the DOM implementation.
  // Every line below this one would throw an unattributed `RangeError` on input
  // this deep.
  if (exceedsDepth(template.content, maxDepth)) throw new SanitizeDepthError(maxDepth)

  const root = doc.createElement('div')
  root.appendChild(template.content)

  // Remove the always-dangerous elements first, contents included, so nothing
  // below can unwrap them into visible text.
  for (const tag of policy.dropWithContent) {
    for (const el of Array.from(root.getElementsByTagName(tag))) {
      el.remove()
    }
  }

  const visit = (node: Element): void => {
    const tag = node.nodeName.toLowerCase()

    if (!isAllowedElement(policy, tag)) {
      // Unwrap rather than delete: the text inside almost certainly matters.
      const parent = node.parentNode
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
      }
      return
    }

    const permitted = allowedAttributes(policy, tag)
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()

      if (!permitted.has(name)) {
        node.removeAttribute(attr.name)
        continue
      }
      if (name === 'style') {
        // Allowing `style` is allowing a list of declarations, never the
        // attribute wholesale. A paragraph may carry `text-align`; the same
        // attribute carrying `position:fixed` is a page-covering overlay that
        // looks like your own UI, so what is not on the list goes.
        const kept = filterStyle(attr.value, allowedStyleProperties(policy, tag))
        if (kept === null) node.removeAttribute(attr.name)
        else if (kept !== attr.value) node.setAttribute(attr.name, kept)
        continue
      }
      if (policy.urlAttributes.includes(name) && !isUrlAllowed(attr.value, policy)) {
        node.removeAttribute(attr.name)
      }
    }

    if (tag === 'iframe') {
      const src = node.getAttribute('src')
      if (!isAllowedEmbedSrc(src)) {
        node.remove()
        return
      }
      // An allowlisted host is not enough on its own. `allow` is the attribute
      // that lets a frame step outside the page's restrictions, so a permitted
      // player URL carrying `allow="camera; microphone"` would still be handed
      // the camera.
      if (node.hasAttribute('allow')) {
        const kept = safeAllowList(node.getAttribute('allow'))
        if (kept === null) node.removeAttribute('allow')
        else if (kept !== node.getAttribute('allow')) node.setAttribute('allow', kept)
      }
    }
    // A player with nothing to play. `<source>` children count: source-only
    // media is what the editor emits for `<video><source src="clip.webm">`, and
    // removing it for having no `src` attribute would delete a working player.
    if (tag === 'video' || tag === 'audio') {
      const hasSource = node.getAttribute('src') !== null || node.querySelector('source') !== null
      if (!hasSource) {
        node.remove()
        return
      }
    }

    // A link that opens a new window without rel=noopener hands the opened page
    // a handle on yours. Repair rather than reject: the author's intent is fine,
    // the omission is not.
    if (tag === 'a' && node.getAttribute('target') === '_blank') {
      const rel = node.getAttribute('rel') ?? ''
      if (!/\bnoopener\b/.test(rel)) {
        node.setAttribute('rel', `${rel} noopener noreferrer`.trim())
      }
    }
  }

  /**
   * Post-order traversal on an explicit stack, because recursion was a bypass.
   *
   * `visit` used to recurse once per level of nesting. Measured on Node 26 at
   * the default stack size, 4,000 levels -- about 43 KB of `<div>` -- threw
   * `RangeError: Maximum call stack size exceeded`. That is not merely a crashed
   * request: the docstring above tells integrators to run this on the SERVER,
   * and the natural shape of the integration there is a try/catch that keeps the
   * original HTML when sanitizing fails --
   * which turns a 43 KB request body into a **sanitizer bypass** -- unsanitized
   * markup stored because the sanitizer fell over on the way to filtering it.
   *
   * The traversal was already post-order over `Array.from(node.children)`, a
   * snapshot taken before any mutation, so it converts to a worklist without
   * changing what `visit` sees. Children are collected on the way down and
   * visited on the way back up, in the same order as before.
   */
  const order: Element[] = []
  const pending: Element[] = Array.from(root.children)
  while (pending.length > 0) {
    const node = pending.pop() as Element
    order.push(node)
    for (const child of Array.from(node.children)) pending.push(child)
  }
  for (let i = order.length - 1; i >= 0; i -= 1) visit(order[i] as Element)

  return root.innerHTML
}
