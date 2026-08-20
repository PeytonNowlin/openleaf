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
  Schema,
  type DOMOutputSpec,
  type MarkSpec,
  type NodeSpec,
  type ParseRule,
  type TagParseRule,
} from 'prosemirror-model'
import {
  MODELLED_PROPERTIES,
  applyStyleAttribute,
  indentLevels,
  parseDeclarations,
  serializeDeclarations,
} from './css.js'
import { coreMarks, coreNodes } from './schema.js'
import { URL_ATTRIBUTES, isEventHandlerAttribute, isSafeUrl } from './url.js'

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
   * Adding a node type strictly *reduces* fidelity for the tag it claims: before
   * the node existed, the preservation layer kept the element and every
   * attribute on it; afterwards the spec keeps only what it declares. A callout
   * node modelling `class` silently drops `id` and `data-analytics` that used to
   * survive.
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
const CARRY_SCRUB: Record<string, (carried: Record<string, string>) => void> = {
  code_block(carried) {
    const cls = carried['class']
    if (cls === undefined) return
    const kept = cls.split(/\s+/).filter((c) => c && !/^(?:language|lang)-/i.test(c))
    if (kept.length > 0) carried['class'] = kept.join(' ')
    else delete carried['class']
  },
  paragraph: scrubModelledStyle,
  heading: scrubModelledStyle,
  bullet_list: scrubModelledStyle,
  ordered_list: scrubModelledStyle,
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
  for (const name of MODELLED_PROPERTIES) declarations.delete(name)
  // Indent aliases consumed into the `indent` attribute. Only dropped when they
  // actually parsed as an indent; `padding-left:3px` is not one and must stay.
  for (const name of ['padding-left', 'margin-left', 'margin-inline-start'] as const) {
    const value = declarations.get(name)
    if (value !== undefined && indentLevels(value) !== null) declarations.delete(name)
  }
  const rest = serializeDeclarations(declarations)
  if (rest !== null) carried['style'] = rest
  else delete carried['style']
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
      const declarations = parseDeclarations(value)
      // Residue first, then what the spec wrote, so a modelled declaration wins
      // over a stale copy of itself while everything else survives.
      for (const [property, css] of parseDeclarations(el.getAttribute('style'))) {
        declarations.set(property, css)
      }
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
  const merged: Record<string, unknown> = { ...carried, ...modelled }
  const before = carried['style']
  const after = modelled['style']
  if (typeof before === 'string' && typeof after === 'string') {
    const declarations = parseDeclarations(before)
    for (const [name, value] of parseDeclarations(after)) declarations.set(name, value)
    const style = serializeDeclarations(declarations)
    if (style !== null) merged['style'] = style
    else delete merged['style']
  }
  return merged
}

/**
 * Wrap a node spec so attributes it does not model survive the round trip.
 *
 * Applied to extension nodes unconditionally: they only ever claim markup the
 * preservation layer previously kept in full, so carrying the residue is a pure
 * improvement over the alternative of silently dropping it.
 */
function withCarriedAttributes(name: string, spec: NodeSpec): NodeSpec {
  const modelled = new Set(Object.keys(spec.attrs ?? {}))
  const attrs = { ...(spec.attrs ?? {}), [CARRIED_ATTR]: { default: null } }

  // A node's parse rules are always tag rules -- only marks may match styles --
  // so the narrower type is the accurate one and keeps the map total.
  const parseDOM = (spec.parseDOM ?? []).map((rule: TagParseRule): TagParseRule => {
    const original = rule.getAttrs
    return {
      ...rule,
      getAttrs(dom: HTMLElement) {
        const base = original ? original.call(rule, dom) : ((rule.attrs ?? {}) as Record<string, unknown>)
        if (base === false || base === null || base === undefined) return base as false | null
        const carried: Record<string, string> = {}
        for (const attr of Array.from(dom.attributes ?? [])) {
          if (modelled.has(attr.name)) continue
          // Same scrub as the preservation layer: carrying `onclick` or a
          // `javascript:` URL would reintroduce exactly the executable content
          // core promises to drop.
          if (isEventHandlerAttribute(attr.name)) continue
          if (URL_ATTRIBUTES.has(attr.name.toLowerCase()) && !isSafeUrl(attr.value)) continue
          carried[attr.name] = attr.value
        }
        CARRY_SCRUB[name]?.(carried)
        return {
          ...(base as Record<string, unknown>),
          [CARRIED_ATTR]: Object.keys(carried).length > 0 ? carried : null,
        }
      },
    }
  })

  const originalToDOM = spec.toDOM
  const toDOM: NodeSpec['toDOM'] = originalToDOM
    ? (node) => {
        const out = originalToDOM(node)
        const carried = node.attrs[CARRIED_ATTR] as Record<string, string> | null
        if (!carried) return out
        if (!Array.isArray(out)) {
          // `{ dom, contentDOM }`, or a bare node. Both are legal output specs and
          // both mean the spec built its own element.
          const dom = isPlainObject(out) ? (out as { dom?: unknown }).dom : out
          if (dom instanceof Element) applyCarriedToElement(dom, carried)
          return out
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

  return { ...spec, attrs, parseDOM, ...(toDOM ? { toDOM } : {}) }
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

function assertRulePriorities(extensionId: string, name: string, spec: NodeSpec | MarkSpec): void {
  for (const rule of (spec.parseDOM ?? []) as ParseRule[]) {
    if (rule.priority !== undefined && rule.priority <= 1) {
      throw new Error(
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
    throw new Error(
      `@openleaf-editor/core: extensions "${previous}" and "${extension.id}" both define the ` +
        `${kind} "${name}". A ${kind} type is a storage format, not a preference: two ` +
        'definitions mean two serializations of the same content chosen by load order. ' +
        `If replacing it is intended, declare replaces: ['${name}'].`,
    )
  }
  if (existsInCore && !replaces.has(name)) {
    throw new Error(
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
    nodes = nodes.addToEnd(name, SKIP_CARRY.has(name) ? spec : withCarriedAttributes(name, spec))
  }
  return nodes
}

export function createSchema(list: readonly SchemaExtension[] = []): Schema {
  let nodes = coreNodesWithCarriedAttributes()
  let marks = OrderedMap.from<MarkSpec>(coreMarks)
  const claimed = new Map<string, string>()

  for (const extension of list) {
    for (const [name, spec] of Object.entries(extension.nodes ?? {})) {
      assertRulePriorities(extension.id, name, spec)
      claim(claimed, 'node', name, extension, Object.hasOwn(coreNodes, name))
      const prepared = extension.carryUnknownAttributes === false
        ? spec
        : withCarriedAttributes(name, spec)
      // addToEnd, never prepend: a leading block node becomes the document's
      // defaultType and every new document would start with it.
      nodes = nodes.remove(name).addToEnd(name, prepared)
    }

    for (const [name, spec] of Object.entries(extension.marks ?? {})) {
      assertRulePriorities(extension.id, name, spec)
      claim(claimed, 'mark', name, extension, Object.hasOwn(coreMarks, name))
      marks = marks.remove(name).addToEnd(name, spec)
    }
  }

  return new Schema({ nodes, marks })
}

let cached: Schema | null = null

/**
 * The schema for the currently registered extensions.
 *
 * A function rather than a constant, and this is the point: a `const` reads as
 * "bind to this" and would be captured at import by every consumer, which is
 * exactly what made the schema impossible to extend. Memoized, and invalidated
 * whenever the registry changes.
 */
export function coreSchema(): Schema {
  if (!cached) cached = createSchema(registeredSchemaExtensions())
  return cached
}

onSchemaExtensionsChange(() => {
  cached = null
})
