/**
 * The canonical sanitization policy, expressed as data.
 *
 * ## Why this package ships a policy rather than a sanitizer
 *
 * Writing a novel HTML sanitizer is a bad idea, and a bad idea does not stop
 * being one because the person having it is careful. Sanitizers are defeated by
 * mutation XSS, by parser differentials between the sanitizer and the renderer,
 * and by namespace confusion in SVG and MathML -- classes of bug that take years
 * of adversarial attention to find. DOMPurify has had that attention. A
 * hand-rolled one written this month has not.
 *
 * So the valuable artifact here is not code, it is **agreement**: one policy,
 * expressed as data, that the editor, your Node server, your PHP server and your
 * Python worker can all enforce in the same terms. Every CMS team writes this
 * allowlist by hand, writes it slightly differently in each language, and
 * discovers the divergence when something gets through.
 *
 * `toDOMPurifyConfig`, `toBleachConfig` and `toHtmlPurifierConfig` turn this
 * object into configuration for sanitizers that have already earned trust. The
 * bundled `sanitizeHtml` exists for environments where a dependency cannot be
 * added, and its limitations are documented rather than glossed over.
 *
 * ## The interaction that will surprise you
 *
 * OpenLeaf's preservation layer deliberately keeps markup the schema does not
 * recognise -- `<div class="callout">`, `<drupal-media>` -- because silently
 * deleting a customer's content is the failure this project exists to prevent.
 *
 * **A default-safe policy will strip exactly that markup.** The content the
 * editor worked to save is then destroyed on the server instead, which is the
 * same bug wearing a different hat.
 *
 * If you rely on preservation, you must extend the policy to name the elements
 * and attributes you intend to keep. `policyForPreserved()` is the helper for
 * that, and it is deliberately explicit: there is no "allow whatever the editor
 * emitted" mode, because that is not a policy, it is a wish.
 */

export interface ElementPolicy {
  /** Attribute names permitted on this element, beyond the global ones. */
  attributes?: string[]
}

export interface Policy {
  /** Bumped when the shape changes, so consumers can detect a mismatch. */
  version: number
  /** Permitted elements, and the attributes each may carry. */
  elements: Record<string, ElementPolicy>
  /** Attributes permitted on every allowed element. */
  globalAttributes: string[]
  /** Attributes whose values are URLs and must be scheme-checked. */
  urlAttributes: string[]
  /** URL schemes an author may link to. */
  urlSchemes: string[]
  /** Whether relative, fragment and protocol-relative URLs are permitted. */
  allowRelativeUrls: boolean
  /**
   * Elements removed along with their contents, even if somehow allowed
   * elsewhere. A belt-and-braces list: nothing here should ever reach a
   * sanitizer, but if it does, the content goes too rather than being unwrapped
   * into visible text.
   */
  dropWithContent: string[]
}

/**
 * The default policy: exactly what OpenLeaf's own schema can emit, and nothing
 * else.
 *
 * Kept deliberately narrow. Widening a policy is a decision an integrator makes
 * knowingly; narrowing one after content has been stored is a migration.
 */
export const DEFAULT_POLICY: Policy = {
  version: 1,

  elements: {
    p: { attributes: ['dir'] },
    h1: { attributes: ['dir'] },
    h2: { attributes: ['dir'] },
    h3: { attributes: ['dir'] },
    h4: { attributes: ['dir'] },
    h5: { attributes: ['dir'] },
    h6: { attributes: ['dir'] },
    blockquote: {},
    pre: {},
    code: {},
    ul: {},
    ol: { attributes: ['start'] },
    li: {},
    hr: {},
    br: {},
    strong: {},
    em: {},
    u: {},
    s: {},
    a: { attributes: ['href', 'title', 'target', 'rel'] },
    img: { attributes: ['src', 'alt', 'title', 'width', 'height'] },
  },

  // Empty on purpose. `class` and `id` are not globally safe: `class` lets
  // pasted content borrow your site's styling to impersonate UI, and a
  // duplicated `id` breaks label and aria-describedby associations elsewhere on
  // the page. Allow them per element, where you have decided which values.
  globalAttributes: [],

  urlAttributes: ['href', 'src', 'action', 'formaction', 'data', 'poster', 'cite', 'ping', 'srcdoc'],

  // `data:` is absent deliberately. `data:text/html` is a full XSS vector, and
  // separating safe data URLs from dangerous ones by sniffing the media type is
  // exactly the parsing that gets defeated.
  urlSchemes: ['http', 'https', 'mailto', 'tel', 'ftp', 'ftps'],

  allowRelativeUrls: true,

  dropWithContent: [
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'applet', 'form', 'input', 'button', 'select', 'textarea', 'option',
    'link', 'meta', 'base', 'noscript', 'template', 'svg', 'math',
  ],
}

/**
 * Extend a policy to cover markup kept by the preservation layer.
 *
 * Explicit by design. Passing `{ 'div': ['class', 'data-callout-id'] }` says
 * which markup you have decided is safe to store and render; there is no mode
 * that trusts whatever the editor produced, because the editor faithfully
 * preserves whatever an author pasted.
 *
 * ```ts
 * const policy = policyForPreserved(DEFAULT_POLICY, {
 *   div: ['class', 'data-callout-id'],
 *   'drupal-media': ['data-entity-type', 'data-entity-uuid', 'data-view-mode'],
 *   figure: ['class'],
 *   figcaption: [],
 * })
 * ```
 */
export function policyForPreserved(
  base: Policy,
  additions: Record<string, string[]>,
): Policy {
  const elements: Record<string, ElementPolicy> = { ...base.elements }

  for (const [tag, attributes] of Object.entries(additions)) {
    const name = tag.toLowerCase()
    if (base.dropWithContent.includes(name)) {
      throw new Error(
        `@openleaf/sanitize: refusing to allow <${name}>, which is on the ` +
          'dropWithContent list. If you genuinely need it, remove it from that ' +
          'list explicitly so the decision is visible in review.',
      )
    }
    const existing = elements[name]?.attributes ?? []
    elements[name] = { attributes: [...new Set([...existing, ...attributes])] }
  }

  return { ...base, elements }
}

/** Every attribute permitted on an element under a policy. */
export function allowedAttributes(policy: Policy, tag: string): Set<string> {
  const element = policy.elements[tag.toLowerCase()]
  if (!element) return new Set()
  return new Set([...policy.globalAttributes, ...(element.attributes ?? [])])
}

/** Is this element permitted at all? */
export function isAllowedElement(policy: Policy, tag: string): boolean {
  return Object.hasOwn(policy.elements, tag.toLowerCase())
}
