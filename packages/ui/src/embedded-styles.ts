import { Plugin } from 'prosemirror-state'
import type { EmbeddedStyle } from '@openleaf-editor/core'
import { embeddedCanvasSelectors } from './content-css.js'

/** Keep rule-bearing CSS; document-global definitions must not affect the host. */
function localRules(rules: CSSRuleList): string {
  return Array.from(rules).map((rule) => {
    if (rule.type === 1) {
      const style = rule as CSSStyleRule
      return embeddedCanvasSelectors(style.selectorText) + style.cssText.slice(style.selectorText.length)
    }
    // CSSOM validates and balances the blocks before any text enters @scope.
    // In particular an authored media attribute cannot close our scope block.
    if ('cssRules' in rule && /^@(media|supports|container|layer|scope|starting-style)\b/i.test(rule.cssText)) {
      const group = rule as CSSGroupingRule
      const prelude = rule.cssText.slice(0, rule.cssText.indexOf('{'))
      return `${prelude}{${localRules(group.cssRules)}}`
    }
    // @import, @font-face, keyframes and property registrations are global,
    // even inside @scope. Retain them in stored HTML, not in the admin cascade.
    return ''
  }).join('\n')
}

let nextCanvas = 0

/**
 * Render trusted document CSS under a native scope tied to ONE canvas.
 * The HTML stays in document metadata, so no style node enters ProseMirror or
 * its clipboard. A constructed sheet also follows the UI's strict-CSP contract.
 */
export function embeddedStylesPlugin(options: { isolated?: boolean } = {}): Plugin {
  return new Plugin({
    view(view) {
      const doc = view.dom.ownerDocument
      const Sheet = doc.defaultView?.CSSStyleSheet
      if (!Sheet || !('replaceSync' in Sheet.prototype) || !('adoptedStyleSheets' in doc)) {
        console.warn('OpenLeaf: rendering embedded styles requires constructable stylesheets and CSS @scope.')
        return {}
      }
      const id = `ol-${++nextCanvas}`
      view.dom.setAttribute('data-ol-style-canvas', id)
      const parsed = new Sheet()
      const sheet = new Sheet()
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      let previous: unknown
      const frame = options.isolated ? doc.defaultView?.frameElement : null
      const update = () => {
        // Firefox cannot reliably parse constructed CSS in a hidden frame.
        // Shared CMS modals mount before they are shown, so defer rendering
        // until the frame has a layout box, without changing stored HTML.
        if (frame && frame.getClientRects().length === 0) return
        const styles = view.state.doc.attrs['embeddedStyles'] as readonly EmbeddedStyle[] | undefined
        if (styles === previous) return
        previous = styles
        const rules = (styles ?? []).map(({ css, media }) => {
          parsed.replaceSync(media ? `@media ${media}{${css}}` : css)
          return options.isolated ? Array.from(parsed.cssRules, rule => rule.cssText).join('\n') : localRules(parsed.cssRules)
        }).join('\n')
        sheet.replaceSync(options.isolated ? rules : `@scope ([data-ol-style-canvas="${id}"]) {${rules}}`)
      }
      const observer = frame && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
      if (frame) observer?.observe(frame)
      update()
      return {
        update,
        destroy() {
          observer?.disconnect()
          doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((item) => item !== sheet)
          view.dom.removeAttribute('data-ol-style-canvas')
        },
      }
    },
  })
}
