/**
 * Load content CSS so the canvas matches the published site.
 *
 * OpenLeaf has no iframe. Host typography already inherits into the document,
 * which is the point of skipping Shadow DOM. This helper is for an extra
 * stylesheet the published template uses -- a CMS "styles.css" -- that is not
 * on the admin page. Selectors are scoped under the editor canvas so a rule
 * written for `p.lead` cannot restyle the rest of the admin chrome.
 *
 * ## Why this is a scanner and not a regex
 *
 * It used to be one `String.replace`, matching a selector only where it was
 * preceded by the start of the input or a `}`. A rule inside `@media` is
 * preceded by the media block's `{`, so it never matched and shipped
 * **unscoped** into the host page -- and nearly every real stylesheet uses
 * media queries, so that was the common case rather than an edge case. The same
 * pass split selector lists on every `,`, which turned `a:is(.b, .c)` into an
 * invalid selector the browser drops on the floor.
 *
 * ## Why not CSSOM
 *
 * `new CSSStyleSheet()` + `replaceSync` would parse this properly and is the
 * obvious answer. It is not available everywhere this function has to run:
 * jsdom implements `CSSStyleSheet` without `replaceSync`, and this module is
 * imported by code that runs server-side. A scoper that throws outside a
 * browser is a scoper the tests cannot cover, so the parsing is done here.
 */

const SCOPE = '.ol-editor .ol-content .ProseMirror'

/**
 * At-rules whose block is NOT a selector list. Everything else is descended into.
 *
 * A denylist rather than an allowlist, and the direction matters: the two ways
 * of being wrong are not symmetric. Failing to descend into a rule-bearing
 * at-rule ships its selectors UNSCOPED into the host page, which is the leak
 * this whole function exists to prevent. Descending into a declaration block
 * that merely looks like one costs nothing -- it has no inner blocks to rewrite,
 * so its declarations pass through as they are. An allowlist means every at-rule
 * CSS gains is a leak until somebody remembers to add it, which
 * `@starting-style` had already demonstrated.
 *
 * `@keyframes` is why this list is not empty: `from`, `to` and `0%` are offsets,
 * not selectors, and prefixing one with a class produces an offset that matches
 * nothing and silently kills the animation.
 */
const OPAQUE_AT_RULES = new Set([
  'keyframes', '-webkit-keyframes', '-moz-keyframes', '-o-keyframes',
  'font-face', 'font-feature-values', 'font-palette-values',
  'page', 'property', 'counter-style', 'color-profile', 'position-try', 'viewport',
])

/** Index just past the string literal starting at `start`. */
function endOfString(css: string, start: number): number {
  const quote = css[start]
  let i = start + 1
  while (i < css.length) {
    const ch = css[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return css.length
}

/** Index just past the comment starting at `start`. */
function endOfComment(css: string, start: number): number {
  const end = css.indexOf('*/', start + 2)
  return end === -1 ? css.length : end + 2
}

/** Index of the `}` matching the `{` at `open`, or -1 if there is none. */
function matchingBrace(css: string, open: number): number {
  let depth = 0
  let i = open
  while (i < css.length) {
    const ch = css[i]
    // A backslash escape can carry any character, brace and semicolon included:
    // `.foo\{bar` is one valid class name, not the start of a block.
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '/' && css[i + 1] === '*') {
      i = endOfComment(css, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      i = endOfString(css, i)
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

/**
 * Leading whitespace and comments, split off so they are emitted BEFORE the
 * rule rather than swept into its first selector.
 */
function splitLeading(prelude: string): [string, string] {
  let i = 0
  for (;;) {
    while (i < prelude.length && /\s/.test(prelude[i] ?? '')) i += 1
    if (prelude.startsWith('/*', i)) {
      i = endOfComment(prelude, i)
      continue
    }
    break
  }
  return [prelude.slice(0, i), prelude.slice(i)]
}

/**
 * Split a selector list on its top-level commas only.
 *
 * The commas inside `:is()`, `:where()`, `:has()` and `:not()` belong to the
 * function, and splitting on them is what produced
 * `a:is(.b, SCOPE .c)` -- an invalid selector whose rule the browser drops.
 * Attribute values are skipped for the same reason: `[title="a,b"]`.
 */
function splitSelectorList(selectors: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < selectors.length) {
    const ch = selectors[i]
    // `.foo\,bar` is one class name whose name contains a comma.
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '/' && selectors[i + 1] === '*') {
      i = endOfComment(selectors, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      i = endOfString(selectors, i)
      continue
    }
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      parts.push(selectors.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  parts.push(selectors.slice(start))
  return parts
}

function scopeSelectorList(selectors: string): string {
  return splitSelectorList(selectors)
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return part
      // Already scoped by the author. Left exactly as written, because a
      // stylesheet that names the canvas is talking about the canvas.
      if (trimmed.startsWith('.ol-editor') || trimmed.startsWith('.ol-content')) return trimmed
      return `${SCOPE} ${trimmed}`
    })
    .join(', ')
}

function scopeRules(css: string): string {
  let out = ''
  let prelude = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    // Escapes first, so `.foo\;bar` is one class name rather than a statement
    // that ends mid-selector -- which split the rule and left both halves
    // matching nothing.
    if (ch === '\\') {
      prelude += css.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '/' && css[i + 1] === '*') {
      const stop = endOfComment(css, i)
      prelude += css.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '"' || ch === "'") {
      const stop = endOfString(css, i)
      prelude += css.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '{') {
      const close = matchingBrace(css, i)
      if (close === -1) {
        // Unbalanced. Emitting the remainder verbatim is the honest failure: a
        // truncated stylesheet is the integrator's to fix, and half-scoping it
        // would make the result harder to recognise than leaving it alone.
        return out + prelude + css.slice(i)
      }
      const [leading, rule] = splitLeading(prelude)
      const body = css.slice(i + 1, close)
      out += leading
      if (rule.startsWith('@')) {
        const name = /^@(-?[\w-]+)/.exec(rule)?.[1]?.toLowerCase() ?? ''
        // Descended into unless its block is known not to hold rules.
        out += `${rule}{${OPAQUE_AT_RULES.has(name) ? body : scopeRules(body)}}`
      } else {
        // The body is NOT recursed into. A rule nested inside a style rule is
        // relative to its parent, which this has already scoped -- scoping it
        // again would put the canvas prefix in twice.
        out += `${scopeSelectorList(rule)}{${body}}`
      }
      prelude = ''
      i = close + 1
      continue
    }
    if (ch === ';') {
      // A statement at-rule: @import, @charset, @namespace, `@layer a, b;`.
      // None of them carries a selector.
      out += prelude + ';'
      prelude = ''
      i += 1
      continue
    }
    prelude += ch
    i += 1
  }
  // Trailing whitespace, or a selector with no block. Kept as found.
  return out + prelude
}

export function scopeContentCss(css: string): string {
  return scopeRules(css)
}

export async function loadContentCss(doc: Document, urls: readonly string[]): Promise<void> {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in Document.prototype)) {
    console.warn(
      '@openleaf-editor/ui: content CSS could not be adopted in this browser. ' +
        'Link the published stylesheet on the host page instead.',
    )
    return
  }
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const css = scopeContentCss(await response.text())
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    } catch (error) {
      console.warn(
        `@openleaf-editor/ui: content CSS at "${url}" could not be loaded.`,
        error,
      )
    }
  }
}

export function contentCssUrls(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[, ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}
