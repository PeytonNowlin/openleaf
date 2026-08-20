# Security Policy

## Reporting

Report vulnerabilities through GitHub's private vulnerability reporting
on this repository ("Security" -> "Report a vulnerability"). Please do
not open a public issue for anything exploitable.

We aim to acknowledge within 3 working days and to ship a fix or a
documented mitigation within 30 days for anything rated high or above.

## Scope and threat model

OpenLeaf is a client-side editor. Understanding this boundary matters:

**Client-side sanitization is a user-experience feature, not a security
control.** Anything the editor strips can be re-added by a user with
developer tools, because the editor runs entirely under their control.

**You must sanitize on the server.** [`@openleaf-editor/sanitize`](packages/sanitize)
ships the canonical allowlist as data (`allowlist.json`) precisely so that your
server-side sanitizer can enforce the same policy in the same terms, and
generates configuration for DOMPurify, Python's `bleach` and PHP's
HTMLPurifier from it. Using the editor's output as trusted HTML is a
vulnerability in your application, and no configuration of OpenLeaf can fix it.

**We do not ship a novel sanitizer, on purpose.** Sanitizers are defeated by
mutation XSS, by parser differentials between the sanitizer and the renderer,
and by SVG and MathML namespace confusion -- bug classes that take years of
adversarial attention to surface. DOMPurify has had that attention. So the
valuable artifact here is *agreement*: one policy that the editor, your Node
server, your PHP request handler and your Python worker all enforce identically,
instead of four hand-written allowlists that drift until something gets through
the weakest one. `sanitizeHtml()` is included for deployments that genuinely
cannot add a dependency, and its limitations are documented in the source rather
than glossed over.

### The preservation trap

OpenLeaf's preservation layer deliberately keeps markup the schema does not
recognise, because silently deleting a customer's content is the failure this
project exists to prevent. **A default-safe sanitization policy will strip
exactly that markup**, destroying the content on the server that the editor
worked to save -- the same bug wearing a different hat.

If you rely on preservation, extend the policy explicitly:

```ts
import { DEFAULT_POLICY, policyForPreserved } from '@openleaf-editor/sanitize'

const policy = policyForPreserved(DEFAULT_POLICY, {
  div: ['class', 'data-callout-id'],
  'drupal-media': ['data-entity-type', 'data-entity-uuid', 'data-view-mode'],
})
```

There is deliberately no "allow whatever the editor emitted" mode. That is not a
policy, it is a wish -- the editor faithfully preserves whatever an author
pasted.

### The `style` attribute and atomic DOMPurify setup

Since alignment and colour landed, the policy permits a `style` attribute on
paragraphs, headings and `<span>` -- for `text-align`, `color` and
`background-color` only, with the values checked. It has to: those declarations
are how every editor OpenLeaf replaces expresses alignment and colour, and a
policy that forbids `style` outright deletes them out of every document it
touches.

`sanitizeHtml()` and the emitted `allowlist.json` carry that precision per
element. **The DOMPurify config cannot**, because `ALLOWED_ATTR` is global and
DOMPurify performs no CSS property filtering of its own. Install the hook:

```js
import DOMPurify from 'dompurify'
import { configureDOMPurify, DEFAULT_POLICY } from '@openleaf-editor/sanitize'

const purify = DOMPurify(window)
const config = configureDOMPurify(purify, DEFAULT_POLICY)
const clean = purify.sanitize(dirty, config)
```

The lower-level `toDOMPurifyConfig(DEFAULT_POLICY)` fails closed by stripping
styles and iframes. Use `configureDOMPurify` to keep them: it installs the value
and host checks before returning a config that permits either feature. The
`bleach` and HTMLPurifier configs filter by property but not by element or value,
which is a narrower gap documented where each is emitted.

### `<iframe>`, and why the DOMPurify config withholds it

The policy permits an iframe only when its `src` is one of a closed list of
player hosts. That is a per-element host check, and no DOMPurify config can
express it: `ALLOWED_URI_REGEXP` applies to every URL attribute at once, so
narrowing it to YouTube would delete every ordinary link in the document.

So `toDOMPurifyConfig(DEFAULT_POLICY)` **drops iframes**. The recommended
`configureDOMPurify` call above installs `embedHook(DEFAULT_POLICY)` before it
enables them. Listing the element without that check would let
`<iframe src="https://evil.example">` through the sanitizer this file
recommends -- a nested attacker-controlled page, which is the single thing the
embed allowlist exists to refuse. Omitting both is safe and loses stored embeds;
that is the right direction to fail.

The hook also filters `allow`. An allowlisted host is not sufficient on its own:
`allow` is how a frame asks to step outside the restrictions the rest of the page
lives under, so a permitted player URL carrying `allow="camera; microphone"`
would otherwise be handed the camera. `sanitizeHtml()` applies the same filter.

`bleach` cannot express the host list in configuration either, so
`toBleachConfig` emits a `filter_embeds` pre-pass to run alongside
`drop_with_content`. HTMLPurifier can: `toHtmlPurifierConfig` emits
`HTML.SafeIframe` and a generated `URI.SafeIframeRegexp`. It strips `allow`
outright, having no definition for it, so embeds arrive without their
permissions rather than with too many.

### In scope

- XSS reachable through the editor's own parsing, serialization, or
  paste handling that would surprise a correctly-sanitizing server
- Executable content surviving a round trip through the editor. The
  preservation layer keeps unrecognised markup, and it must never keep markup
  that runs: `<script>`, unallowlisted `<iframe>`, `<object>`, `<form>`, inline `on*` handlers
  and `javascript:` URLs are all dropped in `@openleaf-editor/core`, with tests.
  `<iframe>` is stored only for `https:` URLs on a closed list of player hosts.
- The published allowlist permitting a construct that is unsafe to render
- Prototype pollution or code execution in the parsing path
- Content-destroying bugs in the preservation layer (we treat silent
  content loss as a security-grade defect)

### Out of scope

- Un-sanitized editor output rendered as trusted HTML by an application
- Vulnerabilities in upstream `prosemirror-*` packages (report upstream;
  tell us too so we can pin or patch)
- Anything requiring the attacker to already control the page
