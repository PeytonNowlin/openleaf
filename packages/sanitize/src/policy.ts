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
  /**
   * CSS properties permitted inside a `style` attribute on this element.
   *
   * Only consulted when `style` is in `attributes`. The two are separate because
   * allowing the attribute and allowing a property are different decisions: an
   * element may carry `style` for `text-align` and still have `position` stripped
   * out of it.
   */
  styleProperties?: string[]
}

export interface Policy {
  /**
   * Bumped when the shape changes, so consumers can detect a mismatch.
   *
   * 2 added `styleProperties`, when the editor learned to write alignment and
   * colour. A version 1 consumer reading a version 2 policy sees `style` in an
   * element's attributes and no idea which declarations are meant, so it would
   * allow the lot -- which is why this is a version bump rather than an addition.
   */
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
  version: 2,

  elements: {
    /*
     * `style` on a text block, for `text-align` and nothing else.
     *
     * Allowing the attribute at all is the most consequential line in this file,
     * so here is the reasoning. `<p align="center">` was removed from HTML years
     * ago and every editor OpenLeaf is meant to replace writes
     * `style="text-align:center"`, so a policy that forbids `style` outright
     * deletes the alignment out of every document it touches -- the
     * "content dies on the server" failure this package exists to prevent.
     *
     * What makes it safe is that the property list is closed and the VALUES are
     * checked. `style` earned its reputation from `expression()`, `url()` and
     * `position:fixed` overlays; none of those is reachable through a property
     * list of `text-align` whose values must be one of four keywords.
     */
    p: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h1: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h2: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h3: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h4: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h5: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    h6: { attributes: ['dir', 'style'], styleProperties: ['text-align'] },
    /*
     * `<span>` exists in this policy only to carry colour.
     *
     * Note what it does NOT allow: no `class`, so pasted content cannot borrow
     * the site's styling to impersonate UI, and no properties beyond the two
     * colours. A span with any other attribute is unwrapped and its text kept,
     * which is what the editor's own preservation layer does with one it cannot
     * model.
     */
    span: { attributes: ['style'], styleProperties: ['color', 'background-color'] },
    blockquote: {},
    pre: {},
    // The language class and nothing else. The schema reads `language-js` from
    // either element and normalizes it onto <code>, so that is the only place
    // stored content carries it -- allowing it on <pre> too would widen the
    // policy for markup the editor does not emit. A class on <pre> is
    // preservation residue, and preservation is opt-in via policyForPreserved().
    code: { attributes: ['class'] },
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

    /*
     * Tables. These mirror packages/core/src/tables.ts exactly, including the
     * legacy presentational attributes the schema deliberately preserves --
     * a policy narrower than the schema does not protect anybody, it just
     * destroys content on the way to the database.
     *
     * `scope`, `headers` and `abbr` are here for the same reason the schema
     * keeps them: they are what tells a screen reader which cells a header
     * governs, and stripping them turns a navigable table into a grid of
     * unrelated values.
     */
    table: {
      attributes: ['border', 'cellpadding', 'cellspacing', 'width', 'align', 'summary', 'class', 'style'],
      styleProperties: ['background-color', 'width', 'height'],
    },
    /*
     * `caption` is here because it is a table's accessible name, and `colgroup`
     * and `col` because they carry the column widths a page's layout depends on.
     * The schema preserves all three verbatim; a policy that stripped them would
     * delete on the way to the database exactly what the editor just took care
     * to keep, which is the drift this shared policy exists to prevent.
     */
    caption: { attributes: ['align', 'class', 'style'], styleProperties: ['text-align'] },
    colgroup: { attributes: ['span', 'width', 'align', 'valign', 'class'] },
    col: { attributes: ['span', 'width', 'align', 'valign', 'class'] },
    thead: {},
    tbody: {},
    tfoot: {},
    tr: {
      attributes: ['class', 'align', 'valign', 'style'],
      styleProperties: ['background-color', 'height'],
    },
    td: {
      attributes: [
        'colspan', 'rowspan', 'data-colwidth',
        'align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr', 'style',
      ],
      styleProperties: ['background-color', 'padding'],
    },
    th: {
      attributes: [
        'colspan', 'rowspan', 'data-colwidth',
        'align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr', 'style',
      ],
      styleProperties: ['background-color', 'padding'],
    },
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
 *   // The object form, when a declaration has to survive as well as an attribute.
 *   p: { attributes: ['style'], styleProperties: ['line-height'] },
 * })
 * ```
 *
 * A property named here still has to have a checker in css.ts, and there is
 * deliberately no "allow any value" mode: `styleProperties: ['background']`
 * without one permits nothing, rather than permitting `url(...)`.
 */
export function policyForPreserved(
  base: Policy,
  additions: Record<string, string[] | ElementPolicy>,
): Policy {
  const elements: Record<string, ElementPolicy> = { ...base.elements }

  for (const [tag, addition] of Object.entries(additions)) {
    const name = tag.toLowerCase()
    if (base.dropWithContent.includes(name)) {
      throw new Error(
        `@openleaf-editor/sanitize: refusing to allow <${name}>, which is on the ` +
          'dropWithContent list. If you genuinely need it, remove it from that ' +
          'list explicitly so the decision is visible in review.',
      )
    }
    // An array is the original shape, kept working: `{ div: ['class'] }`. The
    // object shape is for the case an array cannot express, which arrived with
    // `styleProperties` -- preserved markup carrying a declaration OpenLeaf does
    // not model, such as a `line-height` an author set years ago.
    const next: ElementPolicy = Array.isArray(addition) ? { attributes: addition } : addition
    const existing = elements[name]
    const attributes = [
      ...new Set([...(existing?.attributes ?? []), ...(next.attributes ?? [])]),
    ]
    const styleProperties = [
      ...new Set([...(existing?.styleProperties ?? []), ...(next.styleProperties ?? [])]),
    ]
    elements[name] = {
      attributes,
      ...(styleProperties.length > 0 ? { styleProperties } : {}),
    }
  }

  return { ...base, elements }
}

/** Every attribute permitted on an element under a policy. */
export function allowedAttributes(policy: Policy, tag: string): Set<string> {
  const element = policy.elements[tag.toLowerCase()]
  if (!element) return new Set()
  return new Set([...policy.globalAttributes, ...(element.attributes ?? [])])
}

/** Every CSS property permitted inside `style` on an element. */
export function allowedStyleProperties(policy: Policy, tag: string): Set<string> {
  return new Set(policy.elements[tag.toLowerCase()]?.styleProperties ?? [])
}

/** Is this element permitted at all? */
export function isAllowedElement(policy: Policy, tag: string): boolean {
  return Object.hasOwn(policy.elements, tag.toLowerCase())
}
