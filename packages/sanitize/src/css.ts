/**
 * The CSS the policy permits, restated.
 *
 * ## Why this is a copy of core's css.ts and not an import
 *
 * It is the same duplication the element and attribute lists already are, made
 * for the same reason and guarded the same way. This package exists so that a
 * PHP request handler, a Python worker and a Node server can all enforce one
 * policy; a server that only needs the policy must not have to install the
 * editor, and `@openleaf-editor/core` brings ProseMirror with it. That is why
 * core is a devDependency here and not a dependency.
 *
 * So the vocabulary is restated, and `test/agreement.test.ts` -- which CAN import
 * core, being a test -- asserts value by value that the two agree. A copy with a
 * test pinning it is a maintenance cost. A copy without one is the drift this
 * package was written to prevent.
 */

/** Alignment keywords. `start` and `end` are resolved by the editor, not here. */
const ALIGN = new Set(['left', 'center', 'right', 'justify', 'start', 'end'])

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNCTIONAL = /^(?:rgba?|hsla?)\(\s*[0-9a-z\s.,%/+-]+\)$/i
const KEYWORD = /^[a-z]{3,24}$/i

/** How a declaration's value is checked, by property. */
const CHECKS: Record<string, (value: string) => boolean> = {
  'text-align': (value) => ALIGN.has(value.toLowerCase()),
  color: isColor,
  'background-color': isColor,
}

function isColor(value: string): boolean {
  const candidate = value.trim().replace(/\s+/g, ' ')
  return HEX.test(candidate) || FUNCTIONAL.test(candidate) || KEYWORD.test(candidate)
}

/** Is this declaration permitted at all, and is its value one we recognise? */
export function isAllowedDeclaration(property: string, value: string): boolean {
  const check = CHECKS[property.toLowerCase()]
  return check ? check(value) : false
}

/**
 * Filter a `style` attribute down to the declarations a policy permits.
 *
 * Returns null when nothing survives, so the caller removes the attribute rather
 * than leaving `style=""` on every paragraph in the document.
 *
 * **Returns the original string, character for character, when nothing needs
 * removing.** That is not an optimisation. `text-align: center;` and
 * `text-align:center` are the same declaration, and a filter that rebuilt the
 * attribute from its parsed pieces would rewrite the first into the second --
 * changing the stored bytes of every aligned paragraph in an archive the first
 * time it passed through the server, for no benefit. A sanitizer should be a
 * no-op on content that is already acceptable.
 *
 * The parse is a split on `;` and `:`, which is sufficient *because* of what
 * follows it: every value is then matched against a pattern that admits no
 * quotes, no semicolons, no parentheses except in a colour function, and no
 * `url(`. A value that could survive being mis-parsed cannot survive the check.
 */
export function filterStyle(style: string, permitted: ReadonlySet<string>): string | null {
  const kept: string[] = []
  let dropped = false

  for (const part of style.split(';')) {
    // A trailing `;` leaves an empty part, which is not a dropped declaration.
    if (part.trim() === '') continue
    const colon = part.indexOf(':')
    const property = colon < 0 ? '' : part.slice(0, colon).trim().toLowerCase()
    const value = colon < 0 ? '' : part.slice(colon + 1).trim()

    if (property === '' || value === '' || !permitted.has(property)) {
      dropped = true
      continue
    }
    if (!isAllowedDeclaration(property, value)) {
      dropped = true
      continue
    }
    // The raw text, so an author's spacing survives when nothing else changes.
    kept.push(part.trim())
  }

  if (kept.length === 0) return null
  return dropped ? kept.join(';') : style
}

/** Every CSS property any element may carry under a policy. For the adapters. */
export function allStyleProperties(elements: Record<string, { styleProperties?: string[] }>): string[] {
  const out = new Set<string>()
  for (const element of Object.values(elements)) {
    for (const property of element.styleProperties ?? []) out.add(property)
  }
  return [...out]
}
