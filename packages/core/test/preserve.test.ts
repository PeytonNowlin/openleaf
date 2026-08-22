import { DOMSerializer, type Node as PMNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import { baseSchema, isInsidePreserved, parseHtml, roundTrip } from '../src/index.js'

/**
 * `isInsidePreserved` is the guard a plugin needs, and until now could not get.
 *
 * The authoring guide told plugin authors to import a `PRESERVED_MARKER`
 * constant and match on a `data-ol-preserved` attribute. Neither has existed
 * since the marker became a WeakSet -- an attribute marker could not tell the
 * one it had just written from the same attribute occurring in a customer's
 * document, and deleted the customer's. So the documented guard did not
 * compile, and an author who worked around it by hard-coding the attribute got
 * a predicate that is always false.
 *
 * The predicate is the supported answer, so it is exported and pinned here.
 */

/** Render a node's `toDOM` the way the view and the serializer both do. */
function render(node: PMNode): Element {
  const spec = node.type.spec.toDOM
  if (!spec) throw new Error(`${node.type.name} has no toDOM`)
  const out = spec(node)
  if (!(out instanceof Element)) throw new Error('expected an element')
  return out
}

function firstOfType(doc: PMNode, name: string): PMNode {
  let found: PMNode | null = null
  doc.descendants((child) => {
    if (found) return false
    if (child.type.name === name) found = child
    return !found
  })
  if (!found) throw new Error(`no ${name} in the document`)
  return found
}

describe('isInsidePreserved', () => {
  it('is true for an element rebuilt from preserved markup', () => {
    const doc = parseHtml('<div class="legacy"><p>kept</p></div>')
    const el = render(firstOfType(doc, 'unknown_block'))
    expect(isInsidePreserved(el)).toBe(true)
  })

  it('is true for a descendant of preserved markup', () => {
    const doc = parseHtml('<div class="legacy"><table><tr><td><p>x</p></td></tr></table></div>')
    const el = render(firstOfType(doc, 'unknown_block'))
    const cell = el.querySelector('td')
    expect(cell).not.toBeNull()
    expect(isInsidePreserved(cell)).toBe(true)
  })

  it('is false for markup the schema models itself', () => {
    // A modelled node's `toDOM` returns an output spec rather than an element,
    // so render it the way the serializer does and ask about the result.
    const html = DOMSerializer.fromSchema(baseSchema).serializeFragment(
      parseHtml('<p>ordinary</p>').content,
      { document },
    )
    const paragraph = (html as DocumentFragment).firstElementChild
    expect(paragraph?.nodeName).toBe('P')
    expect(isInsidePreserved(paragraph)).toBe(false)
  })

  it('is false for null, so a `closest`-style walk off the top is safe', () => {
    expect(isInsidePreserved(null)).toBe(false)
  })

  it('is false for a detached element nobody preserved', () => {
    expect(isInsidePreserved(document.createElement('div'))).toBe(false)
  })

  it('is the guard that keeps paragraph unwrap out of preserved markup', () => {
    // The pass `serializeHtml` runs is the reference consumer: without the
    // guard it collapses a sole `<p>` inside markup the editor undertook to
    // return byte-identical.
    const html = '<div class="wrapper"><table><tbody><tr><td><p>hi</p></td></tr></tbody></table></div>'
    expect(roundTrip(html)).toBe(html)
    expect(roundTrip('<div class="callout"><ul><li>a</li></ul></div>')).toBe(
      '<div class="callout"><ul><li>a</li></ul></div>',
    )
  })

  it('is exported from the package index, not just from the module', () => {
    // The guide's advice was unusable precisely because the guard was not on
    // the barrel. Pinning the barrel is the part that matters to an author.
    expect(typeof isInsidePreserved).toBe('function')
    expect(baseSchema.nodes['unknown_block']).toBeDefined()
  })
})

/**
 * A p-closing element claimed as unknown_inline is serialized inside `<p>`
 * and the HTML parser splits that paragraph on the next parse. One roundTrip
 * looks fine; the second is the one that grows. Convergence is the check.
 */
describe('preserved block elements in paragraph-holding containers', () => {
  const P_CLOSING = [
    'div', 'section', 'aside', 'nav', 'center', 'header', 'footer', 'main',
    'address', 'fieldset', 'dl', 'menu', 'dialog', 'hr', 'figure',
  ] as const

  function expectFixedPoint(html: string): string {
    const once = roundTrip(html)
    expect(roundTrip(once), html).toBe(once)
    expect(roundTrip(roundTrip(once)), html).toBe(once)
    return once
  }

  it('does not grow a callout div inside a blockquote on every save', () => {
    const html = '<blockquote><div class="callout">Note</div></blockquote>'
    const once = expectFixedPoint(html)
    expect(once).toBe(html)
    expect(once).not.toContain('<p></p>')
  })

  it.each(P_CLOSING)('is a fixed point for <%s> inside a blockquote', (tag) => {
    const inner = tag === 'hr' ? '<hr class="break">' : `<${tag} class="callout">Note</${tag}>`
    const once = expectFixedPoint(`<blockquote>${inner}</blockquote>`)
    expect(once.match(/<p><\/p>/g) ?? []).toHaveLength(0)
  })

  it.each(P_CLOSING)('is a fixed point for <%s> as the first child of a list item', (tag) => {
    const inner = tag === 'hr' ? '<hr class="break">' : `<${tag} class="callout">Note</${tag}>`
    expectFixedPoint(`<ul><li>${inner}</li></ul>`)
  })

  it('still wraps a genuine inline unknown as the first child of a list item', () => {
    const html = '<ol><li><ins>a</ins></li><li>b</li></ol>'
    const once = expectFixedPoint(html)
    expect(once).toContain('<ins>a</ins>')
    expect(once).toContain('<ol>')
  })

  it('still treats a custom element as inline, because it does not close a p', () => {
    const html = '<blockquote><drupal-media data-uuid="1"></drupal-media></blockquote>'
    const once = expectFixedPoint(html)
    expect(once).toContain('drupal-media')
    expect(once).toContain('data-uuid="1"')
  })

  it('leaves a p-closing element inside a heading as a fixed point', () => {
    expectFixedPoint('<h2><div class="callout">Note</div></h2>')
  })

  it('leaves a p-closing element inside a table cell as a fixed point', () => {
    expectFixedPoint('<table><tr><td><div class="callout">Note</div></td></tr></table>')
  })
})
