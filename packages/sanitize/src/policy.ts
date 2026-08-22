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
 *
 * ## The same interaction, one layer in
 *
 * The section above says "preserved elements", and reading it you would look
 * for the unfamiliar tags in your content and widen the policy for those. That
 * is no longer the whole of it. Core carries the attributes it does not model
 * on **its own** nodes too (`coreNodesWithCarriedAttributes` in
 * `packages/core/src/extensions.ts`), so a perfectly ordinary paragraph now
 * round-trips as:
 *
 * ```html
 * <p class="lead" data-cms="7" style="letter-spacing:0.05em">
 * ```
 *
 * There is no unfamiliar tag to notice. `p` is in this policy already, allowing
 * `dir` and `style` for three declarations, so `class`, `data-cms` and the
 * `letter-spacing` are stripped on the server -- content the editor went out of
 * its way to keep, deleted one layer later, with nothing in the markup to hint
 * that the policy needed widening.
 *
 * `policyForCarriedAttributes()` is the same mechanism as `policyForPreserved`
 * under a name that fits the case: you are not naming preserved tags, you are
 * naming residue on tags the policy already knows. Both are explicit for the
 * same reason -- the editor faithfully carries whatever an author pasted, so
 * "allow what the editor emitted" is not a policy. And both stop at the same
 * line: naming `letter-spacing` does not admit it, because a declaration is
 * only ever permitted by a checker in css.ts that knows what a safe value of it
 * looks like.
 */

import { DROP_WITH_CONTENT } from '@openleaf-editor/content-policy/elements'
import { deepFreeze } from './freeze.js'
import { isNeverAllowedAttribute } from './url.js'

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
   *
   * 3 added modelled structure (figure, details, media, heading ids) and
   * allowlisted iframe embeds. Iframe left `dropWithContent` because the editor
   * now emits it; an iframe whose `src` is not an allowlisted player is still
   * removed.
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
 * The default policy: what OpenLeaf's *modelled* node and mark types emit.
 *
 * It used to say "exactly what OpenLeaf's own schema can emit, and nothing
 * else". That was wrong in the dangerous direction. The schema also emits
 * everything the preservation layer kept -- a `<drupal-media>`, a `div` with a
 * load-bearing class, a `<font>` run from 2011 -- and this policy rejects all of
 * it. So a reader who took the sentence at face value concluded the default was
 * sufficient for their content, and lost the preserved half of it on first save.
 * That is the trap `SECURITY.md` names, and the comment was walking readers into
 * it. Preserved markup is `policyForPreserved`'s job, explicitly.
 *
 * Kept deliberately narrow. Widening a policy is a decision an integrator makes
 * knowingly; narrowing one after content has been stored is a migration.
 *
 * ## Frozen, deeply, and why that is not decoration
 *
 * This is a module-level singleton that every `sanitizeHtml()` call in the
 * process reads by default. Unfrozen, one line anywhere on the page --
 * `DEFAULT_POLICY.globalAttributes.push('onclick')`, or
 * `DEFAULT_POLICY.dropWithContent.length = 0` -- silently reconfigures the
 * sanitizer for every subsequent call, with nothing in any call site changed and
 * nothing to see in review. On a Node server that is a gadget: a single
 * write primitive anywhere in the process turns the shared allowlist off for
 * every request that follows, for the lifetime of the process.
 *
 * Freezing turns that from a silent, permanent, process-wide reconfiguration
 * into a `TypeError` at the line that tried it. An integrator who genuinely
 * wants a different policy has `policyForPreserved`, which returns a new one.
 */
export const DEFAULT_POLICY: Policy = deepFreeze({
  version: 3,

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
    p: { attributes: ['dir', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h1: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h2: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h3: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h4: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h5: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    h6: { attributes: ['dir', 'id', 'style'], styleProperties: ['text-align', 'line-height', 'padding-inline-start'] },
    /*
     * `<span>` exists in this policy only to carry colour.
     *
     * Note what it does NOT allow: no `class`, so pasted content cannot borrow
     * the site's styling to impersonate UI, and no properties beyond the two
     * colours. A span with any other attribute is unwrapped and its text kept,
     * which is what the editor's own preservation layer does with one it cannot
     * model.
     */
    span: { attributes: ['style', 'lang'], styleProperties: ['color', 'background-color', 'font-family', 'font-size'] },
    blockquote: {},
    pre: {},
    // The language class and nothing else. The schema reads `language-js` from
    // either element and normalizes it onto <code>, so that is the only place
    // stored content carries it -- allowing it on <pre> too would widen the
    // policy for markup the editor does not emit. A class on <pre> is
    // preservation residue, and preservation is opt-in via policyForPreserved().
    code: { attributes: ['class'] },
    ul: { attributes: ['style'], styleProperties: ['list-style-type'] },
    ol: { attributes: ['start', 'style'], styleProperties: ['list-style-type'] },
    li: {},
    hr: { attributes: ['class'] },
    br: {},
    strong: {},
    em: {},
    u: {},
    s: {},
    sub: {},
    sup: {},
    a: { attributes: ['href', 'title', 'target', 'rel', 'id'] },
    img: { attributes: ['src', 'alt', 'title', 'width', 'height', 'class'] },
    figure: { attributes: ['class'] },
    figcaption: {},
    details: { attributes: ['open'] },
    summary: {},
    video: { attributes: ['src', 'title', 'controls', 'width', 'height', 'poster'] },
    audio: { attributes: ['src', 'title', 'controls'] },
    /*
     * `<source>` and `<track>` are the only children the media nodes model, and
     * the editor emits them for source-only media -- a `<video>` with no `src`
     * of its own. Without them here a server-side pass would unwrap the sources
     * out of every such player and then delete the player for having no source.
     */
    /*
     * No `srcset`. content-policy classifies it as never-carryable -- "comma-
     * separated URL lists no single-URL check reads" -- and nothing here reads
     * one either: it is not in `urlAttributes`, so permitting it was permitting
     * an attacker-chosen URL list blind. The editor never emits one; source-only
     * media carries its address in `src`. `sizes` and `media` stay: a length
     * list and a media query, neither of which is a URL.
     */
    source: { attributes: ['src', 'type', 'media', 'sizes'] },
    track: { attributes: ['src', 'kind', 'srclang', 'label', 'default'] },
    /*
     * Iframes are allowlisted by host in sanitize.ts, not by being listed here.
     * Listing the element without that check would store an arbitrary nested
     * page; the host check is what makes this safe to emit.
     */
    iframe: { attributes: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen'] },

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
     *
     * `bgcolor` is the carried-attribute case in miniature. The schema reads it
     * into `background-color` and, since it does not model the attribute
     * itself, carries it as residue -- so the editor emits both, and a policy
     * listing only the declaration keeps half of what it stored. It is a colour
     * word or a hex triplet with no URL in it, which is why it can be allowed
     * at all.
     */
    table: {
      attributes: [
        'border', 'cellpadding', 'cellspacing', 'width', 'align', 'summary', 'class', 'bgcolor', 'style',
      ],
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
      attributes: ['class', 'align', 'valign', 'bgcolor', 'style'],
      styleProperties: ['background-color', 'height'],
    },
    td: {
      attributes: [
        'colspan', 'rowspan', 'data-colwidth',
        'align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr', 'bgcolor', 'style',
      ],
      styleProperties: ['background-color', 'padding'],
    },
    th: {
      attributes: [
        'colspan', 'rowspan', 'data-colwidth',
        'align', 'valign', 'width', 'height', 'class', 'scope', 'headers', 'abbr', 'bgcolor', 'style',
      ],
      styleProperties: ['background-color', 'padding'],
    },
  },

  // Empty on purpose. `class` and `id` are not globally safe: `class` lets
  // pasted content borrow your site's styling to impersonate UI, and a
  // duplicated `id` breaks label and aria-describedby associations elsewhere on
  // the page. Allow them per element, where you have decided which values.
  globalAttributes: [],

  // Kept in step with `URL_ATTRIBUTES` in @openleaf-editor/content-policy, and
  // pinned by a test. This list had already drifted from it -- `background`,
  // `longdesc` and `xlink:href` were missing, so a policy that permitted one of
  // them would have kept a `javascript:` value unchecked. `content-policy`
  // exists so the editor and the sanitizers cannot disagree about this; two
  // hand-maintained copies is exactly the divergence it was written to stop.
  //
  // `srcdoc` is deliberately NOT here, and its absence is the point. It holds a
  // whole HTML document rather than a URL, so a scheme check finds no scheme,
  // concludes "relative, therefore safe", and waves it through -- which is how
  // an inline `<script>` rode into a same-origin frame. It is refused outright
  // instead, by `NEVER_CARRY_ATTRIBUTES` in content-policy. Listing it here
  // would be harmless only for as long as no element's policy permits it.
  urlAttributes: [
    'href', 'src', 'action', 'formaction', 'data', 'poster', 'background',
    'cite', 'longdesc', 'xlink:href', 'ping',
  ],

  // `data:` is absent deliberately. `data:text/html` is a full XSS vector, and
  // separating safe data URLs from dangerous ones by sniffing the media type is
  // exactly the parsing that gets defeated.
  urlSchemes: ['http', 'https', 'mailto', 'tel', 'ftp', 'ftps'],

  allowRelativeUrls: true,

  // Spread from content-policy rather than written out again. This list and
  // core's `NEVER_PRESERVE` are the same decision made in two packages; they
  // were kept in step by hand and drifted, which is how the editor came to store
  // `<svg>` and `<math>` that this list says to delete.
  dropWithContent: [...DROP_WITH_CONTENT],
})

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
 *
 * The result is a deep copy. It used to be `{ ...base, elements }`, which
 * copied `elements` one level and shared `dropWithContent`, `urlSchemes`,
 * `urlAttributes` and `globalAttributes` **by reference** -- so a caller who
 * adjusted the "extended" policy was reaching into `DEFAULT_POLICY` and
 * changing it for every other consumer in the process. Deriving a policy is
 * supposed to leave the one you derived it from alone.
 */
export function policyForPreserved(
  base: Policy,
  additions: Record<string, string[] | ElementPolicy>,
): Policy {
  // Copy every element entry, not just the map: the entries this call does not
  // touch would otherwise still be the base policy's own objects, holding the
  // base policy's own `attributes` array.
  const elements: Record<string, ElementPolicy> = {}
  for (const [name, element] of Object.entries(base.elements)) {
    elements[name] = {
      ...element,
      ...(element.attributes ? { attributes: [...element.attributes] } : {}),
      ...(element.styleProperties ? { styleProperties: [...element.styleProperties] } : {}),
    }
  }

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

  return {
    ...base,
    elements,
    globalAttributes: [...base.globalAttributes],
    urlAttributes: [...base.urlAttributes],
    urlSchemes: [...base.urlSchemes],
    dropWithContent: [...base.dropWithContent],
  }
}

/**
 * Extend a policy to cover the residue core carries on its own nodes.
 *
 * Mechanically identical to `policyForPreserved` -- same merge, same refusal to
 * allow a `dropWithContent` element -- and separate because the two cases do
 * not look alike from where an integrator sits. `policyForPreserved` asks
 * "which unfamiliar tags does my content contain?", and you answer it by
 * looking for `<drupal-media>`. This one asks "which attributes ride along on
 * the tags I already allow?", where there is no unfamiliar tag to find: the
 * markup is `<p>`, and what goes missing is the `class` on it.
 *
 * ```ts
 * const policy = policyForCarriedAttributes(DEFAULT_POLICY, {
 *   p: ['class', 'data-cms'],
 *   h2: ['class'],
 *   // The object form, when a declaration has to survive as well.
 *   blockquote: { attributes: ['style'], styleProperties: ['padding'] },
 * })
 * ```
 *
 * Widening, never replacing: `{ p: ['class'] }` adds `class` to what `p`
 * already allowed. As with its sibling, a property named here still needs a
 * checker in css.ts, and there is no "allow any value" mode.
 */
export function policyForCarriedAttributes(
  base: Policy,
  additions: Record<string, string[] | ElementPolicy>,
): Policy {
  return policyForPreserved(base, additions)
}

/**
 * Every attribute an element may CARRY under a policy, with the never-allowed
 * ones removed.
 *
 * The filter is here, at the one accessor both the enforcer and the adapter
 * generators read, rather than in each of them. A policy is data an integrator
 * is invited to widen -- `policyForCarriedAttributes(DEFAULT_POLICY, { img:
 * ['srcset'] })` is a supported call -- and a widening that `sanitizeHtml`
 * refuses while `toDOMPurifyConfig` copies into `ALLOWED_ATTR` is the
 * cross-runtime divergence this package exists to prevent.
 */
export function allowedAttributes(policy: Policy, tag: string): Set<string> {
  const element = policy.elements[tag.toLowerCase()]
  if (!element) return new Set()
  return new Set(
    [...policy.globalAttributes, ...(element.attributes ?? [])].filter(
      (name) => !isNeverAllowedAttribute(name),
    ),
  )
}

/**
 * One element's carryable attributes, in the policy's own order.
 *
 * `allowedAttributes` folds in the globals and returns a Set; the generators
 * need the per-element list on its own, and need it ordered, because their
 * output is a file a human reads and re-reads in diffs.
 */
export function carriedAttributes(element: ElementPolicy): string[] {
  return (element.attributes ?? []).filter((name) => !isNeverAllowedAttribute(name))
}

/** The global attributes a policy may really apply to every element. */
export function carriedGlobalAttributes(policy: Policy): string[] {
  return policy.globalAttributes.filter((name) => !isNeverAllowedAttribute(name))
}

/** Every CSS property permitted inside `style` on an element. */
export function allowedStyleProperties(policy: Policy, tag: string): Set<string> {
  return new Set(policy.elements[tag.toLowerCase()]?.styleProperties ?? [])
}

/** Is this element permitted at all? */
export function isAllowedElement(policy: Policy, tag: string): boolean {
  return Object.hasOwn(policy.elements, tag.toLowerCase())
}
