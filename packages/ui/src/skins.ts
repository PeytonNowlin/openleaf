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
 */

import { registerStyles } from './styles.js'

export interface Skin {
  /** Used in the `skin` attribute and `applySkin`. */
  name: string
  /** Shown in a picker. */
  label: string
  /** Custom-property declarations. No selectors -- they are scoped for you. */
  tokens: string
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
    tokens: `
      --openleaf-color-text: #e6edf3;
      --openleaf-color-text-muted: #9198a1;
      --openleaf-color-surface: #0d1117;
      --openleaf-color-surface-hover: #21262d;
      --openleaf-color-surface-active: #1f3a5f;
      --openleaf-color-border: #3d444d;
      --openleaf-color-accent: #79c0ff;
      --openleaf-color-focus: #79c0ff;
    `,
  },
  {
    name: 'paper',
    label: 'Paper',
    tokens: `
      --openleaf-color-text: #2b2621;
      --openleaf-color-text-muted: #6b6157;
      --openleaf-color-surface: #fbf7f0;
      --openleaf-color-surface-hover: #f0e9dd;
      --openleaf-color-surface-active: #e6dcc8;
      --openleaf-color-border: #d8cdb9;
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
    tokens: `
      --openleaf-color-text: #000000;
      --openleaf-color-text-muted: #1a1a1a;
      --openleaf-color-surface: #ffffff;
      --openleaf-color-surface-hover: #e8e8e8;
      --openleaf-color-surface-active: #d0d0d0;
      --openleaf-color-border: #000000;
      --openleaf-color-accent: #0000c0;
      --openleaf-color-focus: #0000c0;
      --openleaf-focus-width: 3px;
      --openleaf-focus-offset: 2px;
    `,
  },
  {
    /*
     * Density, not colour -- so it composes with any of the others. The button
     * stays at 28px because WCAG 2.2 SC 2.5.8 asks for 24 CSS px minimum and
     * "compact" is not a licence to go under it.
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

const skins = new Map<string, Skin>(BUILT_IN_SKINS.map((skin) => [skin.name, skin]))
let installedSheet = ''

function css(): string {
  return [...skins.values()]
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
 */
export function registerSkin(skin: Skin, doc?: Document): void {
  skins.set(skin.name, skin)
  sync(doc)
}

export function availableSkins(): readonly Skin[] {
  return [...skins.values()]
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
    return
  }
  if (!skins.has(name)) {
    console.warn(
      `@openleaf/ui: no skin named "${name}". Available: ` +
        `${[...skins.keys()].join(', ')}. The editor keeps its current appearance.`,
    )
    return
  }
  host.setAttribute('data-ol-skin', name)
}

/** Force light or dark, or follow the visitor's system setting. */
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
