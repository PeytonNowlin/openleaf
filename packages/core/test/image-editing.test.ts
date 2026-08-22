/**
 * Editing an image already in the document.
 *
 * `insertImage` always `replaceSelectionWith`, so saving a selected figure
 * replaced it with a bare `<img>` and dropped alt, title, dimensions,
 * alignment, the author's class, and the figcaption. `updateImage` is the
 * in-place path, matching `updateMedia`.
 */

import { NodeSelection, TextSelection, type Command, EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { coreSchema, parseHtml, selectedImage, serializeHtml, updateImage } from '../src/index.js'

const FIGURE =
  '<figure><img src="/a.png" alt="A goat on a roof" title="Goat" width="640" height="480" class="ol-float-left rounded"><figcaption>Fig 1</figcaption></figure>'

function emptyState(): EditorState {
  const state = EditorState.create({ doc: parseHtml('<p></p>'), schema: coreSchema() })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
}

/** A document holding one image, with that image selected. */
function selecting(html: string): EditorState {
  const state = EditorState.create({ doc: parseHtml(html), schema: coreSchema() })
  let pos: number | null = null
  state.doc.descendants((node, at) => {
    if (pos === null && node.type.name === 'image') pos = at
    return pos === null
  })
  if (pos === null) throw new Error(`no image node in ${html}`)
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
}

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return applied ? next : null
}

function stored(state: EditorState): string {
  return serializeHtml(state.doc)
}

describe('selectedImage', () => {
  it('reads a NodeSelection on the image, including the surrounding caption', () => {
    const found = selectedImage(selecting(FIGURE))
    expect(found).not.toBeNull()
    expect(found!.src).toBe('/a.png')
    expect(found!.alt).toBe('A goat on a roof')
    expect(found!.title).toBe('Goat')
    expect(found!.width).toBe('640')
    expect(found!.height).toBe('480')
    expect(found!.align).toBe('left')
    expect(found!.className).toBe('rounded')
    expect(found!.caption).toBe('Fig 1')
  })

  it('reads a NodeSelection on the figure the same way as clicking the picture', () => {
    const state = EditorState.create({ doc: parseHtml(FIGURE), schema: coreSchema() })
    let figurePos: number | null = null
    state.doc.descendants((node, at) => {
      if (figurePos === null && node.type.name === 'figure') figurePos = at
      return figurePos === null
    })
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, figurePos!)))
    const found = selectedImage(selected)
    expect(found).not.toBeNull()
    expect(found!.caption).toBe('Fig 1')
    expect(found!.src).toBe('/a.png')
  })

  it('returns null for a caret beside an image', () => {
    const caret = EditorState.create({
      doc: parseHtml('<p><img src="/a.png" alt="x"></p>'),
      schema: coreSchema(),
    })
    const beside = caret.apply(caret.tr.setSelection(TextSelection.create(caret.doc, 1)))
    expect(selectedImage(beside)).toBeNull()
  })
})

describe('updateImage', () => {
  it('round-trips a selected figure when saved with the same attributes', () => {
    const state = selecting(FIGURE)
    const current = selectedImage(state)!
    const before = stored(state)
    const next = run(
      state,
      updateImage({
        src: current.src,
        alt: current.alt,
        title: current.title,
        width: current.width,
        height: current.height,
        align: current.align,
        className: current.className,
        caption: current.caption,
      }),
    )
    expect(stored(next!)).toBe(before)
    expect(stored(next!)).toContain('alt="A goat on a roof"')
    expect(stored(next!)).toContain('title="Goat"')
    expect(stored(next!)).toContain('width="640"')
    expect(stored(next!)).toContain('height="480"')
    expect(stored(next!)).toContain('ol-float-left')
    expect(stored(next!)).toContain('rounded')
    expect(stored(next!)).toContain('<figcaption>Fig 1</figcaption>')
  })

  it('changes alt without dropping caption, class, or dimensions', () => {
    const next = run(selecting(FIGURE), updateImage({ src: '/a.png', alt: 'A goat' }))
    const html = stored(next!)
    expect(html).toContain('alt="A goat"')
    expect(html).toContain('title="Goat"')
    expect(html).toContain('width="640"')
    expect(html).toContain('height="480"')
    expect(html).toContain('rounded')
    expect(html).toContain('<figcaption>Fig 1</figcaption>')
  })

  it('rewrites the figcaption when the author changes it', () => {
    const next = run(selecting(FIGURE), updateImage({ src: '/a.png', caption: 'Fig 2' }))
    expect(stored(next!)).toContain('<figcaption>Fig 2</figcaption>')
    expect(stored(next!)).not.toContain('Fig 1')
  })

  it('keeps the figure when the caption field is cleared', () => {
    const next = run(selecting(FIGURE), updateImage({ src: '/a.png', caption: null }))
    expect(stored(next!)).toContain('<figure>')
    expect(stored(next!)).toContain('<figcaption></figcaption>')
  })

  it('leaves the image selected so a second edit does not have to find it', () => {
    const next = run(selecting(FIGURE), updateImage({ src: '/b.png' }))
    expect(selectedImage(next!)).not.toBeNull()
    expect(selectedImage(next!)!.src).toBe('/b.png')
  })

  it('declines an unstoreable address', () => {
    expect(run(selecting(FIGURE), updateImage({ src: 'javascript:alert(1)' }))).toBeNull()
  })

  it('declines when nothing is selected', () => {
    expect(run(emptyState(), updateImage({ src: '/a.png' }))).toBeNull()
  })
})
