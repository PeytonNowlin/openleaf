/**
 * Schema extensions: how a plugin contributes node and mark types.
 *
 * ## Why this could not be a simple registry
 *
 * A ProseMirror `Schema` is immutable, and `EditorState.reconfigure` -- the
 * mechanism that lets a late-loading plugin add behaviour to an open editor --
 * cannot change it. Verified in prosemirror-state: `reconfigure` builds
 * `new Configuration(this.schema, config.plugins)`, taking the schema from the
 * old state. So schema extension is not "register and the editors update"; it is
 * "register before an editor is built, or wait for the next one".
 *
 * That constraint decides the shape of everything here.
 *
 * ## Append-only, and why it is not a preference
 *
 * Extension nodes are appended, never prepended, and there is no positioning
 * hint. Measured: prepending a `group: 'block'` node makes it the document's
 * `defaultType`, so `topNodeType.createAndFill()` produces
 * `{"type":"doc","content":[{"type":"widget"}]}` instead of an empty paragraph.
 * Every new document, and every gap the editor fills, would start with a
 * plugin's widget.
 *
 * ## No priority field
 *
 * The preservation layer's catch-all rules sit at priority 0 and 1, which makes
 * them the last two rules in the parse table -- so an extension rule at the
 * default priority already wins, for free. Offering a priority knob would invite
 * an author to set `priority: 0` to be polite and thereby tie with the
 * catch-all, where the winner is decided by map insertion order. Instead,
 * `createSchema` rejects any rule at priority <= 1 and says why.
 *
 * ## Collisions throw
 *
 * Deliberately the opposite of `registerToolbarItem`, which is last-wins because
 * a button is UI and replacing one is a feature. A node type is a *storage
 * format*: two definitions of `footnote` mean two serializations of the same
 * content chosen by script-tag order, and whichever loses has already written
 * documents in its shape. `replaces` is the explicit opt-in.
 */

import OrderedMap from 'orderedmap'
import {
  DOMSerializer,
  Schema,
  type DOMOutputSpec,
  type MarkSpec,
  type NodeSpec,
  type ParseRule,
  type TagParseRule,
} from 'prosemirror-model'
import {
  INLINE_STYLE_PROPERTIES,
  MODELLED_PROPERTIES,
  applyStyleAttribute,
  indentLevels,
  parseDeclarations,
  serializeDeclarations,
} from './css.js'
import { OpenLeafError } from './errors.js'
import { serializationTarget } from './preserve.js'
import { coreMarks, coreNodes, listStart } from './schema.js'
import { CARRIED_STYLE_SCRUBS } from './tables.js'
import { isWritableAttributeName, safeId } from './tokens.js'
import {
  URL_ATTRIBUTES,
  isEventHandlerAttribute,
  isNeverCarriedAttribute,
  isSafeUrl,
} from './url.js'

export interface SchemaExtension {
  /** Stable and unique. Namespace it: `openleaf/footnote`. */
  readonly id: string
  /** Node types by schema name, appended after the core nodes. */
  readonly nodes?: Readonly<Record<string, NodeSpec>>
  /** Mark types by schema name. */
  readonly marks?: Readonly<Record<string, MarkSpec>>
  /** Names this extension deliberately replaces. Absent means a clash throws. */
  readonly replaces?: readonly string[]
  /**
   * Re-emit attributes the spec does not model. Defaults to true.
   *
   * Adding a node or mark type strictly *reduces* fidelity for the tag it
   * claims: before the type existed, the preservation layer kept the element
   * and every attribute on it; afterwards the spec keeps only what it declares.
   * A callout node modelling `class` silently drops `id` and `data-analytics`
   * that used to survive, and a `strong` mark used to drop `class` the same way.
   *
   * So unmodelled attributes are captured on parse and merged back on
   * serialize, by default, at schema-build time -- which means an author cannot
   * opt out by forgetting.
   *
   * ## Setting this to `false` is security-relevant
   *
   * The capture is also where `on*` handlers and unsafe URL schemes are
   * filtered out of the residue -- see `withCarriedAttributes` below. Turning
   * the carry off skips the wrapper entirely, and with it that filter, so a
   * spec's own `getAttrs` becomes the only thing standing between pasted
   * `onclick` and the stored document.
   *
   * It exists for specs that already model every attribute they claim, where
   * carrying would emit the same value twice. It is not a performance knob, and
   * a plugin that sets it is making a decision `SECURITY.md` documents under
   * "Plugin trust model". If you set it, your `getAttrs` owns the scrub.
   */
  readonly carryUnknownAttributes?: boolean
}

/** Where carried attributes live. Underscored: it is not for plugin authors. */
export const CARRIED_ATTR = '__openleafCarried'

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

const extensions = new Map<string, SchemaExtension>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('@openleaf-editor/core: a schema-extension listener threw', error)
    }
  }
}

/**
 * Register a schema extension.
 *
 * Must happen before the editor that should have it is constructed. The element
 * defers building its view until the document's scripts have run, which covers
 * every documented integration; anything registering later applies to editors
 * created after it, not to open ones.
 */
export function registerSchemaExtension(extension: SchemaExtension): () => void {
  if (extensions.has(extension.id)) {
    console.warn(
      `@openleaf-editor/core: schema extension "${extension.id}" is already registered. ` +
        'The second registration was ignored.',
    )
    return () => undefined
  }
  // Build the schema this registration would produce, and throw here if it does
  // not build. Without this the collision still threw -- but on some later,
  // unrelated `coreSchema()` call, with a stack pointing at whichever editor
  // happened to be constructed next rather than at the extension that clashed.
  createSchema([...extensions.values(), extension])
  extensions.set(extension.id, extension)
  notify()
  return () => {
    // Removing an extension cannot un-extend a schema that is already built --
    // a document may contain its nodes. It affects editors created afterwards.
    if (extensions.delete(extension.id)) notify()
  }
}

export function registeredSchemaExtensions(): readonly SchemaExtension[] {
  return [...extensions.values()]
}

export function onSchemaExtensionsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Testing seam. Not part of the public API. */
export function clearSchemaExtensions(): void {
  extensions.clear()
  notify()
}

/* ------------------------------------------------------------------ *
 * Carrying unmodelled attributes
 * ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Residue a spec has already encoded into a modelled attribute, and so must not
 * carry a second copy of.
 *
 * `code_block` reads `language-js` from either `<pre>` or `<code>` and re-emits
 * it on `<code>` -- read both, write one. Carrying the `<pre>`'s class verbatim
 * writes it twice, so the language token is dropped from the residue while any
 * other class the author put there is kept. Keyed by node name because the
 * overlap is a property of the spec, not of the attribute.
 */
/**
 * Per-node reconciliation between what a spec read and what is left over.
 *
 * Takes the element as well as the residue, because the two directions this has
 * to go are opposite. Usually a spec CONSUMED something and the residue must
 * lose its copy, so the fact is written once. But a spec can also REFUSE a
 * value -- `safeId` rejects `<h2 id="Bad Id">` because an id may not contain a
 * space -- and the modelled attribute is then null while the carry loop has
 * already skipped the name as "modelled". The attribute vanished from both
 * places at once, which is how validating a value turned into deleting it. Given
 * the element, a hook can put the original back into the residue, where an
 * unrepresentable value has always belonged.
 */
type CarryScrub = (carried: Record<string, string>, dom: HTMLElement) => void

/**
 * Put an attribute back into the residue when the spec's validator refused it.
 *
 * `accepted` is asked rather than assumed, because the two outcomes need
 * opposite treatment and only the validator can tell them apart. A value the
 * spec took is re-emitted from the modelled attribute and must NOT also sit in
 * the residue, or it goes out twice. A value the spec refused is not re-emitted
 * at all, and carrying it is the difference between "we would not store that as
 * an id" -- which is our business -- and "so we deleted it", which is not.
 */
function carryRejected(
  carried: Record<string, string>,
  dom: HTMLElement,
  name: string,
  accepted: (value: string) => boolean,
): void {
  const value = dom.getAttribute(name)
  if (value === null || accepted(value)) return
  carried[name] = value
}

const CARRY_SCRUB: Record<string, CarryScrub> = {
  code_block(carried) {
    const cls = carried['class']
    if (cls === undefined) return
    const kept = cls.split(/\s+/).filter((c) => c && !/^(?:language|lang)-/i.test(c))
    if (kept.length > 0) carried['class'] = kept.join(' ')
    else delete carried['class']
  },
  paragraph: scrubModelledStyle,
  heading(carried, dom) {
    scrubModelledStyle(carried)
    carryRejected(carried, dom, 'id', (value) => safeId(value) !== null)
  },
  bullet_list: scrubModelledStyle,
  ordered_list(carried, dom) {
    scrubModelledStyle(carried)
    carryRejected(carried, dom, 'start', (value) => listStart(value) !== null)
  },
  link(carried, dom) {
    carryRejected(carried, dom, 'id', (value) => safeId(value) !== null)
  },
  // Tables model a handful of declarations out of a `style` attribute they also
  // declare as an attribute of their own. The scrubs are defined next to the
  // validator that decides what "modelled" means for them, so the two cannot
  // drift into either dropping a declaration twice or keeping it twice.
  ...CARRIED_STYLE_SCRUBS,
}

/**
 * Drop the declarations a text block now models from its carried residue.
 *
 * `text-align` is the node's own `align` attribute, line height and indent are
 * modelled the same way, and colour and font are marks, so carrying any of them
 * a second time emits both spellings of the same intent. The legacy `align`
 * attribute goes for the same reason.
 *
 * Anything else in the attribute stays. A paragraph stored as
 * `style="letter-spacing:0.05em;text-align:left"` keeps its letter-spacing.
 */
function scrubModelledStyle(carried: Record<string, string>): void {
  delete carried['align']
  delete carried['type']
  const style = carried['style']
  if (style === undefined) return
  const declarations = parseDeclarations(style)
  const before = declarations.size
  for (const name of MODELLED_PROPERTIES) declarations.delete(name)
  // Indent aliases consumed into the `indent` attribute. Only dropped when they
  // actually parsed as an indent; `padding-left:3px` is not one and must stay.
  for (const name of ['padding-left', 'margin-left', 'margin-inline-start'] as const) {
    const value = declarations.get(name)
    if (value !== undefined && indentLevels(value) !== null) declarations.delete(name)
  }
  // Nothing was consumed, so there is nothing to rewrite. Re-serializing anyway
  // would re-spell a declaration the schema does not model, which is the thing
  // this whole mechanism exists to avoid: `letter-spacing: 0.08em;` is the
  // author's, and `letter-spacing:0.08em` is ours.
  if (declarations.size === before) return
  const rest = serializeDeclarations(declarations)
  if (rest !== null) carried['style'] = rest
  else delete carried['style']
}

/**
 * Word's `mso-*` properties, removed from residue on the way in.
 *
 * These are the one exception to "carry every declaration the schema does not
 * model", and it needs arguing because the default is so strongly the other way.
 * `mso-list:l0 level1 lfo1` is not CSS: it is Microsoft Office document-format
 * metadata that happens to travel in a `style` attribute, and no engine renders
 * it. Carrying it would mean the editor re-emitting Word debris it used to
 * clean, on every save, forever -- "pasting a wall of vendor styling into the
 * document" is the failure the paste pipeline exists to prevent, and the schema
 * should not reintroduce it from behind.
 *
 * It used to be removed by accident: a spec array's `style` went out through
 * `dom.style.cssText`, and the CSSOM silently discards any property it cannot
 * parse. That filter was never intentional and was never safe -- it also
 * discarded valid CSS that a given engine did not happen to know -- so it is
 * gone (see the array branch of `withCarriedAttributes`), and what was worth
 * keeping about it is stated here instead, narrowly and on purpose.
 *
 * Returns the string unchanged when there is nothing to remove, so a residue
 * with no Office metadata in it keeps the author's exact spelling.
 */
function withoutOfficeMetadata(style: string): string | null {
  if (!/(?:^|[;\s])mso-/i.test(style)) return style
  const declarations = parseDeclarations(style)
  for (const name of [...declarations.keys()]) {
    if (name.startsWith('mso-')) declarations.delete(name)
  }
  return serializeDeclarations(declarations)
}

/**
 * Merge carried residue with the attributes a spec produced.
 *
 * Modelled attributes win, because the spec is the authority on the names it
 * declared -- except for `style`, where winning wholesale is a content-loss bug.
 * A paragraph whose stored style was `letter-spacing:0.05em;text-align:left`
 * has the letter-spacing in its residue and the alignment in its `align`
 * attribute; a plain object spread replaces the residue's `style` with the
 * spec's and the letter-spacing is gone. So `style` is merged one declaration
 * at a time, residue first so the modelled value overrides a stale copy of itself.
 */
/**
 * Merge carried residue onto an element a spec built for itself.
 *
 * The array path below cannot cover this case, and it is not hypothetical: a
 * paragraph carrying CSS returns a real element from `toDOM` so that its `style`
 * attribute is not rewritten by the CSSOM. That element has to be given the
 * residue too, or modelling `text-align` would silently drop the `letter-spacing`
 * next to it -- the exact loss the carry mechanism exists to prevent,
 * reintroduced from a new direction.
 */
function applyCarriedToElement(el: Element, carried: Record<string, string>): void {
  for (const [name, value] of Object.entries(carried)) {
    if (name === 'style') {
      const own = parseDeclarations(el.getAttribute('style'))
      // Nothing of the spec's own to merge with, so the residue goes out exactly
      // as it was stored. Round-tripping it through the declaration parser would
      // re-spell CSS the schema does not model, for no gain -- and the whole
      // reason this branch exists rather than letting the serializer do it is to
      // stop the author's spelling being rewritten.
      if (own.size === 0) {
        applyStyleAttribute(el, value)
        continue
      }
      const declarations = parseDeclarations(value)
      // Residue first, then what the spec wrote, so a modelled declaration wins
      // over a stale copy of itself while everything else survives.
      for (const [property, css] of own) declarations.set(property, css)
      const style = serializeDeclarations(declarations)
      if (style !== null) applyStyleAttribute(el, style)
      continue
    }
    // A spec's own attributes win: it is the authority on the names it declared.
    if (!el.hasAttribute(name)) el.setAttribute(name, value)
  }
}

function mergeCarried(
  carried: Record<string, string>,
  modelled: Record<string, unknown>,
): Record<string, unknown> {
  // Modelled names first so `<a href>` stays `href` then `class`, not the
  // reverse -- residue used to be spread first and HTML attribute order is
  // load-bearing for byte-identical round trips.
  const merged: Record<string, unknown> = { ...modelled }
  for (const [name, value] of Object.entries(carried)) {
    if (name === 'style' && typeof merged['style'] === 'string') {
      const declarations = parseDeclarations(value)
      for (const [property, css] of parseDeclarations(merged['style'] as string)) {
        declarations.set(property, css)
      }
      const style = serializeDeclarations(declarations)
      if (style !== null) merged['style'] = style
      else delete merged['style']
      continue
    }
    if (!(name in modelled)) merged[name] = value
  }
  return merged
}

/**
 * Wrap a spec so attributes it does not model survive the round trip.
 *
 * Applied to extension nodes and marks unless they opt out: they only ever
 * claim markup the preservation layer previously kept in full, so carrying the
 * residue is a pure improvement over the alternative of silently dropping it.
 *
 * Style parse rules are left alone. They match a declaration, not an element,
 * so there is no attribute list to harvest -- and wrapping them would pass a
 * CSS string into a collector that expects `HTMLElement.attributes`.
 */
function isTagParseRule(rule: ParseRule): rule is TagParseRule {
  return typeof (rule as TagParseRule).tag === 'string'
}

function withCarriedAttributes<T extends NodeSpec | MarkSpec>(
  name: string,
  spec: T,
  kind: 'node' | 'mark',
): T {
  const modelled = new Set(Object.keys(spec.attrs ?? {}))
  const attrs = { ...(spec.attrs ?? {}), [CARRIED_ATTR]: { default: null } }

  const parseDOM = (spec.parseDOM ?? []).map((rule: ParseRule): ParseRule => {
    if (!isTagParseRule(rule)) return rule
    const original = rule.getAttrs
    return {
      ...rule,
      getAttrs(dom: HTMLElement) {
        const base = original ? original.call(rule, dom) : ((rule.attrs ?? {}) as Record<string, unknown>)
        /*
         * Only `false` is a decline.
         *
         * `null` and `undefined` are ProseMirror's "this rule matches, with the
         * type's default attributes" -- a very different statement, and treating
         * them as a decline meant the wrapper handed the element straight back
         * with no residue at all. `<hr class="page-rule" id="sep">` came back as
         * a bare `<hr>`, because `horizontal_rule`'s rule returns `null` for
         * every rule that is not a page break. Every attribute on the element,
         * gone, from a branch that reads like a guard.
         */
        if (base === false) return false
        const carried: Record<string, string> = {}
        for (const attr of Array.from(dom.attributes ?? [])) {
          // `style` is never treated as modelled, even by a spec that declares
          // an attribute of that name. It is the one COMPOSITE attribute in
          // HTML: a node models individual declarations, not the whole string,
          // so "the spec claimed it" is not the same statement it is for `class`
          // or `colspan`. Table cells declare `style` and keep two properties
          // out of it, and the skip below therefore threw away everything else
          // with no residue at all -- `<td style="border:1px solid red">` came
          // back as `<td>`, and `border` and `border-collapse` are how fifteen
          // years of CMS tables are styled. The declarations a spec really did
          // consume are removed by that node's CARRY_SCRUB instead, which is
          // already how `<p style="text-align:center">` avoids being emitted
          // twice.
          // Before every other test, because it is the only one about whether
          // the attribute can exist at all. The HTML parser accepts names
          // `setAttribute` refuses -- `<p ="v">` parses to an attribute named
          // `="v"` -- and carrying one meant the throw landed later, in the
          // middle of rendering the document, from a name no author wrote.
          if (!isWritableAttributeName(attr.name)) continue
          if (attr.name !== 'style' && modelled.has(attr.name)) continue
          // Same scrub as the preservation layer: carrying `onclick` or a
          // `javascript:` URL would reintroduce exactly the executable content
          // core promises to drop.
          if (isEventHandlerAttribute(attr.name)) continue
          // Markup-bearing attributes are refused outright rather than
          // scheme-checked. This path never reaches scrub(): the iframe node
          // claims an allowlisted player, and `srcdoc` -- which the HTML spec
          // gives precedence over `src` -- rode in here as residue, so the
          // frame rendered the attacker's document and never fetched YouTube.
          if (isNeverCarriedAttribute(attr.name)) continue
          if (URL_ATTRIBUTES.has(attr.name.toLowerCase()) && !isSafeUrl(attr.value)) continue
          // Google Docs wraps a paste in `<b id="docs-internal-guid-...">`.
          // The paste pipeline strips that id; this is the schema-level
          // backstop on the `strong` mark that claims that wrapper -- not on
          // every node, or `<p id="docs-internal-guidelines">` would lose a
          // legitimate id.
          if (
            kind === 'mark' &&
            name === 'strong' &&
            attr.name === 'id' &&
            /^docs-internal-guid/i.test(attr.value)
          ) {
            continue
          }
          if (attr.name === 'style') {
            let css = withoutOfficeMetadata(attr.value)
            if (css !== null && kind === 'mark') {
              const declarations = parseDeclarations(css)
              for (const property of INLINE_STYLE_PROPERTIES) {
                declarations.delete(property)
              }
              css = serializeDeclarations(declarations)
            }
            if (css !== null) carried['style'] = css
            continue
          }
          carried[attr.name] = attr.value
        }
        CARRY_SCRUB[name]?.(carried, dom)
        return {
          ...((base ?? {}) as Record<string, unknown>),
          [CARRIED_ATTR]: Object.keys(carried).length > 0 ? carried : null,
        }
      },
    }
  })

  const originalToDOM = spec.toDOM
  const toDOM = originalToDOM
    ? (first: { attrs: Record<string, unknown> }, ...rest: unknown[]) => {
        const out = (originalToDOM as (
          first: { attrs: Record<string, unknown> },
          ...rest: unknown[]
        ) => DOMOutputSpec)(first, ...rest)
        const carried = first.attrs[CARRIED_ATTR] as Record<string, string> | null
        if (!carried) return out
        if (!Array.isArray(out)) {
          // `{ dom, contentDOM }`, or a bare node. Both are legal output specs and
          // both mean the spec built its own element.
          const dom = isPlainObject(out) ? (out as { dom?: unknown }).dom : out
          if (dom instanceof Element) applyCarriedToElement(dom, carried)
          return out
        }
        /*
         * Residue holding CSS cannot go out on a spec array.
         *
         * prosemirror-model writes a spec array's `style` with
         * `dom.style.cssText = value`, which is a CSSOM parse and therefore a
         * rewrite: `margin-bottom:0` comes back `margin-bottom: 0px`. `0` to
         * `0px` is a change to the VALUE, not just the spelling, and it happens
         * to every paragraph carrying an unmodelled declaration on its first
         * save. css.ts argues at length that silently rewriting an archive's CSS
         * is not a diff this project gets to put in a revision history;
         * `applyStyleAttribute` exists to prevent exactly this and was reachable
         * only from the element path.
         *
         * So when -- and only when -- there is CSS to carry, the array is
         * rendered here and the residue applied to the real element, which is
         * the same route `elementWithStyle` in schema.ts already takes. Specs
         * with no CSS residue keep the cheaper array path.
         */
        if (typeof carried['style'] === 'string') {
          const rendered = DOMSerializer.renderSpec(serializationTarget(), out)
          applyCarriedToElement(rendered.dom, carried)
          return (rendered.contentDOM ? rendered : rendered.dom) as unknown as DOMOutputSpec
        }
        const result = [...out] as unknown[]
        if (isPlainObject(result[1])) {
          result[1] = mergeCarried(carried, result[1] as Record<string, unknown>)
        } else {
          result.splice(1, 0, carried)
        }
        return result as unknown as DOMOutputSpec
      }
    : originalToDOM

  return { ...spec, attrs, parseDOM, ...(toDOM ? { toDOM } : {}) } as T
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

function assertRulePriorities(extensionId: string, name: string, spec: NodeSpec | MarkSpec): void {
  for (const rule of (spec.parseDOM ?? []) as ParseRule[]) {
    if (rule.priority !== undefined && rule.priority <= 1) {
      throw new OpenLeafError(
        'invalid-argument',
        `@openleaf-editor/core: extension "${extensionId}" gives "${name}" a parse rule at ` +
          `priority ${rule.priority}. The preservation layer's catch-all rules sit at ` +
          'priority 0 and 1, so this rule would tie with them and the winner would be ' +
          'decided by insertion order. Remove the priority: the default already wins.',
      )
    }
  }
}

function claim(
  claimed: Map<string, string>,
  kind: 'node' | 'mark',
  name: string,
  extension: SchemaExtension,
  existsInCore: boolean,
): void {
  const replaces = new Set(extension.replaces ?? [])
  const previous = claimed.get(`${kind}:${name}`)

  if (previous && !replaces.has(name)) {
    throw new OpenLeafError(
      'schema-conflict',
      `@openleaf-editor/core: extensions "${previous}" and "${extension.id}" both define the ` +
        `${kind} "${name}". A ${kind} type is a storage format, not a preference: two ` +
        'definitions mean two serializations of the same content chosen by load order. ' +
        `If replacing it is intended, declare replaces: ['${name}'].`,
    )
  }
  if (existsInCore && !replaces.has(name)) {
    throw new OpenLeafError(
      'schema-conflict',
      `@openleaf-editor/core: extension "${extension.id}" defines the ${kind} "${name}", which ` +
        `already exists in the base schema. If replacing it is intended, declare ` +
        `replaces: ['${name}'].`,
    )
  }
  claimed.set(`${kind}:${name}`, extension.id)
}

/**
 * Build a schema from the base types plus these extensions.
 *
 * Pure: it reads no registry. That is deliberate -- a registry-reading default
 * would make the fidelity suite depend on whichever other test file happened to
 * register an extension first.
 */
/**
 * Node types whose attributes are already the whole story — wrapping them
 * would duplicate markup (unknown_*) or add a phantom attr to nodes that
 * never parse from the DOM (doc, text).
 */
const SKIP_CARRY = new Set(['doc', 'text', 'unknown_block', 'unknown_inline'])

function coreNodesWithCarriedAttributes(): OrderedMap<NodeSpec> {
  // Claimed tags used to drop every attribute they do not model. Extension
  // nodes already carry the residue; core nodes were the remaining hole, and
  // it is how `<p class="lead">` became `<p>` on the first save.
  let nodes = OrderedMap.from<NodeSpec>({})
  for (const [name, spec] of Object.entries(coreNodes)) {
    nodes = nodes.addToEnd(name, SKIP_CARRY.has(name) ? spec : withCarriedAttributes(name, spec, 'node'))
  }
  return nodes
}

function coreMarksWithCarriedAttributes(): OrderedMap<MarkSpec> {
  // The same hole as core nodes, on the other half of the schema: `<strong
  // class="brand-name">` became `<strong>` because a mark spec kept the tag and
  // nothing else, and the carry wrapper never ran.
  let marks = OrderedMap.from<MarkSpec>({})
  for (const [name, spec] of Object.entries(coreMarks)) {
    marks = marks.addToEnd(name, withCarriedAttributes(name, spec, 'mark'))
  }
  return marks
}

export function createSchema(list: readonly SchemaExtension[] = []): Schema {
  let nodes = coreNodesWithCarriedAttributes()
  let marks = coreMarksWithCarriedAttributes()
  const claimed = new Map<string, string>()

  for (const extension of list) {
    for (const [name, spec] of Object.entries(extension.nodes ?? {})) {
      assertRulePriorities(extension.id, name, spec)
      claim(claimed, 'node', name, extension, Object.hasOwn(coreNodes, name))
      const prepared = extension.carryUnknownAttributes === false
        ? spec
        : withCarriedAttributes(name, spec, 'node')
      // addToEnd, never prepend: a leading block node becomes the document's
      // defaultType and every new document would start with it.
      nodes = nodes.remove(name).addToEnd(name, prepared)
    }

    for (const [name, spec] of Object.entries(extension.marks ?? {})) {
      assertRulePriorities(extension.id, name, spec)
      claim(claimed, 'mark', name, extension, Object.hasOwn(coreMarks, name))
      const prepared = extension.carryUnknownAttributes === false
        ? spec
        : withCarriedAttributes(name, spec, 'mark')
      marks = marks.remove(name).addToEnd(name, prepared)
    }
  }

  return new Schema({ nodes, marks })
}

let cached: Schema | null = null
let subscribed = false

/**
 * The schema for the currently registered extensions.
 *
 * A function rather than a constant, and this is the point: a `const` reads as
 * "bind to this" and would be captured at import by every consumer, which is
 * exactly what made the schema impossible to extend. Memoized, and invalidated
 * whenever the registry changes.
 *
 * ## Why the subscription is in here and not at module scope
 *
 * This package declares `"sideEffects": false`, which is a literal promise that
 * evaluating a module for its own sake changes nothing observable. The bare
 * top-level `onSchemaExtensionsChange(() => { cached = null })` that used to sit
 * below this function broke that promise: it mutates the listener set in the
 * registry above, which is observable by anything that calls `notify()`.
 *
 * What it did *not* do, measured rather than assumed, is actually get dropped.
 * Both rollup 4 (`treeshake.moduleSideEffects: false`) and webpack 5
 * (`optimization.sideEffects`) keep the statement, because the arrow function
 * writes `cached` and `cached` is read by this function -- so the tree-shaker
 * can see the statement contributes to a live export and retains it. A probe
 * that warms the memo, registers an extension and re-reads the schema returns
 * the plugin's node type under both bundlers, before and after this change.
 *
 * It is moved anyway, because the retention depended entirely on that linkage
 * being visible. It is not a property of the invalidator; it is a property of
 * this particular pair of statements, and it would quietly stop holding the
 * moment the memo is refactored -- at which point the failure is silent and
 * total, since `coreSchema()` would keep handing back a schema built before the
 * first `registerSchemaExtension` call. Registering on the first call costs a
 * boolean and makes the flag true instead of true-by-luck.
 *
 * There is no window in which the invalidator is missing: the subscription is
 * installed before the value it guards ever exists, and nothing can reach the
 * memo except through here.
 */
export function coreSchema(): Schema {
  if (!subscribed) {
    subscribed = true
    onSchemaExtensionsChange(() => {
      cached = null
    })
  }
  if (!cached) cached = createSchema(registeredSchemaExtensions())
  return cached
}
