/**
 * Entry point for the opt-in colour bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and gets the colour controls, with no initialisation call to forget. A
 * brand palette is the one thing worth calling for, and `installColourPicker`
 * remains exported for that.
 */
import { installColourPicker } from '@openleaf-editor/plugins-colour'

installColourPicker()
