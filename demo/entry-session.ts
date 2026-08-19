/**
 * Entry point for the opt-in session bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and gets find, count, autosave, save, print, preview, and new document.
 * `registerSaveHandler` is hung on the host global so a second script tag can
 * set a callback without a bundler, the same way `registerImageUploader` works.
 */
import * as session from '@openleaf-editor/plugins-session'

session.installSessionTools()

const host = globalThis as typeof globalThis & {
  OpenLeaf?: { registerSaveHandler?: typeof session.registerSaveHandler }
}
if (host.OpenLeaf) host.OpenLeaf.registerSaveHandler = session.registerSaveHandler
