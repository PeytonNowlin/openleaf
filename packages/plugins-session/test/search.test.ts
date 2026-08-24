import { coreSchema, isNonEditableNode, nonEditablePlugin, parseHtml, serializeHtml } from '@openleaf-editor/core'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Decoration, DecorationSet } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import { countWords, documentStats, documentText } from '../src/count.js'
import {
  findMatches,
  findNext,
  findPrev,
  replaceAll,
  replaceCurrent,
  searchKey,
  searchPlugin,
  setSearch,
} from '../src/search.js'

function stateFrom(html: string) {
  return EditorState.create({
    doc: parseHtml(html, { schema: coreSchema() }),
    plugins: [searchPlugin()],
  })
}

function stateFromLocked(html: string) {
  return EditorState.create({
    doc: parseHtml(html, { schema: coreSchema() }),
    plugins: [searchPlugin(), nonEditablePlugin()],
  })
}

describe('countWords', () => {
  it('counts zero for empty or whitespace', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n')).toBe(0)
  })

  it('counts latin words', () => {
    expect(countWords('hello there friend')).toBe(3)
  })
})

function between(doc: ReturnType<typeof parseHtml>): string {
  return doc.textBetween(0, doc.content.size, ' ', ' ')
}

describe('documentStats', () => {
  it('counts words and paragraphs in a document', () => {
    const doc = parseHtml('<h2>Title</h2><p>One two three.</p>', { schema: coreSchema() })
    const stats = documentStats(doc)
    expect(stats.paragraphs).toBe(2)
    expect(stats.words).toBeGreaterThanOrEqual(4)
    expect(stats.characters).toBeGreaterThan(0)
  })

  // `textBetween` inserts the block separator before every textblock and block
  // leaf after the first, including empty paragraphs. A walk that treats every
  // `isBlock` the same drops those spaces and mis-reports `characters`.
  it('matches textBetween for empty paragraphs', () => {
    const doc = parseHtml('<p></p><p>hi</p>', { schema: coreSchema() })
    expect(documentText(doc)).toBe(between(doc))
    expect(documentStats(doc).characters).toBe(between(doc).length)
  })

  it('matches textBetween across a page break', () => {
    const doc = parseHtml('<p>a</p><hr class="ol-pagebreak"><p>b</p>', { schema: coreSchema() })
    expect(documentText(doc)).toBe(between(doc))
    expect(documentStats(doc).characters).toBe(between(doc).length)
  })
})

describe('findMatches', () => {
  it('finds a query across a mark boundary', () => {
    const doc = parseHtml('<p><strong>hel</strong>lo there</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(serializeHtml(doc).toLowerCase()).toContain('hel')
  })

  it('does not match across paragraphs', () => {
    const doc = parseHtml('<p>hel</p><p>lo</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello')).toEqual([])
  })

  it('honours match case', () => {
    const doc = parseHtml('<p>Hello hello</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'Hello', { caseSensitive: true })).toHaveLength(1)
    expect(findMatches(doc, 'hello', { caseSensitive: false })).toHaveLength(2)
  })

  // A match that spanned the image would hand Replace a range containing it,
  // and replacing that range would delete the image the author never selected.
  it('does not match through an inline image', () => {
    const doc = parseHtml('<p>hel<img src="x.png" alt="">lo</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello')).toEqual([])
    expect(findMatches(doc, 'hel')).toHaveLength(1)
  })

  it('does not match through a hard break', () => {
    const doc = parseHtml('<p>hel<br>lo</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello')).toEqual([])
    expect(findMatches(doc, 'lo')).toHaveLength(1)
  })
})

/**
 * Word, Docs, and Insert → NBSP store U+00A0. The search index used to keep
 * that character as itself, so a query typed with a normal space missed the
 * phrase the author can see. Folding NBSP to U+0020 on both sides -- and only
 * that character; other Unicode spaces are a different problem -- makes the
 * two spellings find each other. Replace writes whatever was typed, so
 * replacing an NBSP run with a normal-space query converts those NBSPs.
 */
describe('non-breaking space', () => {
  it('finds a query typed with a space in a document that stores NBSP', () => {
    const doc = parseHtml('<p>hello\u00a0world</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'hello world')
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('hello\u00a0world')
  })

  it('finds a query containing a literal NBSP in a document with ordinary spaces', () => {
    const doc = parseHtml('<p>hello world</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello\u00a0world')).toHaveLength(1)
  })

  it('still finds an ordinary-space query in an ordinary-space document', () => {
    const doc = parseHtml('<p>hello world</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'hello world')).toHaveLength(1)
  })

  it('replaces an NBSP phrase with whatever was typed', () => {
    let state = stateFrom('<p>hello\u00a0world</p>')
    setSearch('hello world')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('hola mundo')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>hola mundo</p>')
  })
})

describe('find and replace commands', () => {
  it('selects the next match', () => {
    let state = stateFrom('<p>one two one</p>')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    const search = searchKey.getState(state)
    expect(search?.matches).toHaveLength(2)
    expect(state.selection.from).toBe(search?.matches[0]?.from)
  })

  it('replaces the current match and keeps the others', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toContain('uno')
    expect(searchKey.getState(state)?.matches.length).toBe(1)
  })

  it('replaces every match', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>uno two uno</p>')
  })

  it('leaves an image standing when text either side of it is replaced', () => {
    let state = stateFrom('<p>hel<img src="x.png" alt="">lo</p>')
    setSearch('hel')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('bye')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>bye<img src="x.png" alt="">lo</p>')
  })

  // The marks come from the replaced text, not from the caret. `$pos.marks()`
  // would inherit the preceding bold in the first case and drop it in the second.
  it('does not take on marks from the text before the match', () => {
    let state = stateFrom('<p><strong>x</strong>hello</p>')
    setSearch('hello')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p><strong>x</strong>uno</p>')
  })

  it('keeps the marks the matched text carried', () => {
    let state = stateFrom('<p>x<strong>hello</strong></p>')
    setSearch('hello')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>x<strong>uno</strong></p>')
  })
})

/**
 * `İ` (U+0130) is the one BMP character whose lowercase is longer than itself:
 * `i` plus a combining dot above. Folding the whole document text with
 * `toLowerCase()` therefore slid every later character one place out of step
 * with the table mapping offsets back to document positions, and Turkish place
 * names are ordinary content.
 */
describe('case folding that changes length', () => {
  it('finds a match that follows a dotted capital I', () => {
    const doc = parseHtml('<p>İstanbul hello</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('hello')
  })

  it('replaces the matched text and nothing either side of it', () => {
    let state = stateFrom('<p>İstanbul hello world</p>')
    setSearch('hello')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('X')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>İstanbul X world</p>')
  })

  it('folds the dotted capital I itself, in the document and in the query', () => {
    const doc = parseHtml('<p>İstanbul</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'istanbul')).toHaveLength(1)
    expect(findMatches(doc, 'İSTANBUL')).toHaveLength(1)
    expect(findMatches(doc, 'istanbul', { caseSensitive: true })).toEqual([])
  })

  it('reports positions that survive a round trip through the document', () => {
    const doc = parseHtml('<p>İİİ needle İİİ</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'NEEDLE')
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('needle')
  })

  // Folded per code unit, each half of a surrogate pair is unchanged and the
  // character never folds at all. The pair has to be folded as one.
  it('folds a character outside the BMP', () => {
    const doc = parseHtml('<p>\u{10400} hello</p>', { schema: coreSchema() })
    expect(findMatches(doc, '\u{10428}')).toHaveLength(1)
    const matches = findMatches(doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe('hello')
  })

  it('keeps positions in step through an astral character', () => {
    let state = stateFrom('<p>\u{1F600} hello world</p>')
    setSearch('HELLO')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('X')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>\u{1F600} X world</p>')
  })
})

/**
 * Greek lowercases `Σ` to `ς` at the end of a word and `σ` everywhere else, a
 * rule that needs the surrounding text. A fold that works one code point at a
 * time cannot see that context, so folding both forms to `σ` is what keeps the
 * two spellings finding each other. `-ος`, `-ης` and `-ας` are the commonest
 * Greek noun endings, so getting this wrong loses most of the language.
 */
describe('final sigma', () => {
  it('matches an upper case word from a query typed with a final sigma', () => {
    const doc = parseHtml('<p>ΜΑΘΗΤΗΣ here</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'μαθητης')).toHaveLength(1)
    expect(findMatches(doc, 'μαθητησ')).toHaveLength(1)
  })

  it('matches a word ending in a final sigma from an upper case query', () => {
    const doc = parseHtml('<p>μαθητης here</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'ΜΑΘΗΤΗΣ')).toHaveLength(1)
  })

  it('still tells the two forms apart with match case on', () => {
    const doc = parseHtml('<p>μαθητης</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'μαθητησ', { caseSensitive: true })).toEqual([])
  })
})

/**
 * A code block keeps its whitespace, so its text can genuinely end in a newline.
 * Testing the last character for one could not tell that from the separator this
 * index writes between blocks, so it suppressed the separator, left the two
 * blocks adjacent, and let a match run from one into the next -- which Replace
 * then rewrote, taking the following block with it.
 */
describe('block boundaries', () => {
  it('does not match out of a code block that ends in a newline', () => {
    const doc = parseHtml('<pre><code>a\n</code></pre><p>bc</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'a\nb')).toEqual([])
    expect(findMatches(doc, '\nb')).toEqual([])
  })

  it('leaves the following block standing when the code block is replaced', () => {
    let state = stateFrom('<pre><code>x\n</code></pre><p>yz</p>')
    setSearch('\ny')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.matches).toEqual([])
    expect(replaceAll('Q')(state, () => {})).toBe(false)
    expect(serializeHtml(state.doc)).toBe('<pre><code>x\n</code></pre><p>yz</p>')
  })

  it('still finds a match inside the code block', () => {
    const doc = parseHtml('<pre><code>a\n</code></pre><p>bc</p>', { schema: coreSchema() })
    expect(findMatches(doc, 'a')).toHaveLength(1)
    expect(findMatches(doc, 'bc')).toHaveLength(1)
  })
})

describe('replace feedback', () => {
  // `setSearch` leaves no current match, so Replace found `matches[-1]`, gave up
  // before dispatching, and reported nothing to a button that stayed enabled.
  it('replaces without Next having been pressed first', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.index).toBe(-1)
    const handled = replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(handled).toBe(true)
    expect(serializeHtml(state.doc)).toBe('<p>uno two one</p>')
  })

  it('replaces the match Next would have selected', () => {
    let state = stateFrom('<p>one two one</p>')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)))
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(serializeHtml(state.doc)).toBe('<p>one two uno</p>')
  })

  it('reports nothing to replace when there are no matches', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('zzz')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(replaceCurrent('uno')(state, () => {})).toBe(false)
    expect(replaceAll('uno')(state, () => {})).toBe(false)
  })

  // Replacing rebuilds the matches against the new document and finds none of
  // the old ones, so the count of what was done has to come out of the command.
  it('carries the number replaced out of Replace all', () => {
    let state = stateFrom('<p>one two one</p><p>one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.matches).toHaveLength(3)
    replaceAll('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    const search = searchKey.getState(state)
    expect(search?.replaced).toBe(3)
    expect(search?.matches).toHaveLength(0)
  })

  it('carries a count out of a single Replace', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceCurrent('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.replaced).toBe(1)
  })

  // The count is feedback for one transaction. Left standing it would still be
  // on screen after the next keystroke, describing something that already ended.
  it('forgets the count on the next transaction', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    replaceAll('uno')(state, (tr) => {
      state = state.apply(tr)
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    expect(searchKey.getState(state)?.replaced).toBe(0)
  })
})

/** The rendered attributes of an inline decoration are not on its public type. */
function classOf(decoration: Decoration): string {
  const inline = decoration as unknown as { type?: { attrs?: { class?: string } } }
  return inline.type?.attrs?.class ?? ''
}

describe('search decorations', () => {
  it('serves one cached set rather than rebuilding per view update', () => {
    const plugin = searchPlugin()
    let state = EditorState.create({
      doc: parseHtml('<p>one two one</p>', { schema: coreSchema() }),
      plugins: [plugin],
    })
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    const decorations = plugin.props.decorations
    expect(decorations).toBeTypeOf('function')
    const first = decorations!.call(plugin, state) as DecorationSet
    const second = decorations!.call(plugin, state) as DecorationSet
    expect(first).toBe(second)
    expect(first.find()).toHaveLength(2)
  })

  it('keeps the set across a transaction that changes neither doc nor matches', () => {
    const plugin = searchPlugin()
    let state = EditorState.create({
      doc: parseHtml('<p>one two one</p>', { schema: coreSchema() }),
      plugins: [plugin],
    })
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    const before = searchKey.getState(state)?.decorations
    // Asserted before the identity check, which without it reads `undefined` is
    // `undefined` on any build where the field stopped existing.
    expect(before?.find()).toHaveLength(2)
    state = state.apply(state.tr)
    expect(searchKey.getState(state)?.decorations).toBe(before)
  })

  it('marks the current match and moves the mark with it', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    const current = () =>
      searchKey
        .getState(state)!
        .decorations.find()
        .findIndex((decoration) => classOf(decoration).includes('ol-find-hit-current'))
    expect(current()).toBe(0)
    findNext(state, (tr) => {
      state = state.apply(tr)
    })
    expect(current()).toBe(1)
  })

  it('rebuilds the set when the document changes', () => {
    let state = stateFrom('<p>one two one</p>')
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    state = state.apply(state.tr.insertText('one ', 1))
    expect(searchKey.getState(state)?.decorations.find()).toHaveLength(3)
  })
})

describe('match geometry', () => {
  // `replaceAll` rewrites matches back to front using the positions as found,
  // which is only sound because no match can overlap another.
  it('returns disjoint matches in ascending order', () => {
    const doc = parseHtml('<p>aaaa aaaa</p>', { schema: coreSchema() })
    const matches = findMatches(doc, 'aa')
    expect(matches.length).toBeGreaterThan(1)
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i]!.from).toBeGreaterThanOrEqual(matches[i - 1]!.to)
    }
  })

  it('walks backwards from the caret', () => {
    let state = stateFrom('<p>one two one</p>')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 12)))
    setSearch('one')(state, (tr) => {
      state = state.apply(tr)
    })
    findPrev(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.index).toBe(1)
  })
})

/**
 * A claimed node carrying `contenteditable="false"` as residue. A preserved
 * `<div>` or `<span>` is an unknown atom whose inner HTML is not `node.text`
 * and which `isNonEditableNode` does not see (`SKIP_CARRY`), so these tests
 * use modelled carriers: `blockquote` for a locked block, `figcaption` for a
 * locked inline with children.
 */
const LOCKED =
  '<p>alpha</p><blockquote contenteditable="false"><p>alpha secret</p></blockquote><p>alpha</p>'
const LOCKED_INLINE =
  '<figure><img src="x.png" alt="">hello<figcaption contenteditable="false">secret</figcaption>world</figure>'
const LOCKED_SPANNING = '<p>hel</p><blockquote contenteditable="false"><p>X</p></blockquote><p>lo</p>'

function lockedText(doc: ReturnType<typeof parseHtml>): string[] {
  const locked: string[] = []
  doc.descendants((node) => {
    if (isNonEditableNode(node)) locked.push(node.textContent)
    return true
  })
  return locked
}

describe('contenteditable=false regions', () => {
  it('does not find matches inside a contenteditable=false region', () => {
    const doc = parseHtml(LOCKED, { schema: coreSchema() })
    expect(findMatches(doc, 'alpha')).toHaveLength(2)
    expect(findMatches(doc, 'secret')).toEqual([])
  })

  it('does not find matches inside an inline contenteditable=false figcaption', () => {
    const doc = parseHtml(LOCKED_INLINE, { schema: coreSchema() })
    // The fixture is a modelled inline with children, not a preserved atom:
    // `secret` lives in `node.text`, and `isNonEditableNode` is true.
    expect(lockedText(doc)).toEqual(['secret'])
    expect(findMatches(doc, 'secret')).toEqual([])
    expect(findMatches(doc, 'hello')).toHaveLength(1)
    expect(findMatches(doc, 'world')).toHaveLength(1)
    // Skipping the caption must not concatenate the text either side of it.
    expect(findMatches(doc, 'helloworld')).toEqual([])
  })

  it('does not match across a locked block', () => {
    const doc = parseHtml(LOCKED_SPANNING, { schema: coreSchema() })
    expect(findMatches(doc, 'hello')).toEqual([])
    expect(findMatches(doc, 'helXlo')).toEqual([])
    expect(findMatches(doc, 'hel')).toHaveLength(1)
    expect(findMatches(doc, 'lo')).toHaveLength(1)
  })

  it('replace all skips locked text and still replaces unlocked matches', () => {
    let state = stateFromLocked(LOCKED)
    setSearch('alpha')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.matches).toHaveLength(2)
    replaceAll('beta')(state, (tr) => {
      state = state.apply(tr)
    })
    const html = serializeHtml(state.doc)
    expect(html).toContain('beta')
    expect(html).toContain('alpha secret')
    expect(html).toContain('contenteditable="false"')
    expect(html.match(/beta/g)?.length).toBe(2)
    expect(searchKey.getState(state)?.replaced).toBe(2)
  })

  it('replaces the current unlocked match and leaves the lock standing', () => {
    let state = stateFromLocked(LOCKED)
    setSearch('alpha')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(searchKey.getState(state)?.matches).toHaveLength(2)
    replaceCurrent('beta')(state, (tr) => {
      state = state.apply(tr)
    })
    const html = serializeHtml(state.doc)
    expect(html).toContain('beta')
    expect(html).toContain('alpha secret')
    expect(searchKey.getState(state)?.replaced).toBe(1)
    expect(searchKey.getState(state)?.matches).toHaveLength(1)
  })

  it('word count excludes text inside a contenteditable=false region', () => {
    const locked = parseHtml(LOCKED, { schema: coreSchema() })
    const unlocked = parseHtml(LOCKED.replace(' contenteditable="false"', ''), { schema: coreSchema() })
    const lockedStats = documentStats(locked)
    const unlockedStats = documentStats(unlocked)
    expect(documentText(locked)).not.toMatch(/secret/)
    expect(lockedStats.words).toBeLessThan(unlockedStats.words)
    expect(lockedStats.characters).toBeLessThan(unlockedStats.characters)
    expect(lockedStats.paragraphs).toBeLessThan(unlockedStats.paragraphs)
    expect(lockedStats.words).toBe(2)
    expect(lockedStats.paragraphs).toBe(2)
    expect(documentText(unlocked)).toBe(between(unlocked))
    expect(unlockedStats.characters).toBe(between(unlocked).length)
  })
})
