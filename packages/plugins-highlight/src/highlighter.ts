/**
 * The highlighter seam.
 *
 * ## Why this is pluggable rather than fixed
 *
 * Measured, not guessed:
 *
 *   built-in tokenizer (html/css/js)   1.9 KB gzip    0 dependencies
 *   refractor + 3 languages           14.0 KB gzip   19 dependencies
 *
 * Seven times the size, for roughly three hundred languages instead of three.
 * Neither number is obviously right, because the two use cases have different
 * needs and pretending otherwise is how you get a bad default:
 *
 *   - The **source view** shows the editor's own HTML output. The grammar is
 *     simple, the input is well-formed because we produced it, and three
 *     languages is not a compromise -- it is the complete set.
 *   - A **code block** can contain anything. Shipping three languages and
 *     calling it syntax highlighting is a poor experience for somebody writing
 *     Python, and no amount of care in the built-in tokenizer fixes that.
 *
 * So the default is small and honest about its coverage, and the seam is public
 * so a project that needs real breadth can supply Prism, refractor or
 * highlight.js in about five lines. This is the same shape as
 * `@openleaf/sanitize`, which ships a policy and lets you enforce it with
 * DOMPurify: the valuable thing is the integration point, not a reimplementation
 * of somebody else's decade of work.
 */

import { resolveLanguage, tokenize, type Token } from './tokenize.js'

/**
 * A highlighter turns source text into a flat token list.
 *
 * Flat rather than a tree because ProseMirror decorations and the source-view
 * overlay both want ranges, and flattening a tree is easier than inventing one.
 * Returning `null` means "I do not know this language" -- the caller then leaves
 * the text unhighlighted rather than guessing, which is the correct failure.
 */
export type Highlighter = (source: string, language: string) => Token[] | null

/** Languages the built-in tokenizer covers. */
export { SUPPORTED_LANGUAGES } from './tokenize.js'

const builtIn: Highlighter = (source, language) => {
  const resolved = resolveLanguage(language)
  return resolved ? tokenize(source, resolved) : null
}

let current: Highlighter = builtIn

/**
 * Replace the highlighter.
 *
 * ```ts
 * import { refractor } from 'refractor/core'
 * import python from 'refractor/python'
 * import { setHighlighter, type Token } from '@openleaf/plugins-highlight'
 *
 * refractor.register(python)
 *
 * setHighlighter((source, language) => {
 *   if (!refractor.registered(language)) return null
 *   const flat: Token[] = []
 *   const walk = (nodes, inherited) => {
 *     for (const node of nodes) {
 *       if (node.type === 'text') flat.push({ type: inherited, value: node.value })
 *       else walk(node.children, node.properties.className?.[1] ?? inherited)
 *     }
 *   }
 *   walk(refractor.highlight(source, language).children, 'text')
 *   return flat
 * })
 * ```
 *
 * Returns a function restoring the previous highlighter, so a test or a
 * conditional integration can put it back.
 */
export function setHighlighter(highlighter: Highlighter): () => void {
  const previous = current
  current = highlighter
  return () => {
    current = previous
  }
}

/** The active highlighter. */
export function highlight(source: string, language: string): Token[] | null {
  try {
    return current(source, language)
  } catch (error) {
    // A third-party highlighter that throws must not take the editor with it.
    // Unhighlighted text is a cosmetic loss; a broken source view is not.
    console.error(
      `@openleaf/plugins-highlight: the highlighter threw on language "${language}". ` +
        'The text is shown unhighlighted.',
      error,
    )
    return null
  }
}

/** True when something will highlight this language. */
export function canHighlight(language: string | null | undefined): boolean {
  if (!language) return false
  return highlight('', language) !== null
}

export type { Token, TokenType } from './tokenize.js'
