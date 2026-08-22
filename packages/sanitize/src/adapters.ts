/**
 * Turn the policy into configuration for sanitizers that already have trust.
 *
 * This is the point of the package. A CMS is rarely one language: the editor is
 * JavaScript, the request handler is PHP or Python, and a background worker
 * re-renders stored content somewhere else again. Each of those normally grows
 * its own hand-written allowlist, the three drift, and the divergence is
 * discovered by something getting through the weakest one.
 *
 * One policy, three configurations, generated rather than transcribed.
 */

import { allStyleProperties, filterStyle } from './css.js'
import { EMBED_ALLOW_TOKENS, EMBED_HOSTS, isAllowedEmbedSrc, safeAllowList } from './embed.js'
import {
  allowedStyleProperties,
  carriedAttributes,
  carriedGlobalAttributes,
  type Policy,
} from './policy.js'

/* ------------------------------------------------------------------ *
 * DOMPurify (JavaScript, browser and Node)
 * ------------------------------------------------------------------ */

export interface DOMPurifyConfig {
  ALLOWED_TAGS: string[]
  ALLOWED_ATTR: string[]
  ALLOWED_URI_REGEXP: RegExp
  FORBID_TAGS: string[]
  FORBID_CONTENTS: string[]
  FORBID_ATTR: string[]
  ALLOW_DATA_ATTR: boolean
  KEEP_CONTENT: boolean
}

/** The small DOMPurify surface needed to install OpenLeaf's policy hooks. */
export interface DOMPurifyHooks {
  addHook(name: 'uponSanitizeAttribute', hook: (node: Element, data: DOMPurifyAttributeEvent) => void): void
  addHook(name: 'uponSanitizeElement', hook: (node: Element) => void): void
}

/**
 * Configuration for DOMPurify.
 *
 * ```js
 * import DOMPurify from 'dompurify'
 * import { configureDOMPurify, DEFAULT_POLICY } from '@openleaf-editor/sanitize'
 *
 * const purify = DOMPurify(window)
 * const config = configureDOMPurify(purify, DEFAULT_POLICY)
 * const clean = purify.sanitize(dirty, config)
 * ```
 *
 * Note the loss of precision, and it is worth understanding: DOMPurify's
 * `ALLOWED_ATTR` is **global**, not per element. Our policy says `start` is
 * allowed on `<ol>`; DOMPurify will allow `start` on anything it keeps. That is
 * a widening, not a hole -- no dangerous attribute is introduced -- but if
 * per-element precision matters to you, use DOMPurify's `uponSanitizeAttribute`
 * hook with `allowedAttributes()` from this package.
 *
 * ## `style` is the one where the imprecision matters
 *
 * The editor writes alignment and colour into `style`, but DOMPurify performs
 * no CSS property filtering of its own. Consequently this low-level config
 * strips `style` unless `{ styleHook: true }` is passed. Prefer
 * `configureDOMPurify()`, which installs the filter and enables the attribute
 * as one operation. The explicit flag exists for integrations that manage
 * hooks themselves.
 *
 * ## `<iframe>` is withheld unless you say the embed hook is installed
 *
 * The policy permits an iframe only when its `src` is one of a closed list of
 * player hosts, and that is a check no DOMPurify config can express:
 * `ALLOWED_URI_REGEXP` is global across every URL attribute, so narrowing it to
 * YouTube would also delete every ordinary link. Listing `iframe` in
 * `ALLOWED_TAGS` regardless would let `<iframe src="https://evil.example">`
 * through the recommended sanitizer -- a nested attacker-controlled page, which
 * is the one thing this policy exists to refuse.
 *
 * So iframes are dropped here by default. Prefer `configureDOMPurify()`, which
 * installs the host check and enables iframes atomically. `{ embedHook: true }`
 * remains available for integrations that install `embedHook(policy)` directly.
 *
 * Without the flag, stored embeds are removed rather than trusted. That is
 * content loss, and it is the safe direction of the two.
 */
/**
 * DOMPurify's own default `FORBID_CONTENTS`, transcribed.
 *
 * Transcribed rather than imported because this package deliberately does not
 * depend on DOMPurify -- it emits configuration for a sanitizer the integrator
 * installs, and half its point is to be usable by a PHP or Python shop that
 * never runs it.
 *
 * The list is the mXSS defence DOMPurify's maintainers chose: the elements
 * whose children the HTML parser re-interprets in a different context, so
 * hoisting those children out on removal is what turns inert text into markup.
 * Most of these are already in `ALLOWED_TAGS` for our policy and so are never
 * removed at all, which is exactly why carrying the whole list costs nothing.
 *
 * Source: `DEFAULT_FORBID_CONTENTS` in cure53/DOMPurify `src/purify.ts`. If a
 * later DOMPurify adds an entry, the union below is stale rather than wrong --
 * it can only forbid more content than a bare default, never less. (DOMPurify
 * 3.3+ has `ADD_FORBID_CONTENTS`, which would express this directly; it is not
 * used here because an older DOMPurify ignores an unknown key silently, and the
 * failure mode of that is `dropWithContent` quietly not applying.)
 */
const DOMPURIFY_FORBID_CONTENTS = [
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head',
  'iframe', 'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'noembed', 'noframes',
  'noscript', 'plaintext', 'script', 'selectedcontent', 'style', 'svg',
  'template', 'thead', 'title', 'video', 'xmp',
]

export function toDOMPurifyConfig(
  policy: Policy,
  options: { embedHook?: boolean; styleHook?: boolean } = {},
): DOMPurifyConfig {
  // Never-allowed attributes are filtered out of both halves. `ALLOWED_ATTR` is
  // global, so one element permitting `srcset` used to allow it on every kept
  // element for DOMPurify consumers -- and the reference enforcer refuses it.
  const attributes = new Set(carriedGlobalAttributes(policy))
  for (const element of Object.values(policy.elements)) {
    for (const attr of carriedAttributes(element)) {
      if (attr !== 'style' || options.styleHook === true) attributes.add(attr)
    }
  }

  const schemes = policy.urlSchemes.join('|')
  const relative = policy.allowRelativeUrls ? '|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$)' : ''

  const embedsChecked = options.embedHook === true
  const tags = Object.keys(policy.elements).filter((tag) => embedsChecked || tag !== 'iframe')
  const forbidden = [...policy.dropWithContent]
  if (!embedsChecked && 'iframe' in policy.elements) forbidden.push('iframe')

  return {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [...attributes],
    ALLOWED_URI_REGEXP: new RegExp(`^(?:(?:${schemes}):${relative})`, 'i'),
    FORBID_TAGS: forbidden,
    // KEEP_CONTENT unwraps unknown wrappers (a styling div) so their text
    // survives. dropWithContent is the exception: those elements and
    // everything in them must go. FORBID_CONTENTS is that exception.
    //
    // Unioned with DOMPurify's own default, never replacing it: DOMPurify
    // merges config by assignment, so returning the bare `dropWithContent` list
    // silently removed `annotation-xml`, `foreignobject`, `noembed`, `noframes`,
    // `plaintext`, `xmp` and the MathML text containers from the mXSS defence
    // its maintainers chose. Losing somebody else's hardening as a side effect
    // of naming two tags of our own is not a trade this package gets to make.
    FORBID_CONTENTS: [...new Set([...DOMPURIFY_FORBID_CONTENTS, ...forbidden])],
    // Style carries alignment and colour, but is forbidden unless the caller
    // confirms the property-filtering hook is installed.
    //
    // `on*` is not listed. DOMPurify removes event handlers unconditionally and
    // an earlier comment here claimed the list named them as belt-and-braces --
    // it did not, so the comment documented a defence that was not there. The
    // reference enforcer in sanitize.ts now carries that check for its own path;
    // here the honest statement is that this relies on DOMPurify.
    FORBID_ATTR: options.styleHook === true
      ? ['srcdoc', 'formaction', 'ping']
      : ['srcdoc', 'formaction', 'ping', 'style'],
    // `data-` attributes are not blanket-allowed: `data-` is where component
    // frameworks put behaviour, and pasted content should not get to address it.
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  }
}

/**
 * Install every hook required by the policy and return the matching config.
 *
 * This is the primary DOMPurify integration. It makes the safe setup atomic:
 * callers cannot accidentally enable style or iframe support without installing
 * the value and host checks that make those features safe.
 */
export function configureDOMPurify(
  purify: DOMPurifyHooks,
  policy: Policy,
): DOMPurifyConfig {
  purify.addHook('uponSanitizeAttribute', styleAttributeHook(policy))
  const embeds = 'iframe' in policy.elements
  if (embeds) purify.addHook('uponSanitizeElement', embedHook(policy))
  return toDOMPurifyConfig(policy, { styleHook: true, embedHook: embeds })
}

/** What DOMPurify hands an `uponSanitizeAttribute` hook. */
export interface DOMPurifyAttributeEvent {
  attrName: string
  attrValue: string
  keepAttr: boolean
  forceKeepAttr?: boolean | undefined
}

/**
 * A DOMPurify hook that filters `style` per element, the way the policy says.
 *
 * Restores the precision `ALLOWED_ATTR` cannot express: the element decides which
 * declarations may appear, and every value is checked. Attributes other than
 * `style` are left exactly as DOMPurify found them, so installing this cannot
 * widen anything else.
 *
 * `forceKeepAttr` is set on a surviving `style`, which is what lets the hook
 * decide the outcome even for an attribute a config forbids -- so a policy that
 * allows no style properties at all keeps working, and this hook is safe to
 * install on any config.
 */
export function styleAttributeHook(
  policy: Policy,
): (node: Element, data: DOMPurifyAttributeEvent) => void {
  return (node, data) => {
    if (data.attrName !== 'style') return
    const kept = filterStyle(data.attrValue, allowedStyleProperties(policy, node.nodeName))
    if (kept === null) {
      data.keepAttr = false
      data.forceKeepAttr = false
      return
    }
    data.attrValue = kept
    data.keepAttr = true
    data.forceKeepAttr = true
  }
}

/** The one-line reminder, for a generator emitting setup code. */
export function styleValidationNote(policy: Policy): string {
  const properties = allStyleProperties(policy.elements)
  if (properties.length === 0) return 'This policy permits no style declarations.'
  return (
    `This policy permits ${properties.join(', ')} inside a style attribute. ` +
    'Install styleAttributeHook() as an uponSanitizeAttribute hook, or DOMPurify ' +
    'will allow any declaration at all on any element it keeps.'
  )
}

/**
 * A DOMPurify hook that enforces the embed rules `ALLOWED_TAGS` cannot.
 *
 * Install as `uponSanitizeElement`, and pass `{ embedHook: true }` to
 * `toDOMPurifyConfig` so the element is allowed through to it. An iframe whose
 * `src` is not an allowlisted player host is removed outright rather than left
 * behind with the attribute stripped: an empty nested browsing context is not
 * content anybody asked for.
 *
 * `allow` is filtered on the survivors. An allowlisted host is not enough on its
 * own -- `allow` is how a frame asks to step outside the restrictions the rest of
 * the page lives under, so a permitted player URL carrying
 * `allow="camera; microphone"` would still be handed the camera.
 */
export function embedHook(policy: Policy): (node: Element) => void {
  const checked = 'iframe' in policy.elements
  return (node) => {
    if (!checked) return
    if (typeof node.nodeName !== 'string' || node.nodeName.toLowerCase() !== 'iframe') return
    if (!isAllowedEmbedSrc(node.getAttribute?.('src'))) {
      node.parentNode?.removeChild(node)
      return
    }
    if (!node.hasAttribute?.('allow')) return
    const kept = safeAllowList(node.getAttribute('allow'))
    if (kept === null) node.removeAttribute('allow')
    else if (kept !== node.getAttribute('allow')) node.setAttribute('allow', kept)
  }
}

/** The one-line reminder about embeds, for a generator emitting setup code. */
export function embedValidationNote(policy: Policy): string {
  if (!('iframe' in policy.elements)) return 'This policy permits no iframes.'
  return (
    `This policy permits iframes only from ${EMBED_HOSTS.map((r) => r.host).join(', ')}. ` +
    'No DOMPurify config can express a per-element host allowlist, so install ' +
    'embedHook() as an uponSanitizeElement hook and pass { embedHook: true } to ' +
    'toDOMPurifyConfig -- or leave both off and have stored embeds removed.'
  )
}

/**
 * One regular expression matching every permitted embed URL.
 *
 * For the sanitizers that can take one: HTMLPurifier's `URI.SafeIframeRegexp` is
 * exactly this shape, and it is the only way to state the host allowlist in
 * configuration rather than in code. Written to be valid in PCRE and Python's
 * `re` as well as JavaScript, since all three consume it.
 */
export function embedSrcPattern(): string {
  const alternatives = EMBED_HOSTS.map((rule) => {
    const host = rule.host.replace(/\./g, '\\.')
    // A host rule with no path permits the whole host, but the match still has to
    // end at a URL boundary so `player.twitch.tv.evil.example` cannot pass.
    // `\/` is a JavaScript regexp-literal habit and means nothing to PCRE or
    // Python. Normalised out so one string reads correctly in all three.
    const path = rule.path ? rule.path.source.replace(/^\^/, '').replace(/\\\//g, '/') : '(?:[/?#]|$)'
    return `${host}${path}`
  })
  return `^https://(?:www\\.)?(?:${alternatives.join('|')})`
}

/* ------------------------------------------------------------------ *
 * bleach (Python)
 * ------------------------------------------------------------------ */

/**
 * A Python source snippet configuring `bleach`.
 *
 * Emitted as source rather than JSON because bleach takes a dict of
 * tag -> attribute list, which maps onto our policy exactly -- unlike
 * DOMPurify, this one keeps the per-element precision.
 *
 * ```python
 * import bleach
 * from bleach.css_sanitizer import CSSSanitizer
 * from openleaf_policy import (ALLOWED_TAGS, ALLOWED_ATTRIBUTES,
 *                              ALLOWED_PROTOCOLS, ALLOWED_CSS_PROPERTIES)
 *
 * clean = bleach.clean(dirty, tags=ALLOWED_TAGS,
 *                      attributes=ALLOWED_ATTRIBUTES,
 *                      protocols=ALLOWED_PROTOCOLS,
 *                      css_sanitizer=CSSSanitizer(
 *                          allowed_css_properties=ALLOWED_CSS_PROPERTIES),
 *                      strip=True)
 * ```
 *
 * bleach's CSS sanitizer is property-level, not per element and not value-level:
 * it will allow `text-align` on a `<span>` and any value tinycss2 parses. That is
 * a widening in the same direction as DOMPurify's global attributes. It does drop
 * `url(` and `expression(`, which are the parts that matter.
 *
 * Iframes need the emitted `filter_embeds` pre-pass. bleach can allow the element
 * and its `src` attribute but cannot say which hosts, so config alone would keep
 * `<iframe src="https://evil.example">`.
 */
export function toBleachConfig(policy: Policy): string {
  const tags = Object.keys(policy.elements)
  const lines: string[] = [
    '# Generated from @openleaf-editor/sanitize. Do not edit by hand -- regenerate.',
    `# policy version ${policy.version}`,
    '',
    'ALLOWED_TAGS = [',
    ...tags.map((t) => `    ${JSON.stringify(t)},`),
    ']',
    '',
    'ALLOWED_ATTRIBUTES = {',
  ]

  const globals = carriedGlobalAttributes(policy)
  if (globals.length > 0) {
    lines.push(`    "*": [${globals.map((a) => JSON.stringify(a)).join(', ')}],`)
  }
  for (const [tag, element] of Object.entries(policy.elements)) {
    const attrs = carriedAttributes(element)
    if (attrs.length === 0) continue
    lines.push(`    ${JSON.stringify(tag)}: [${attrs.map((a) => JSON.stringify(a)).join(', ')}],`)
  }

  lines.push(
    '}',
    '',
    `ALLOWED_PROTOCOLS = [${policy.urlSchemes.map((s) => JSON.stringify(s)).join(', ')}]`,
    '',
    '# Without css_sanitizer=CSSSanitizer(allowed_css_properties=ALLOWED_CSS_PROPERTIES),',
    '# bleach strips every style attribute -- which deletes the alignment and colour',
    '# out of content the editor legitimately produced.',
    `ALLOWED_CSS_PROPERTIES = [${allStyleProperties(policy.elements)
      .map((p) => JSON.stringify(p))
      .join(', ')}]`,
    '',
    `DROP_WITH_CONTENT = [${policy.dropWithContent.map((t) => JSON.stringify(t)).join(', ')}]`,
    '',
    '# bleach.clean(strip=True) unwraps unknown tags and keeps their text, which',
    '# is right for a styling wrapper. dropWithContent is the exception: the',
    '# element AND its descendants must go, and bleach has no option for that.',
    '# Run this before bleach.clean.',
    '#',
    '# It has to be a real parser. A regex pre-pass looks equivalent and is not:',
    '# deleting the inner "<form></form>" from "<for<form></form>m action=x>"',
    '# leaves "<form action=x>", so the pass invents the tag it exists to',
    '# delete. It also walks straight past "</form >" and past an unclosed tag.',
    '#',
    '#     pip install beautifulsoup4 html5lib',
    '#',
    '# html5lib by name, because it is the parser bleach itself uses: any other',
    '# leaves this pass and clean() disagreeing about where an element ends.',
    'def drop_with_content(html, tags=DROP_WITH_CONTENT):',
    '    from bs4 import BeautifulSoup',
    '    soup = BeautifulSoup(html, "html5lib")',
    '    for element in soup.find_all(tags):',
    '        element.decompose()',
    '    body = soup.body',
    '    return body.decode_contents() if body is not None else soup.decode()',
    '',
    'STRIP_DISALLOWED = True',
    '',
  )

  if ('iframe' in policy.elements) {
    lines.push(
      '# Embeds. bleach can allow <iframe> and its src, but not say which hosts,',
      '# so configuration alone would keep <iframe src="https://evil.example">:',
      '# a nested attacker-controlled page. Run this pre-pass as well as',
      '# drop_with_content, before bleach.clean.',
      // A raw string, deliberately: JSON-escaping the backslashes would make
      // Python read `\.` as an escaped backslash followed by any character.
      `ALLOWED_IFRAME_SRC = r'${embedSrcPattern()}'`,
      '',
      '# `allow` is how a frame asks to step outside the restrictions the rest of',
      '# the page lives under, so an allowlisted host is not enough on its own.',
      '# Only the feature name is kept, which leaves the default origin allowlist',
      '# -- the frame itself -- so "camera *" narrows instead of being stored.',
      `ALLOWED_IFRAME_ALLOW_TOKENS = [${EMBED_ALLOW_TOKENS.map((t) => JSON.stringify(t)).join(', ')}]`,
      '',
      'def filter_embeds(html, pattern=ALLOWED_IFRAME_SRC,',
      '                  tokens=ALLOWED_IFRAME_ALLOW_TOKENS):',
      '    import re',
      '    from bs4 import BeautifulSoup',
      '    soup = BeautifulSoup(html, "html5lib")',
      '    for frame in soup.find_all("iframe"):',
      '        if not re.match(pattern, frame.get("src") or "", re.I):',
      '            frame.decompose()',
      '            continue',
      '        raw = frame.get("allow")',
      '        if raw is None:',
      '            continue',
      '        kept, seen = [], set()',
      '        for directive in raw.split(";"):',
      '            name = directive.strip().split(" ")[0].lower()',
      '            if name in tokens and name not in seen:',
      '                seen.add(name)',
      '                kept.append(name)',
      '        if kept:',
      '            frame["allow"] = "; ".join(kept)',
      '        else:',
      '            del frame["allow"]',
      '    body = soup.body',
      '    return body.decode_contents() if body is not None else soup.decode()',
      '',
    )
  }

  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * HTMLPurifier (PHP)
 * ------------------------------------------------------------------ */

/**
 * A PHP source snippet configuring HTMLPurifier.
 *
 * HTMLPurifier expresses an allowlist as a single `HTML.Allowed` string of
 * `tag[attr1|attr2]` entries, which preserves per-element precision.
 *
 * ```php
 * require_once 'openleaf_policy.php';
 * $clean = openleaf_purifier()->purify($dirty);
 * ```
 *
 * HTMLPurifier is the one target that can state the embed host allowlist in
 * configuration: `HTML.SafeIframe` plus `URI.SafeIframeRegexp` is exactly this
 * policy's iframe rule. Note it strips `allow` -- it has no definition for the
 * attribute -- so embeds survive without their permissions rather than with too
 * many, which is the safe direction.
 */
export function toHtmlPurifierConfig(policy: Policy): string {
  const allowed = Object.entries(policy.elements)
    .map(([tag, element]) => {
      const attrs = [...carriedGlobalAttributes(policy), ...carriedAttributes(element)]
      return attrs.length > 0 ? `${tag}[${attrs.join('|')}]` : tag
    })
    .join(',')

  return `<?php
// Generated from @openleaf-editor/sanitize. Do not edit by hand -- regenerate.
// policy version ${policy.version}

function openleaf_purifier(): HTMLPurifier {
    $config = HTMLPurifier_Config::createDefault();
    $config->set('HTML.Allowed', ${JSON.stringify(allowed)});
    $config->set('URI.AllowedSchemes', [
${policy.urlSchemes.map((s) => `        ${JSON.stringify(s)} => true,`).join('\n')}
    ]);
    // Relative URLs are ${policy.allowRelativeUrls ? 'permitted' : 'rejected'}.
    $config->set('URI.DisableExternalResources', false);${policy.allowRelativeUrls ? '' : `
    // HTMLPurifier has no first-class relative-URL switch. A custom URI filter
    // that rejects scheme-less values must be registered by the integrator.`}
    $config->set('CSS.AllowedProperties', [
${allStyleProperties(policy.elements).map((p) => `        ${JSON.stringify(p)} => true,`).join('\n')}
    ]);
    $config->set('Attr.AllowedFrameTargets', ['_blank', '_self', '_parent', '_top']);${
    'iframe' in policy.elements
      ? `
    // Without both of these HTMLPurifier drops every iframe, and listing the
    // element in HTML.Allowed without the regexp would trust any src at all.
    $config->set('HTML.SafeIframe', true);
    // Single-quoted, so PHP leaves both the backslashes and the dollar sign
    // in the pattern alone -- a double-quoted string would not promise that.
    $config->set('URI.SafeIframeRegexp', '%${embedSrcPattern()}%i');`
      : ''
  }
    // HTMLPurifier adds rel="noreferrer" to target=_blank links itself.
    $config->set('HTML.TargetNoreferrer', true);
    $config->set('HTML.TargetNoopener', true);
    return new HTMLPurifier($config);
}
`
}
