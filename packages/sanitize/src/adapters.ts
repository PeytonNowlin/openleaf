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

import type { Policy } from './policy.js'

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
 * import { DEFAULT_POLICY, toDOMPurifyConfig } from '@openleaf/sanitize'
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
    FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'ping'],
    // `data-` attributes are not blanket-allowed: `data-` is where component
    // frameworks put behaviour, and pasted content should not get to address it.
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  }
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
 * from openleaf_policy import ALLOWED_TAGS, ALLOWED_ATTRIBUTES, ALLOWED_PROTOCOLS
 *
 * clean = bleach.clean(dirty, tags=ALLOWED_TAGS,
 *                      attributes=ALLOWED_ATTRIBUTES,
 *                      protocols=ALLOWED_PROTOCOLS, strip=True)
 * ```
 */
export function toBleachConfig(policy: Policy): string {
  const tags = Object.keys(policy.elements)
  const lines: string[] = [
    '# Generated from @openleaf/sanitize. Do not edit by hand -- regenerate.',
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
    `DROP_WITH_CONTENT = [${policy.dropWithContent.map((t) => JSON.stringify(t)).join(', ')}]`,
    '',
    '# bleach.clean(strip=True) unwraps unknown tags and keeps their text, which',
    '# is right for a styling wrapper. dropWithContent is the exception: the',
    '# element AND its descendants must go. Run this before bleach.clean.',
    'def drop_with_content(html, tags=DROP_WITH_CONTENT):',
    '    import re',
    '    for tag in tags:',
    "        html = re.sub(rf'<{re.escape(tag)}\\b[^>]*>.*?</{re.escape(tag)}>', '', html, flags=re.IGNORECASE | re.DOTALL)",
    "        html = re.sub(rf'<{re.escape(tag)}\\b[^>]*/>', '', html, flags=re.IGNORECASE)",
    '    return html',
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
// Generated from @openleaf/sanitize. Do not edit by hand -- regenerate.
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
    $config->set('Attr.AllowedFrameTargets', ['_blank', '_self', '_parent', '_top']);
    // HTMLPurifier adds rel="noreferrer" to target=_blank links itself.
    $config->set('HTML.TargetNoreferrer', true);
    $config->set('HTML.TargetNoopener', true);
    return new HTMLPurifier($config);
}
`
}
