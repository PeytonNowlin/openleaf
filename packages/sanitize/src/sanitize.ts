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
 * **If you can add a dependency, use `toDOMPurifyConfig()` with DOMPurify
 * instead.** DOMPurify has had years of adversarial attention; this function has
 * had an afternoon. It exists because "add no dependencies" is a real constraint
 * in real CMS deployments, and shipping nothing would leave those integrators
 * writing their own, which is worse.
 *
 * And regardless of which you use: sanitize on the **server**. Anything the
 * client strips can be put back with developer tools, because the client runs
 * under the attacker's control.
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

  const template = doc.createElement('template')
  template.innerHTML = html
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
    for (const child of Array.from(node.children)) visit(child)

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
    if ((tag === 'video' || tag === 'audio') && !node.getAttribute('src')) {
      node.remove()
      return
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

  for (const child of Array.from(root.children)) visit(child)

  return root.innerHTML
}
