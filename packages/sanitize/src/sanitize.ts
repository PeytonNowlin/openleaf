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
 */

import { isAllowedEmbedSrc, safeAllowList } from './embed.js'
import { filterStyle } from './css.js'
import { isEventHandlerAttribute } from './url.js'
import {
  DEFAULT_POLICY,
  allowedAttributes,
  allowedStyleProperties,
  isAllowedElement,
  type Policy,
} from './policy.js'

/**
 * Attributes no policy may re-enable, whatever it says.
 *
 * Until now `onclick` was stripped only as an emergent property of the
 * allowlist: nothing in `DEFAULT_POLICY` named it, so nothing kept it. That is
 * true of the default and not of a policy in general. `policyForPreserved` and
 * the `policy` option both let a caller name attributes per element, so
 * `policyForPreserved(DEFAULT_POLICY, { div: ['class', 'onclick'] })` produced a
 * policy under which this function happily kept `onclick` -- the caller widening
 * one element's attribute list almost certainly did not mean to re-enable script
 * execution, and nothing told them they had.
 *
 * So the check is now independent of the policy, matching what the DOMPurify
 * adapter already forbids. A denial that only holds while the allowlist happens
 * to stay narrow is not a security property.
 */
const NEVER_ALLOWED = new Set(['srcdoc', 'formaction', 'ping', 'xlink:href'])

function isNeverAllowed(name: string): boolean {
  return isEventHandlerAttribute(name) || NEVER_ALLOWED.has(name)
}

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

/**
 * Delete every comment node under `root`.
 *
 * Written as an explicit recursion over `childNodes` rather than a `TreeWalker`
 * because `Document.createTreeWalker` is the one part of this file that a
 * minimal server-side DOM shim is likely not to implement, and the whole point
 * of accepting a `{ document }` is to work against those.
 */
function removeComments(root: Node): void {
  for (const child of Array.from(root.childNodes)) {
    // 8 is Node.COMMENT_NODE, spelled numerically because the `Node` constant
    // is not guaranteed to be a global outside a browser.
    if (child.nodeType === 8) child.parentNode?.removeChild(child)
    else if (child.nodeType === 1) removeComments(child)
  }
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

  // Comments, everywhere, before anything else looks at the tree.
  //
  // The walk below iterates `children`, which is elements only, so a comment
  // node was never visited and `innerHTML` re-emitted it verbatim. That made
  // `<!--<img src=x onerror=alert(1)>-->` a pass-through: inert as parsed here,
  // and live the moment any downstream consumer unwraps or regex-strips
  // comments, which is a routine thing for a template layer to do. It is also a
  // divergence from the DOMPurify configuration this same package emits, which
  // drops comments by default -- two paths the docs present as equivalent are
  // not allowed to disagree about what survives.
  //
  // Nothing in the editor's output needs comments, so there is no content-loss
  // trade here: conditional comments are IE furniture, not authored text.
  removeComments(root)

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

      // Checked before the allowlist, not after, so that a policy naming one of
      // these cannot reach the branch that would keep it.
      if (isNeverAllowed(name)) {
        node.removeAttribute(attr.name)
        continue
      }
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

  for (const child of Array.from(root.children)) visit(child)

  return root.innerHTML
}
