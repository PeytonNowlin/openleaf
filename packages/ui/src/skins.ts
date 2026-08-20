/**
 * Skins.
 *
 * ## What a skin is here, and why it is not what TinyMCE means
 *
 * TinyMCE ships skins as directories of compiled CSS that replace the editor's
 * stylesheet wholesale. That is powerful and it is also why upgrading TinyMCE
 * can break a custom skin: the skin knows the editor's internal class names, so
 * every internal rename is a breaking change for anyone who wrote one.
 *
 * A skin here is **a block of custom properties and nothing else**. It cannot
 * reference an internal class, so it cannot be broken by an internal rename --
 * which is the whole reason the token API exists. The cost is that a skin cannot
 * restructure the toolbar; it can only restyle it. That trade is deliberate: a
 * theme that survives upgrades is worth more than one that can move a button.
 *
 * Anything a skin can do, an integrator can do inline by setting the same
 * properties. Skins exist so a look can be *named, shared and switched*, not to
 * unlock capability.
 *
 * ## The one thing a skin declares that is not a property
 *
 * `scheme`. Some of what an editor looks like is decided by the browser rather
 * than by us -- the popup a native `select` opens, scrollbar chrome, the syntax
 * palette in the opt-in highlighting bundle -- and none of it reads custom
 * properties. Those follow the *colour scheme*, so a skin that replaces the
 * surface has to say which scheme its palette belongs to or they keep following
 * the visitor's system and contradict it. That is one declared word, not a
 * selector, so the guarantee above is intact.
 */

import { registerStyles } from './styles.js'

export interface Skin {
  /** Used in the `skin` attribute and `applySkin`. */
  name: string
  /** Shown in a picker. */
  label: string
  /** Custom-property declarations. No selectors -- they are scoped for you. */
  tokens: string
  /**
   * Which world this skin's palette lives in. Omit for a skin that does not
   * set `--openleaf-color-surface` -- a density skin, or one that only brands
   * the accent.
   *
   * A skin that sets the surface has taken the palette over: it looks the same
   * whether the visitor's system is light or dark, which is the point, and it
   * therefore also decides which world everything keyed off the *scheme* rather
   * than off a token belongs to. That is not a small list -- syntax
   * highlighting, native `select` popups, scrollbars, form control chrome --
   * and none of it can be expressed as a custom property.
   *
   * Undeclared, those follow the system instead, which is how a light skin ends
   * up with a dark code block on a machine set to dark: exactly the bug this
   * field exists to make unrepresentable.
   */
  scheme?: 'light' | 'dark'
}

/**
 * Built-in skins.
 *
 * Each sets the full palette rather than patching a few values, so a skin looks
 * the same whether the visitor's system is in light or dark mode. A skin that
 * only overrode two tokens would inherit the rest from whichever scheme happened
 * to be active, which is how a carefully chosen palette ends up with one
 * unreadable colour on somebody else's laptop.
 */
export const BUILT_IN_SKINS: readonly Skin[] = [
  {
    name: 'midnight',
    label: 'Midnight',
    scheme: 'dark',
    tokens: `
      --openleaf-color-text: #e6edf3;
      --openleaf-color-text-muted: #9198a1;
      --openleaf-color-surface: #0d1117;
      --openleaf-color-surface-hover: #21262d;
      --openleaf-color-surface-active: #1f3a5f;
      --openleaf-color-border: #3d444d;
      --openleaf-color-border-strong: #8b949e;
      --openleaf-color-accent: #79c0ff;
      --openleaf-color-focus: #79c0ff;
      --openleaf-color-danger: #ff8182;
    `,
  },
  {
    name: 'paper',
    label: 'Paper',
    scheme: 'light',
    tokens: `
      --openleaf-color-text: #2b2621;
      --openleaf-color-text-muted: #6b6157;
      --openleaf-color-surface: #fbf7f0;
      --openleaf-color-surface-hover: #f0e9dd;
      --openleaf-color-surface-active: #e6dcc8;
      --openleaf-color-border: #d8cdb9;
      --openleaf-color-border-strong: #7d7364;
      --openleaf-color-accent: #8a5a20;
      --openleaf-color-focus: #8a5a20;
      --openleaf-radius: 2px;
    `,
  },
  {
    /*
     * Not a style preference. Every pair here clears WCAG 1.4.3 for body text
     * and 1.4.11 for the control boundaries, and the focus ring is thickened
     * rather than merely recoloured -- colour alone is what fails first for
     * someone who needs this skin.
     */
    name: 'contrast',
    label: 'High contrast',
    scheme: 'light',
    tokens: `
      --openleaf-color-text: #000000;
      --openleaf-color-text-muted: #1a1a1a;
      --openleaf-color-surface: #ffffff;
      --openleaf-color-surface-hover: #e8e8e8;
      --openleaf-color-surface-active: #d0d0d0;
      --openleaf-color-border: #000000;
      /* Set explicitly, and not because the default would fail: it would leave
         this skin's control boundaries at the shared 4.55:1 fallback while its
         decorative ones sat at 21:1, which is this skin backwards. */
      --openleaf-color-border-strong: #000000;
      --openleaf-color-accent: #0000c0;
      --openleaf-color-focus: #0000c0;
      --openleaf-color-danger: #a40e26;
      --openleaf-focus-width: 3px;
      --openleaf-focus-offset: 2px;
    `,
  },
  {
    /*
     * Density, not colour -- so it composes with any of the others, and so it
     * declares no `scheme`: it has no opinion about the palette and must not
     * override whichever one is already in force. The button stays at 28px
     * because WCAG 2.2 SC 2.5.8 asks for 24 CSS px minimum and "compact" is not
     * a licence to go under it.
     */
    name: 'compact',
    label: 'Compact',
    tokens: `
      --openleaf-button-size: 28px;
      --openleaf-icon-size: 14px;
      --openleaf-gap: 1px;
      --openleaf-font-size: 13px;
      --openleaf-radius: 3px;
    `,
  },
]

/*
 * Built lazily, and that is a bundling decision rather than a performance one.
 *
 * `new Map(BUILT_IN_SKINS.map(...))` at module scope is a constructor call a
 * tree-shaker cannot prove is pure, so the statement is retained -- and with it
 * this whole module, and `styles.js` which it imports from. The cost landed on
 * every consumer of the barrel: `import { t }` from `@openleaf-editor/ui` -- a
 * 183-byte function with no imports of its own -- dragged the skin table and the
 * stylesheet machinery in behind it.
 *
 * Deferring the construction to first use makes every top-level binding in this
 * module a plain literal, so a bundler can drop the module entirely when nothing
 * reaches for a skin. Nothing observable changes: `registry()` is called by every
 * entry point below before it touches the table.
 */
let skins: Map<string, Skin> | null = null

function registry(): Map<string, Skin> {
  if (!skins) skins = new Map<string, Skin>(BUILT_IN_SKINS.map((skin) => [skin.name, skin]))
  return skins
}

let installedSheet = ''

function css(): string {
  return [...registry().values()]
    .map((skin) => `.ol-editor[data-ol-skin="${skin.name}"] {${skin.tokens}}`)
    .join('\n')
}

/** Install the skin stylesheet. Re-run when a skin is added. */
function sync(doc?: Document): void {
  const next = css()
  if (next === installedSheet) return
  installedSheet = next
  registerStyles(next, doc)
}

/**
 * Add a skin, or replace one by name.
 *
 * ```ts
 * registerSkin({
 *   name: 'acme',
 *   label: 'Acme brand',
 *   tokens: '--openleaf-color-accent: #c2185b; --openleaf-radius: 12px;',
 * })
 * ```
 *
 * A skin that replaces the surface must also say which world it is in, or the
 * parts of the editor that cannot be reached by a custom property -- syntax
 * colours, native widget chrome -- keep following the visitor's system and end
 * up contradicting it:
 *
 * ```ts
 * registerSkin({
 *   name: 'acme-dark',
 *   label: 'Acme dark',
 *   scheme: 'dark',
 *   tokens: '--openleaf-color-surface: #101418; --openleaf-color-text: #e8eef4;',
 * })
 * ```
 */
export function registerSkin(skin: Skin, doc?: Document): void {
  warnIfSchemeMissing(skin)
  registry().set(skin.name, skin)
  sync(doc)
}

/*
 * Setting the surface without declaring the scheme is silently half a skin, and
 * the half that is missing only shows up on a machine set to the opposite mode
 * -- which is rarely the machine the skin was written on. This is the one thing
 * worth a console message, because nothing about the result looks like a
 * mistake locally.
 */
let schemeWarned: Set<string> | null = null

function warnIfSchemeMissing(skin: Skin): void {
  if (skin.scheme || !skin.tokens.includes('--openleaf-color-surface:')) return
  schemeWarned ??= new Set<string>()
  if (schemeWarned.has(skin.name)) return
  schemeWarned.add(skin.name)
  console.warn(
    `@openleaf-editor/ui: skin "${skin.name}" sets --openleaf-color-surface but declares ` +
      'no scheme, so syntax highlighting and native widgets inside it keep ' +
      "following the visitor's system setting and can contradict the palette. " +
      "Add scheme: 'light' or scheme: 'dark'.",
  )
}

export function availableSkins(): readonly Skin[] {
  return [...registry().values()]
}

/** Ensure the built-in skins are available. Idempotent. */
export function ensureSkins(doc?: Document): void {
  sync(doc)
}

/**
 * Apply a skin to one editor, or clear it with null.
 *
 * Per element rather than per page: a CMS with an article body and a comment box
 * may legitimately want them to look different, and there is no reason a global
 * setting should prevent that.
 */
export function applySkin(host: HTMLElement, name: string | null): void {
  ensureSkins(host.ownerDocument)
  if (name === null || name === '' || name === 'default') {
    host.removeAttribute('data-ol-skin')
    host.removeAttribute('data-ol-scheme')
    return
  }
  const skin = registry().get(name)
  if (!skin) {
    console.warn(
      `@openleaf-editor/ui: no skin named "${name}". Available: ` +
        `${[...registry().keys()].join(', ')}. The editor keeps its current appearance.`,
    )
    return
  }
  host.setAttribute('data-ol-skin', name)
  // A separate attribute from the skin's name because it is a separate
  // question: stylesheets that must branch on the scheme -- the highlighting
  // plugin's palette, the native-widget rules in the core sheet -- have no way
  // to know what `midnight` means, and hard-coding a list of skin names into
  // them is precisely the internal coupling skins exist to avoid.
  if (skin.scheme) host.setAttribute('data-ol-scheme', skin.scheme)
  else host.removeAttribute('data-ol-scheme')
}

/**
 * Force light or dark, or follow the visitor's system setting.
 *
 * A colour skin outranks this, and has to: its tokens set the palette outright,
 * so `theme="dark"` under the paper skin cannot actually darken the surface. It
 * would only darken the few things a token cannot reach -- which is how you get
 * a dark code block in a cream editor. Better that the skin wins wholly than
 * that it wins in part.
 */
export type ColourScheme = 'light' | 'dark' | 'auto'

export function applyColourScheme(host: HTMLElement, scheme: ColourScheme): void {
  if (scheme === 'auto') {
    // Removing the attribute is what re-enables the prefers-color-scheme rules;
    // there is no `data-ol-theme="auto"` for them to match.
    host.removeAttribute('data-ol-theme')
    return
  }
  host.setAttribute('data-ol-theme', scheme)
}
