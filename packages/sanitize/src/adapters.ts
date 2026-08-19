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
import { allowedStyleProperties, type Policy } from './policy.js'

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

/**
 * Configuration for DOMPurify.
 *
 * ```js
 * import DOMPurify from 'dompurify'
 * import { DEFAULT_POLICY, toDOMPurifyConfig } from '@openleaf-editor/sanitize'
 *
 * const clean = DOMPurify.sanitize(dirty, toDOMPurifyConfig(DEFAULT_POLICY))
 * ```
 *
 * Note the loss of precision, and it is worth understanding: DOMPurify's
 * `ALLOWED_ATTR` is **global**, not per element. Our policy says `start` is
 * allowed on `<ol>`; DOMPurify will allow `start` on anything it keeps. That is
 * a widening, not a hole -- no dangerous attribute is introduced -- but if
 * per-element precision matters to you, use DOMPurify's `uponSanitizeAttribute`
 * hook with `allowedAttributes()` from this package.
 *
 * ## `style` is the one where the imprecision matters -- install the hook
 *
 * `style` has to be allowed, because the editor writes `text-align` and colour
 * into it and a config that strips it deletes the alignment from every document
 * it touches. But a GLOBAL `style` allowance is not the same kind of widening as
 * a stray `start`: DOMPurify performs no CSS property filtering of its own, so
 * without the hook below, stored content may carry
 * `style="position:fixed;inset:0"` -- an overlay covering the page with something
 * that looks like your UI.
 *
 * ```js
 * const purify = DOMPurify(window)
 * purify.addHook('uponSanitizeAttribute', styleAttributeHook(DEFAULT_POLICY))
 * const clean = purify.sanitize(dirty, toDOMPurifyConfig(DEFAULT_POLICY))
 * ```
 *
 * `styleValidationNote(policy)` returns that instruction as a string, for a
 * generator that emits setup code rather than calling this itself.
 */
export function toDOMPurifyConfig(policy: Policy): DOMPurifyConfig {
  const attributes = new Set(policy.globalAttributes)
  for (const element of Object.values(policy.elements)) {
    for (const attr of element.attributes ?? []) attributes.add(attr)
  }

  const schemes = policy.urlSchemes.join('|')
  const relative = policy.allowRelativeUrls ? '|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$)' : ''

  return {
    ALLOWED_TAGS: Object.keys(policy.elements),
    ALLOWED_ATTR: [...attributes],
    ALLOWED_URI_REGEXP: new RegExp(`^(?:(?:${schemes}):${relative})`, 'i'),
    FORBID_TAGS: [...policy.dropWithContent],
    // KEEP_CONTENT unwraps unknown wrappers (a styling div) so their text
    // survives. dropWithContent is the exception: those elements and
    // everything in them must go. FORBID_CONTENTS is that exception.
    FORBID_CONTENTS: [...policy.dropWithContent],
    // `on*` handlers are removed by DOMPurify unconditionally; naming them here
    // documents the intent and survives a future config change.
    // `style` is NOT forbidden here, unlike every other version of this list you
    // will have seen. It is what carries alignment and colour, and the property
    // filtering is delegated to styleAttributeHook -- which you must install.
    FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
    // `data-` attributes are not blanket-allowed: `data-` is where component
    // frameworks put behaviour, and pasted content should not get to address it.
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  }
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

  if (policy.globalAttributes.length > 0) {
    lines.push(`    "*": [${policy.globalAttributes.map((a) => JSON.stringify(a)).join(', ')}],`)
  }
  for (const [tag, element] of Object.entries(policy.elements)) {
    const attrs = element.attributes ?? []
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
 */
export function toHtmlPurifierConfig(policy: Policy): string {
  const allowed = Object.entries(policy.elements)
    .map(([tag, element]) => {
      const attrs = [...policy.globalAttributes, ...(element.attributes ?? [])]
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
    $config->set('Attr.AllowedFrameTargets', ['_blank', '_self', '_parent', '_top']);
    // HTMLPurifier adds rel="noreferrer" to target=_blank links itself.
    $config->set('HTML.TargetNoreferrer', true);
    $config->set('HTML.TargetNoopener', true);
    return new HTMLPurifier($config);
}
`
}
