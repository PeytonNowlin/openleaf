/**
 * Elements that go, and take their contents with them.
 *
 * This list existed twice: once in `@openleaf-editor/core` as `NEVER_PRESERVE`,
 * the denylist the preservation layer consults before it claims a subtree, and
 * once in `@openleaf-editor/sanitize` as the policy's `dropWithContent`. The two
 * were believed to be the same list. They were not, and every place they
 * disagreed was exploitable: `<svg>` and `<math>` were on the sanitizer's list
 * and not on the editor's, so the editor happily stored the namespace-confusion
 * markup the sanitizer existed to remove.
 *
 * Both now spread this constant, so the lists can no longer be edited
 * separately. Core adds a small number of entries of its own -- a denylist
 * guarding an editor that preserves markup verbatim has to be at least as
 * strict as one guarding a server-side allowlist, never less.
 *
 * `<iframe>` is deliberately absent. The editor models allowlisted player
 * embeds as a real node, and the sanitizer permits that element for hosts on a
 * closed list, so dropping every iframe here would delete legitimate embeds.
 * Core still refuses to *preserve* one, which is a different question and is
 * answered in `preserve.ts`.
 *
 * Removed with contents rather than unwrapped: unwrapping
 * `<script>alert(1)</script>` leaves the literal text "alert(1)" in the
 * document, which is a different kind of wrong.
 */
export const DROP_WITH_CONTENT: readonly string[] = [
  'script',
  'style',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
  // Foreign namespaces. SVG and MathML have their own parsing rules, their own
  // spelling of `href`, and SMIL, which can rewrite an attribute after every
  // static check has already read it. Namespace confusion is where mutation XSS
  // lives, and neither namespace is markup an author is editing here.
  'svg',
  'math',
  // Raw-text elements. Their contents are text to the parser and markup to a
  // renderer, so anything that round-trips one hands back an unescaped payload.
  // `<plaintext>` has no end tag at all: emitting a `</plaintext>` the next
  // parse cannot consume made the document grow on every save, without bound.
  'plaintext',
  'xmp',
  'noembed',
  'noframes',
]
