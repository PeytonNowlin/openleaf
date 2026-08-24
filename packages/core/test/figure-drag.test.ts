/**
 * Dragging the `<img>` inside a captioned figure must move the figure.
 *
 * `image` is draggable and `figure` is not, so ProseMirror's dragstart builds a
 * NodeSelection on the image. The default drop then rips that image out of the
 * figure and leaves the caption behind -- markup the next parse cannot keep.
 * #185's title claimed a bare image duplicates; on current main it already
 * moves. These tests pin the figure unit-move and keep the bare-image path.
 */

import { history, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { dropPoint } from 'prosemirror-transform'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { coreSchema, figureDragPlugin, parseHtml, serializeHtml } from '../src/index.js'
import { dropFigureForDraggedImage } from '../src/figure-drag.js'

const FIGURE_DOC =
  '<p>one</p><figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure><p>two</p><p>three</p>'

const BARE_IMAGE_DOC = '<p>one</p><p><img src="/a.png" alt="x"></p><p>three</p>'

let view: EditorView | undefined

function mount(html: string): EditorView {
  const place = document.createElement('div')
  document.body.append(place)
  view = new EditorView(place, {
    state: EditorState.create({
      doc: parseHtml(html, { schema: coreSchema() }),
      plugins: [history(), figureDragPlugin()],
    }),
  })
  return view
}

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.innerHTML = ''
})

function posOfType(doc: PMNode, name: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === name) found = pos
    return found < 0
  })
  if (found < 0) throw new Error(`no ${name} node`)
  return found
}

function posOfText(doc: PMNode, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === text) found = pos
    return found < 0
  })
  if (found < 0) throw new Error(`no text ${JSON.stringify(text)}`)
  return found
}

type Dragging = NonNullable<EditorView['dragging']> & { node?: NodeSelection }

function startImageDrag(v: EditorView, move = true): NodeSelection {
  const sel = NodeSelection.create(v.state.doc, posOfType(v.state.doc, 'image'))
  v.dragging = { slice: sel.content(), move, node: sel } as Dragging
  return sel
}

/** Latter half of "three", so dropPoint places a block after that paragraph. */
function destAfterThree(doc: PMNode): number {
  return posOfText(doc, 'three') + 4
}

function count(html: string, tag: string): number {
  return html.split(`<${tag}`).length - 1
}

/**
 * What ProseMirror's default drop does for a NodeSelection move: delete the
 * selected node and insert its slice at dropPoint. Used to show a bare image
 * still moves when this plugin declines the drop.
 */
function applyDefaultNodeMove(v: EditorView, destPos: number): void {
  const sel = v.state.selection
  if (!(sel instanceof NodeSelection)) {
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, posOfType(v.state.doc, 'image'))))
  }
  const nodeSel = v.state.selection as NodeSelection
  const slice = nodeSel.content()
  const insertPos = dropPoint(v.state.doc, destPos, slice)
  if (insertPos == null) throw new Error('no drop point for default move')
  const tr = v.state.tr
  nodeSel.replace(tr)
  const pos = tr.mapping.map(insertPos)
  const node = slice.content.firstChild
  if (!node) throw new Error('empty node slice')
  tr.replaceRangeWith(pos, pos, node)
  v.dispatch(tr)
}

describe('dropFigureForDraggedImage', () => {
  it('moves the figure and caption together, leaving no orphan caption', () => {
    const v = mount(FIGURE_DOC)
    startImageDrag(v)
    const dest = destAfterThree(v.state.doc)
    expect(dropFigureForDraggedImage(v, dest, false)).toBe(true)

    const html = serializeHtml(v.state.doc)
    expect(html).toBe(
      '<p>one</p><p>two</p><p>three</p><figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>',
    )
    expect(count(html, 'figure')).toBe(1)
    expect(count(html, 'figcaption')).toBe(1)
    expect(count(html, 'img')).toBe(1)
    expect(html).not.toMatch(/<figure><figcaption>/)
  })

  it('undoes the move in one step', () => {
    const v = mount(FIGURE_DOC)
    const before = serializeHtml(v.state.doc)
    startImageDrag(v)
    dropFigureForDraggedImage(v, destAfterThree(v.state.doc), false)
    expect(serializeHtml(v.state.doc)).not.toBe(before)

    let undone = v.state
    undo(v.state, (tr) => {
      undone = v.state.apply(tr)
    })
    expect(serializeHtml(undone.doc)).toBe(before)
  })

  it('does not claim a bare image, so a default node-move leaves exactly one img', () => {
    const v = mount(BARE_IMAGE_DOC)
    startImageDrag(v)
    const dest = destAfterThree(v.state.doc)
    expect(dropFigureForDraggedImage(v, dest, false)).toBe(false)

    applyDefaultNodeMove(v, dest)
    const html = serializeHtml(v.state.doc)
    expect(count(html, 'img')).toBe(1)
    expect(html).toContain('<img src="/a.png" alt="x">')
    expect(html).not.toContain('<figure>')
    expect(html).not.toContain('<figcaption>')
  })

  it('copies the whole figure when move is false, leaving the original intact', () => {
    const v = mount(FIGURE_DOC)
    startImageDrag(v, false)
    expect(dropFigureForDraggedImage(v, destAfterThree(v.state.doc), true)).toBe(true)

    const html = serializeHtml(v.state.doc)
    expect(count(html, 'figure')).toBe(2)
    expect(count(html, 'figcaption')).toBe(2)
    expect(count(html, 'img')).toBe(2)
    expect(html).toBe(
      '<p>one</p><figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure><p>two</p><p>three</p><figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>',
    )
  })

  it('dropping onto the dragged figure does not orphan the caption', () => {
    const v = mount(FIGURE_DOC)
    startImageDrag(v)
    const before = serializeHtml(v.state.doc)
    const imagePos = posOfType(v.state.doc, 'image')
    const $img = v.state.doc.resolve(imagePos)
    expect($img.parent.type.name).toBe('figure')
    expect(dropFigureForDraggedImage(v, imagePos, false)).toBe(true)
    const html = serializeHtml(v.state.doc)
    expect(count(html, 'figure')).toBe(1)
    expect(count(html, 'figcaption')).toBe(1)
    expect(count(html, 'img')).toBe(1)
    expect(html).toContain('<figcaption>cap</figcaption>')
    expect(html).not.toMatch(/<figure><figcaption>/)
    expect(before).toContain('<figcaption>cap</figcaption>')
  })

  it('does not steal a caption text drag', () => {
    const v = mount(FIGURE_DOC)
    const before = serializeHtml(v.state.doc)
    const cap = posOfText(v.state.doc, 'cap')
    const sel = TextSelection.create(v.state.doc, cap, cap + 3)
    v.dispatch(v.state.tr.setSelection(sel))
    v.dragging = { slice: sel.content(), move: true } as Dragging
    expect(dropFigureForDraggedImage(v, destAfterThree(v.state.doc), false)).toBe(false)
    expect(serializeHtml(v.state.doc)).toBe(before)
  })
})

describe('figureDragPlugin', () => {
  it('handleDrop moves the figure using a fake pointer position, ignoring the image slice', () => {
    const v = mount(FIGURE_DOC)
    const imageSlice = startImageDrag(v).content()
    const dest = destAfterThree(v.state.doc)
    v.posAtCoords = () => ({ pos: dest, inside: dest })

    const plugin = figureDragPlugin()
    const handled = plugin.props.handleDrop?.call(
      plugin,
      v,
      { clientX: 1, clientY: 1 } as DragEvent,
      imageSlice,
      true,
    )
    expect(handled).toBe(true)
    const html = serializeHtml(v.state.doc)
    expect(html).toBe(
      '<p>one</p><p>two</p><p>three</p><figure><img src="/a.png" alt="x"><figcaption>cap</figcaption></figure>',
    )
  })
})
