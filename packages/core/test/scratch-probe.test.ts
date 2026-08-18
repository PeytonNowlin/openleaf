import { describe, expect, it } from 'vitest'
import { Schema, DOMParser, DOMSerializer, type NodeSpec } from 'prosemirror-model'
import { parseHtml, serializeHtml, schema } from '../src/index.js'

const rt = (h: string) => serializeHtml(parseHtml(h))

describe('PROBE 1: unwrapSoleCellParagraph reaches inside preserved atoms', () => {
  it('shows whether a table nested in a preserved div is rewritten', () => {
    const input = '<div class="wrapper"><table><tr><td><p>hi</p></td></tr></table></div>'
    const once = rt(input)
    const twice = rt(once)
    console.log('PROBE1 in   :', input)
    console.log('PROBE1 once :', once)
    console.log('PROBE1 twice:', twice)
    expect(true).toBe(true)
  })
  it('top-level table cell with authored <p>', () => {
    const input = '<table><tr><td><p>hi</p></td></tr></table>'
    console.log('PROBE1b once:', rt(input))
    expect(true).toBe(true)
  })
})

describe('PROBE 2: does a default-priority extension rule beat the catch-all', () => {
  it('checks rule order and claim', () => {
    const callout: NodeSpec = {
      content: 'block+', group: 'block', defining: true,
      parseDOM: [{ tag: 'div.callout' }],
      toDOM: () => ['div', { class: 'callout' }, 0],
    }
    const nodes = (schema.spec.nodes as any).addToEnd('callout', callout)
    const s2 = new Schema({ nodes, marks: schema.spec.marks as any })
    const rules = (DOMParser as any).schemaRules(s2)
    console.log('PROBE2 last 6 rules:', rules.slice(-6).map((r: any) => `${r.tag ?? r.style}@p${r.priority ?? 50}->${r.node ?? r.mark ?? (r.ignore ? 'IGNORE' : '?')}`))
    const idxCallout = rules.findIndex((r: any) => r.node === 'callout')
    const idxUB = rules.findIndex((r: any) => r.node === 'unknown_block')
    const idxUI = rules.findIndex((r: any) => r.node === 'unknown_inline')
    console.log('PROBE2 indices callout/unknown_inline/unknown_block:', idxCallout, idxUI, idxUB, 'of', rules.length)

    const p = DOMParser.fromSchema(s2)
    const tpl = document.createElement('template')
    tpl.innerHTML = '<div class="callout"><p>hello</p></div>'
    const doc = p.parse(tpl.content)
    console.log('PROBE2 parsed first child type:', doc.firstChild?.type.name)
    const ser = DOMSerializer.fromSchema(s2)
    const host = document.createElement('div')
    host.appendChild(ser.serializeFragment(doc.content, { document }))
    console.log('PROBE2 serialized:', host.innerHTML)
    expect(doc.firstChild?.type.name).toBe('callout')
  })
})

describe('PROBE 3: defaultType drift when an extension node is prepended', () => {
  it('compares append vs prepend', () => {
    const widget: NodeSpec = {
      group: 'block', atom: true, parseDOM: [{ tag: 'x-widget' }], toDOM: () => ['x-widget'],
    }
    const appended = new Schema({
      nodes: (schema.spec.nodes as any).addToEnd('widget', widget),
      marks: schema.spec.marks as any,
    })
    const prepended = new Schema({
      nodes: (schema.spec.nodes as any).addToStart('widget', widget),
      marks: schema.spec.marks as any,
    })
    console.log('PROBE3 base defaultType     :', schema.topNodeType.contentMatch.defaultType?.name)
    console.log('PROBE3 appended defaultType :', appended.topNodeType.contentMatch.defaultType?.name)
    console.log('PROBE3 prepended defaultType:', prepended.topNodeType.contentMatch.defaultType?.name)
    console.log('PROBE3 prepended empty doc  :', JSON.stringify(prepended.topNodeType.createAndFill()?.toJSON()))
    console.log('PROBE3 list_item fill (base):', schema.nodes['list_item']!.contentMatch.defaultType?.name)
    console.log('PROBE3 list_item fill (pre) :', prepended.nodes['list_item']!.contentMatch.defaultType?.name)
    expect(true).toBe(true)
  })
})

describe('PROBE 4: cross-schema node construction failure mode', () => {
  it('shows what happens when a node from schema A lands in a doc of schema B', () => {
    const s2 = new Schema({
      nodes: (schema.spec.nodes as any).addToEnd('widget', {
        group: 'block', atom: true, parseDOM: [{ tag: 'x-widget' }], toDOM: () => ['x-widget'],
      }),
      marks: schema.spec.marks as any,
    })
    const foreignPara = schema.nodes['paragraph']!.create(null, schema.text('foreign'))
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p>native</p>'
    const nativeDoc = DOMParser.fromSchema(s2).parse(tpl.content)
    try {
      const replaced = nativeDoc.replace(0, nativeDoc.content.size, new (require('prosemirror-model').Slice)((foreignPara as any).content, 0, 0))
      console.log('PROBE4 replace ok:', replaced.toString())
    } catch (e) {
      console.log('PROBE4 replace threw:', (e as Error).message)
    }
    try {
      const ser = DOMSerializer.fromSchema(s2)
      const host = document.createElement('div')
      host.appendChild(ser.serializeFragment((schema.nodes['paragraph']!.createAndFill()! as any).content, { document }))
      console.log('PROBE4 serialize of foreign node content ok:', host.innerHTML)
    } catch (e) {
      console.log('PROBE4 serialize threw:', (e as Error).message)
    }
    console.log('PROBE4 type identity same name, same object?', schema.nodes['paragraph'] === s2.nodes['paragraph'])
    expect(true).toBe(true)
  })
})
