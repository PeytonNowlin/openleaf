# Toolbar design review

Findings from an accessibility review and an architecture review conducted
before the toolbar was written, recorded here because several of them corrected
a decision that looked obviously right and was not.

Each item says what was planned, what the review said, and what shipped.

## Corrections that changed the design

### 1. A native `<select>` cannot live inside a roving tabindex

**Planned.** `role="toolbar"` with roving tabindex over every control, block
type as a native `<select>`.

**Finding.** These collide, and not cosmetically. When focus is on the select,
Left/Right have two owners: the roving-tabindex handler wants to move to the
next item, and the select natively wants those keys to change its value. Handle
them and the select breaks; do not handle them and the toolbar contract breaks.

**Shipped.** Arrow-key roving is handled **only when the event target is a
`<button>`**. The select owns all of its own key events and is a genuine second
tab stop rather than participating in the roving scheme. It carries its own
`aria-label` ("Paragraph style") independent of the toolbar's label.

### 2. Escape must return focus to the content — the biggest hole

**Planned.** Nothing. Mouse clicks were prevented from stealing focus, which
solved the mouse case and left the keyboard case undefined.

**Finding.** Once a keyboard or screen reader user deliberately enters the
toolbar, focus genuinely *is* on a button. Nothing in the plan said how they get
back. Without a return path, their only route out is blind-Tabbing through the
rest of the CMS form.

**Shipped.** Escape returns focus **and the prior selection** to the editable
region, from anywhere in the toolbar. `Alt+F10` enters the toolbar, matching
TinyMCE and CKEditor 5 so muscle memory transfers. The editable region advertises
it via `aria-describedby`.

> Known risk, documented rather than solved: `Alt+F10` is a window-maximize
> binding in GNOME and KDE, and education runs a lot of Linux and ChromeOS
> hardware. Needs testing on real desktops, with a documented alternate if the
> window manager eats it.

### 3. Silence on formatting changes was wrong

**Planned.** No live region. Reasoning: `aria-pressed` already conveys state,
and a chatty live region is worse than none.

**Finding.** Half right. `aria-pressed` is announced correctly when a screen
reader's virtual cursor sweeps the toolbar, and again when a keyboard user
arrows onto the button — so the original worry, that a never-focused button
would not announce, was misplaced. But the *most common* action is `Ctrl+B`
typed directly in the content, where no cursor real or virtual is anywhere near
the button. Nothing observes the change. That is not restraint, it is silence.

**Shipped.** One polite, atomic, visually-hidden live region that fires **only
on a discrete formatting transition** — "Bold on", "Bold off" — triggered by
click, toolbar keyboard activation, or an in-content shortcut alike. It stays
quiet when only the selection moved, which is what stops it becoming chatty:
the announcement is gated on `docChanged || storedMarksSet`, never on cursor
movement through already-formatted text. Debounced so a held shortcut cannot
spam it.

### 4. The `<style>` injection fallback was worse than nothing

**Planned.** Three delivery paths: constructable stylesheet, then `<style>`
injection, then a standalone CSS file.

**Finding.** Constructable stylesheets are genuinely CSP-safe, and
spec-intentionally so — CSP gates resources *parsed as style*, and a CSSOM
object attached via `adoptedStyleSheets` never passes through that gate. But the
`<style>` middle tier fails under exactly the strict-CSP configurations it was
meant to rescue, and it fails **silently**: a blocked injection leaves an
unstyled toolbar and no signal an integrator can act on.

**Shipped.** Two paths. Constructable stylesheet as primary; if
`adoptedStyleSheets` is unavailable, a `console.warn` pointing at
`@openleaf/ui/openleaf.css` rather than an injection that CSP will eat.

Bonus the review supplied: adopted stylesheets are ordered *after* a document's
regular stylesheets, so at equal specificity OpenLeaf wins ties against host CSS
regardless of injection timing.

### 5. Trusted Types blocks `innerHTML`, and the icon sprite used it

**Finding.** Strict government CSPs commonly pair `style-src` with
`require-trusted-types-for 'script'`. Stylesheets are exempt; dynamic HTML is
not. The sprite injector built markup with `innerHTML`.

**Shipped.** The sprite is constructed with DOM APIs only. No `innerHTML`
anywhere in the UI package.

### 6. The item spec needed a `type` discriminant on day one

**Finding.** A flat `{id, label, icon, command, isActive, isEnabled}` models a
button, not a dropdown, colour grid, or table-insert popover. Adding the
discriminant after the config shape is public *is* the breaking change the
registry was meant to avoid.

**Shipped.** `type: 'button' | 'select' | 'custom'` is present now, even though
only `button` and `select` are implemented.

### 7. Plugins need an imperative state escape hatch

**Finding.** `isActive`/`isEnabled` assume everything is synchronously derivable
from ProseMirror state. Real plugin state is not: "upload in progress", "collab
lock held by another user", "AI rewrite running" live outside the document
entirely, and a pull-on-transaction model cannot see them.

**Shipped.** `setItemState(id, {active, enabled})` for plugins to push state
changes outside the transaction cycle.

### 8. Two tokens that are awkward to add later

**Finding.** `--openleaf-z-index` was missing entirely, and a 2009 WordPress
admin bar sits at `z-index: 99999` while Drupal's toolbar plays similar games. A
toolbar with no stacking escape hatch renders behind a sticky host header, and
integrators fix that with `!important` — the exact thing the token API exists to
prevent. Also focus-ring *thickness and offset* were not tokenized, only colour,
which is a poor answer to give a Section 508 team citing WCAG 2.2 Focus
Appearance.

**Shipped.** `--openleaf-z-index`, `--openleaf-focus-width`,
`--openleaf-focus-offset`.

## Confirmed as already correct

- `aria-disabled` rather than the `disabled` attribute, so a disabled command
  stays reachable and discoverable in the roving tabindex.
- No `!important`, no `all: unset`, explicit property resets at `(0,2,0)`
  specificity.
- Tab left unbound inside the editor (WCAG 2.1.2); indentation on `Mod-[` /
  `Mod-]`.
- Wrapping toolbar rather than horizontal scroll or an overflow menu. An
  overflow menu is itself a new custom widget owing `aria-haspopup` and its own
  keyboard pattern — not a bolt-on. Wrapping also satisfies reflow at 400% zoom.
- Forced-colors handling for the pressed state, re-expressed as a border since
  the mode discards our backgrounds.
- Diffed state sync without requestAnimationFrame batching. Batching would trade
  a perceptible frame of lag between pressing Bold and the button lighting up
  for a performance problem that does not exist at 20 predicates per
  transaction.
- Accessible names kept constant across states; the platform announces pressed.
- Native `<dialog>` with `showModal()` for link and image, which supplies the
  focus trap, Escape handling and inert background that would otherwise be
  hundreds of lines of ARIA owing real screen reader testing.

## Open, not yet done

- **Screen reader testing.** Priority order: NVDA + Firefox on Windows 11;
  JAWS + Chrome on Windows 11; VoiceOver + Safari on macOS; ChromeVox on
  ChromeOS (not optional — K-12 is majority Chromebook); VoiceOver + Safari on
  iOS; TalkBack + Chrome on Android.
- **iOS VoiceOver specifically.** The `mousedown` + `preventDefault` trick used
  to preserve editor focus has a history of interfering with VoiceOver's
  synthesized touch activation. Must be tested directly, not inferred from
  desktop.
- **Source view is a large context change with no announcement.** Focus should
  move into the source control on switch and the mode change should not be
  silent.
- **CMS validation mirroring.** If the host attaches `aria-invalid` or error
  text to the bound `<textarea>` — which is the real form field from the CMS's
  point of view — a screen reader user hears an error on a control they never
  interact with and cannot locate. Validation state needs mirroring onto the
  visible `role="textbox"`.
- **WCAG 2.2 SC 2.4.11 Focus Not Obscured.** A sticky CMS header can cover the
  focus ring when the toolbar sits near the viewport edge.
- **Registry change events.** Import-time registration races code-split plugins:
  a chunk resolving after the toolbar has rendered means its button silently
  never appears. The registry should emit change events and the toolbar
  re-render reactively.
- **Tooltips.** Currently the native `title` attribute, which is poor for
  keyboard and touch users but has no 1.4.13 exposure. Custom tooltips would
  need to persist on hover, be dismissible with Escape without losing focus, and
  not vanish on mouse-away while still focused.
