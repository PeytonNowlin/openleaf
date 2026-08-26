/**
 * Untrusted paste markup must never enter the live document.
 *
 * A paste is attacker-controlled input by definition: the author copies from a
 * page someone else wrote. The normalizers strip the dangerous parts, but
 * stripping is only safe if it happens *before* the browser gets a chance to
 * act on them, and the browser acts on a node the moment that node acquires a
 * document with a browsing context. Adopting `<img src=x onerror=...>` into the
 * live document starts the fetch and compiles the handler right then -- the
 * cleanup pass that would have removed the attribute runs a few lines too late.
 *
 * So the invariant these tests defend is narrow and absolute: from parse to
 * serialize, no node of a paste is ever owned by the live document.
 *
 * jsdom cannot prove the negative by execution -- it does not load images and
 * does not compile handler attributes, so a payload "not firing" here would be
 * true of the vulnerable code too. What jsdom *can* prove is the boundary
 * crossing itself, which is the thing that causes the execution, and these
 * tests do that by watching every DOM move the normalizers make. The
 * execution test lives in `packages/element/test/e2e/paste.spec.ts`, in real
 * Chromium, where the payload genuinely runs if this regresses.
 */

import { describe, expect, it } from 'vitest'
import { parseFragment, serializeFragment } from '../src/dom.js'
import { normalizeExcel, normalizeGeneric, normalizeGoogleDocs, normalizeWord } from '../src/index.js'

/** An `onerror` payload, reachable by three different code paths. */
const PAYLOAD = '<img src="https://attacker.example/pixel.png" onerror="window.__pwned=1">'

/** Plain paste: the fragment is walked and serialized, nothing is built. */
const GENERIC = `<p>Quarterly review</p>${PAYLOAD}`

/**
 * Google Docs paste. The `font-weight:700` span makes `extractSemantics` call
 * `wrapChildren`, which moves the image into a freshly created `<strong>` --
 * a second, quieter way to adopt the paste if that element is built with the
 * live document.
 */
const GDOCS =
  '<b style="font-weight:normal" id="docs-internal-guid-abc">' +
  '<p dir="ltr" style="line-height:1.38">' +
  `<span style="font-weight:700">${PAYLOAD}</span></p></b>`

/**
 * Word paste. List reconstruction builds `<ul>`, `<li>` and `<p>` and moves the
 * paragraph's children into them -- the same hazard as `wrapChildren`, on the
 * path that matters most commercially.
 */
const WORD =
  '<p class="MsoListParagraphCxSpFirst" style="text-indent:-.25in;mso-list:l0 level1 lfo1">' +
  '<!--[if !supportLists]--><span style="font-family:Symbol">·</span><!--[endif]-->' +
  `Revenue up 12%${PAYLOAD}<o:p></o:p></p>`

/**
 * Excel paste. `extractSemantics` wraps a bold cell the same way it wraps a
 * Google Docs span, so this is the wrapChildren adoption hazard on the path
 * that must not reconstruct lists.
 */
const EXCEL =
  '<meta name=ProgId content=Excel.Sheet>' +
  `<table><tr><td><span style="font-weight:700">${PAYLOAD}</span></td></tr></table>`

function describeNode(node: Node): string {
  if (node.nodeType === 11) {
    return `#fragment[${Array.from((node as DocumentFragment).children)
      .map((el) => el.nodeName.toLowerCase())
      .join(',')}]`
  }
  if (node.nodeType === 1) return (node as Element).outerHTML.slice(0, 120)
  return `#${node.nodeName}`
}

/**
 * Run `work`, reporting every node moved into a tree the live document owns.
 *
 * The prototype patch is the whole point: it observes the moves the code under
 * test makes itself, rather than inspecting the result afterwards. Adoption is
 * transient -- a node can be adopted into the live document and moved back
 * within the same synchronous pass, and by then its `ownerDocument` says
 * nothing -- but the fetch and the handler compilation have already happened.
 * Only watching the move catches that.
 *
 * Moves in the other direction, live node into an inert tree, are not adoptions
 * into the live document and are not reported. That is how the normalizers are
 * supposed to build their `<strong>` and `<li>` wrappers.
 */
function adoptionsInto(live: Document, work: () => void): string[] {
  const view = live.defaultView
  if (!view) throw new Error('this test needs a document with a window')

  const proto = view.Node.prototype
  const adopted: string[] = []

  const note = (host: Node, moved: Node): void => {
    const hostDocument = host.nodeType === 9 ? (host as Document) : host.ownerDocument
    if (hostDocument !== live) return
    if (moved.ownerDocument === live) return
    adopted.push(describeNode(moved))
  }

  const realAppendChild = proto.appendChild
  const realInsertBefore = proto.insertBefore
  const realReplaceChild = proto.replaceChild

  proto.appendChild = function appendChild<T extends Node>(this: Node, node: T): T {
    note(this, node)
    return realAppendChild.call(this, node) as T
  }
  proto.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    note(this, node)
    return realInsertBefore.call(this, node, child) as T
  }
  proto.replaceChild = function replaceChild<T extends Node>(
    this: Node,
    node: Node,
    child: T,
  ): T {
    note(this, node)
    return realReplaceChild.call(this, node, child) as T
  }

  try {
    work()
  } finally {
    proto.appendChild = realAppendChild
    proto.insertBefore = realInsertBefore
    proto.replaceChild = realReplaceChild
  }

  return adopted
}

describe('the adoption watcher itself', () => {
  // A test that cannot fail proves nothing, so this pins the mechanism: the
  // exact shape the normalizers used to have is caught, and the shape they have
  // now is not. Everything below is only meaningful because of this.
  it('catches a fragment appended into a live-document element', () => {
    const seen = adoptionsInto(document, () => {
      const tpl = document.createElement('template')
      tpl.innerHTML = PAYLOAD
      const host = document.createElement('div')
      host.appendChild(tpl.content)
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('#fragment[img]')
  })

  it('catches inert children moved into a live-document wrapper', () => {
    const seen = adoptionsInto(document, () => {
      const tpl = document.createElement('template')
      tpl.innerHTML = `<span>${PAYLOAD}</span>`
      const span = tpl.content.querySelector('span') as HTMLElement
      const wrapper = document.createElement('strong')
      while (span.firstChild) wrapper.appendChild(span.firstChild)
      span.appendChild(wrapper)
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('<img')
  })

  it('does not flag a live element moved into an inert tree', () => {
    const seen = adoptionsInto(document, () => {
      const tpl = document.createElement('template')
      tpl.innerHTML = '<span></span>'
      const span = tpl.content.querySelector('span') as HTMLElement
      span.appendChild(document.createElement('strong'))
    })
    expect(seen).toEqual([])
  })
})

describe('parseFragment', () => {
  it('parses into a document that is not the live one', () => {
    const { root, doc } = parseFragment(PAYLOAD, document)
    expect(doc).not.toBe(document)
    expect(root.ownerDocument).toBe(doc)
  })

  it('parses into a document with no browsing context, so nothing can run', () => {
    // No window means no scripting: this is the property that stops the fetch
    // and stops `onerror` becoming a callable handler, and it is why the
    // fragment has to be where the cleanup happens.
    const { doc } = parseFragment(PAYLOAD, document)
    expect(doc.defaultView).toBeNull()
  })

  it('leaves an on* attribute uncompiled while it is in the fragment', () => {
    const { root } = parseFragment(PAYLOAD, document)
    const img = root.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('onerror')).toBe('window.__pwned=1')
    expect(img.onerror).toBeNull()
  })

  it('keeps fragments a <div> would discard', () => {
    // The original reason for <template>, and still a reason: a bare <tr> from
    // an Excel or Word clipboard does not survive innerHTML on a <div>.
    const { root } = parseFragment('<tr><td>a</td></tr>', document)
    expect(serializeFragment({ root, doc: root.ownerDocument as Document })).toBe(
      '<tr><td>a</td></tr>',
    )

    const div = document.createElement('div')
    div.innerHTML = '<tr><td>a</td></tr>'
    expect(div.innerHTML).toBe('a')
  })
})

describe('serializeFragment', () => {
  it('serializes without adopting into the live document', () => {
    let out = ''
    const seen = adoptionsInto(document, () => {
      out = serializeFragment(parseFragment(GENERIC, document))
    })
    expect(seen).toEqual([])
    expect(out).toBe(GENERIC)
  })
})

describe('normalizers never adopt a paste into the live document', () => {
  const cases: Array<[string, string, (html: string) => string]> = [
    ['a generic paste', GENERIC, (html) => normalizeGeneric(html)],
    ['a Google Docs paste', GDOCS, (html) => normalizeGoogleDocs(html)],
    ['a Word paste', WORD, (html) => normalizeWord(html)],
    ['an Excel paste', EXCEL, (html) => normalizeExcel(html)],
  ]

  for (const [name, payload, normalize] of cases) {
    it(`normalizes ${name} without a single crossing`, () => {
      let out = ''
      const seen = adoptionsInto(document, () => {
        out = normalize(payload)
      })
      expect(seen).toEqual([])
      // The normalizer really did run over the payload, so the empty list above
      // is not just an empty pass.
      expect(out).toContain('attacker.example')
    })

    it(`leaves nothing from ${name} in the live document`, () => {
      normalize(payload)
      expect(document.body.innerHTML).not.toContain('attacker.example')
      expect(document.documentElement.innerHTML).not.toContain('__pwned')
    })
  }

  it('still builds the wrappers it is supposed to build', () => {
    // The fix threads an inert document through node creation. If that had gone
    // wrong the wrappers would be missing, and every assertion above would pass
    // vacuously.
    expect(normalizeGoogleDocs(GDOCS)).toContain('<strong>')
    expect(normalizeWord(WORD)).toContain('<ul>')
    expect(normalizeWord(WORD)).toContain('Revenue up 12%')
    expect(normalizeExcel(EXCEL)).toContain('<strong>')
    expect(normalizeExcel(EXCEL)).toContain('<table')
    expect(normalizeExcel(EXCEL)).not.toContain('<ul')
  })
})
