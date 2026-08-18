/**
 * The bundle entry point, and the plugin host.
 *
 * Two script tags cannot share module state, so an opt-in bundle loaded after
 * this one would normally bundle its own copy of ProseMirror -- turning a 12.5 KB
 * table plugin into a 200 KB one, and worse, giving it a *second* copy of the
 * schema and the registries. Two schemas means a table node created by the
 * plugin is a different node type than the one the editor understands, which
 * fails in ways that are very hard to read.
 *
 * So this entry publishes the shared runtime on the global. The plugin bundles
 * are built with these modules marked external and resolved from
 * `window.OpenLeaf.__runtime` instead, which keeps exactly one copy of
 * everything on the page.
 *
 * `__runtime` is named with underscores because it is not a public API. It is a
 * linkage detail between bundles built from this repository at the same version;
 * anything outside should import the packages properly.
 */

import * as openleafCore from '@openleaf/core'
import * as openleafPaste from '@openleaf/paste'
import * as openleafUi from '@openleaf/ui'
import * as pmCommands from 'prosemirror-commands'
import * as pmHistory from 'prosemirror-history'
import * as pmKeymap from 'prosemirror-keymap'
import * as pmModel from 'prosemirror-model'
import * as pmState from 'prosemirror-state'
import * as pmTransform from 'prosemirror-transform'
import * as pmView from 'prosemirror-view'

export * from './index.js'

export const __runtime = {
  '@openleaf/core': openleafCore,
  '@openleaf/paste': openleafPaste,
  '@openleaf/ui': openleafUi,
  'prosemirror-commands': pmCommands,
  'prosemirror-history': pmHistory,
  'prosemirror-keymap': pmKeymap,
  'prosemirror-model': pmModel,
  'prosemirror-state': pmState,
  'prosemirror-transform': pmTransform,
  'prosemirror-view': pmView,
}
