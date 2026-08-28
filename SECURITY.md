# Security Policy

## Reporting

Please do not open a public issue for anything exploitable. Use either
of these, whichever works:

1. **GitHub private vulnerability reporting** — the repository's
   "Security" tab, "Report a vulnerability".
2. **Email** — <peytonn98@googlemail.com>, subject line starting
   `OPENLEAF SECURITY`. No GPG key is published yet; if you need
   encryption, send an empty mail asking for one and we will arrange a
   channel before you send details.

Two channels rather than one, on purpose. A response commitment that
depends on a single mechanism is only as good as that mechanism being
switched on, and a researcher who finds the button missing and has been
told not to open an issue is left with no route at all — which realistically
ends in a dropped report or a full public disclosure. If option 1 is not
available to you for any reason, option 2 always is.

We aim to acknowledge within 3 working days and to ship a fix or a
documented mitigation within 30 days for anything rated high or above.

### Supported versions

| Version | Supported |
| --- | --- |
| `0.1.0-beta.x` | Yes — current pre-release line |
| Anything earlier | No |

Every `@openleaf-editor/*` package shares one version number and is
released together, so a fix ships across the whole set. While the project
is `0.x` there is no long-term support branch: fixes land on the current
line and you upgrade to get them. When a `1.0` line exists, this table
will say how long the previous major is patched for.

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

**Word `.docx` import is bounded before it is parsed.** A `.docx` is a ZIP.
`@openleaf-editor/plugins-import-docx` refuses a file whose central directory
cannot be read, whose ZIP64 sentinels are not corroborated by a ZIP64 EOCD
locator immediately before the EOCD, whose local records are not packed
immediately before the central directory, or whose declared or actually inflated
size exceeds 256 MB (25 MB compressed). Forging a ZIP64 sentinel used to skip
the expansion ceiling; that path now fails closed. The check lives in
`packages/plugins-import-docx/src/guards.ts`.

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

Since alignment, colour and typography landed, the policy permits a `style`
attribute on paragraphs, headings and `<span>` -- for `text-align`, `color`,
`background-color`, `font-family` and `font-size`, with the values checked. It
has to: those declarations are how every editor OpenLeaf replaces expresses
alignment, colour and type, and a policy that forbids `style` outright deletes
them out of every document it touches.

`font-family` is an allowlist of family names, not a denylist of known-bad
functions. A name may contain letters, digits, spaces, hyphens, apostrophes
and plus, and may start with a digit when quoted (`21st Century`,
`Goudy's Old Style`). `url()`, `expression()`, `var()`, comments, unbalanced
quotes, backslash escapes, `;` and newlines are refused. Accepted names are
re-emitted as a CSS identifier or a double-quoted string, which is the
spelling the toolbar options use.

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

## Plugin trust model

**A plugin is same-trust as the page that loads it. Vet plugins as
first-party code.**

There is no plugin isolation of any kind — no iframe, no worker, no
capability object, no frozen surface. `registerEditorPlugin`,
`registerToolbarItem` and `registerSchemaExtension` are global,
unauthenticated registries, so any script already running on the page can
install a plugin. This is a normal design for an editor and the same one
every editor OpenLeaf replaces uses: a script on your page can already
read the DOM and issue requests as the user, so sandboxing the editor's
extension points would protect nothing that is not already lost. It is
written down here because "defensible" and "obvious" are different things.

Two consequences are specific to OpenLeaf and worth stating plainly.

**The schema *is* the content policy at runtime.** OpenLeaf's protection
against dangerous markup is that the schema does not model it — a
`<script>` becomes a preserved atom with its content scrubbed, because
nothing claims it. A schema extension's `parseDOM` and `toDOM` therefore
widen what markup is permitted, directly. A plugin that adds a node type
matching `iframe` has changed what the editor will store, for every
document, with no separate policy edit to review.

**`carryUnknownAttributes: false` opts out of the attribute scrub.** By
default an extension node's or mark's unmodelled attributes are captured on parse
and re-emitted on serialize, and that capture filters `on*` handlers and
unsafe URL schemes on the way through. Setting the flag to `false` skips
the wrapper entirely — including the filter. It exists for specs that
model every attribute they claim and would otherwise emit duplicates; it
is not a performance knob, and a plugin setting it is making a
security-relevant choice. The same capture is where an attribute name
that cannot be written back is refused, so opting out also opts out of
the check that keeps `serializeHtml(parseHtml(x))` from throwing.

Neither of these is a reason not to use plugins. They are the reason the
answer to "can I load this third-party plugin?" is the same as the answer
to "can I add this third-party script tag?"

### Agent tools are a new caller, not a new trust level

`@openleaf-editor/plugins-webmcp` registers a WebMCP tool set with the
browser, which lets an agent driving the page call into the editor. Three
things about it are worth stating before you install it.

**It is opt-in and it is off.** The package is not in the core bundle and
nothing calls `installAgentTools()` for you. A deployment that does not
install it has no agent surface at all, and the tools are additionally
inert in every browser that does not implement the API.

**The caller is the browser's own agent, not another origin.** Cross-origin
tool exposure is a separate mechanism and this package does not configure
it, so the tools are reachable from this document and nowhere else.

**Document content read back through a tool is untrusted, in a direction
the rest of this file does not cover.** Everywhere else here, "untrusted"
means the HTML your server is about to store. A tool that returns document
content is untrusted in the other direction as well: an author — or
whoever pasted into the document before them — can leave text in it that
is aimed at the agent reading it. Tools that return content are annotated
`untrustedContentHint`, which is what tells the client driving the agent
to treat instructions found inside as data. `openleaf_get_document`, which
returns an editor's HTML, is annotated with it, and so is
`openleaf_find_text`, which hands back the text around each match.
`openleaf_list_editors` and `openleaf_get_capabilities` return identifiers,
accessible names, schema type names and command labels only, and are
annotated the other way.

**A tool that writes has the reach of the toolbar, and no more.**
`openleaf_apply_command` changes the document, and it is the only tool so
far that does. It cannot write markup: it runs one of the commands the
deployment registered and the editor's own `toolbar` layout offers, so an
agent reaches exactly what a person clicking that bar reaches. The
refusals are the editor's own, not this package's -- a readonly editor,
an open HTML source view, and markup the preservation layer holds byte
for byte are all refused, because the toolbar is unavailable in the first
two and editing the third is the one thing that breaks the guarantee it
makes. It carries the `readOnlyHint: false` annotation, which is what
lets a client single it out as the call worth putting to a person.

## Defence in depth: a baseline CSP

Everything above is about the sanitizer. A Content-Security-Policy on the
pages that *render* editor output is the layer that holds when the
sanitizer is wrong — and sanitizers are sometimes wrong, which is the
premise of this whole file. It is cheap, and it contains an XSS that got
through rather than merely logging it.

A reasonable baseline for a page rendering stored OpenLeaf content:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-src https://www.youtube-nocookie.com https://player.vimeo.com;
  img-src 'self' https: data:;
  style-src 'self';
  require-trusted-types-for 'script';
```

Notes on the parts that matter:

- **`script-src` without `'unsafe-inline'`** is the whole point. An
  injected `<img onerror>` that survived sanitization does not run.
- **`object-src 'none'` and `base-uri 'none'`** close two vectors that
  sanitizer bypasses reach for and that no page needs.
- **`frame-src`** should name the players you actually allow. It is a
  second, independent copy of the embed allowlist, enforced by the
  browser rather than by our code.
- **`style-src 'self'`** blocks inline `style` attributes. OpenLeaf
  stores alignment and colour in `style`, so this will visibly change how
  content renders — either add a nonce or hash for the styles you serve,
  or accept the loss knowingly. Do not reach for `'unsafe-inline'` on
  `style-src` without noticing that it is the setting most commonly used
  to defeat a CSP by accident.

The editor itself is more constrained than the rendering page: it needs
`style-src` to apply the declarations an author sets while editing. If
you serve the editor under a strict `style-src`, expect alignment and
colour to stop applying live, and test it.

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
- Resource exhaustion reachable from stored content. Anything an attacker can
  put in a document must not be able to hang the tab that opens it, so the
  parser bounds what it will build: nesting depth is refused with a named error
  rather than overflowing the stack, and table cell spans are clamped to HTML's
  own limits (`colspan` 1-1000, `rowspan` 1-65534) because both consumers of a
  span scale linearly in it -- one `<col>` element per column, and a cell map of
  `width * height` entries. A row carries a cumulative column budget as well,
  because bounding one attribute does not bound their sum: 5,000 cells at the
  per-cell ceiling would otherwise reach the same five-million-column table by
  addition. A table ends up as wide as its markup, never wider.
- Resource exhaustion reachable from a dropped `.docx`. The Word importer
  measures expansion from the ZIP central directory *and* from inflate, and
  fails closed when the directory cannot be read -- including ZIP64 sentinels
  that are not backed by a real ZIP64 EOCD locator, and local records that are
  not packed immediately before the central directory.

### Out of scope

- Un-sanitized editor output rendered as trusted HTML by an application
- Vulnerabilities in upstream `prosemirror-*` packages (report upstream;
  tell us too so we can pin or patch)
- Anything requiring the attacker to already control the page
