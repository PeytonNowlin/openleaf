# Security Policy

## Reporting

Report vulnerabilities through GitHub's private vulnerability reporting
on this repository ("Security" -> "Report a vulnerability"). Please do
not open a public issue for anything exploitable.

We aim to acknowledge within 3 working days and to ship a fix or a
documented mitigation within 30 days for anything rated high or above.

## Scope and threat model

Openleaf is a client-side editor. Understanding this boundary matters:

**Client-side sanitization is a user-experience feature, not a security
control.** Anything the editor strips can be re-added by a user with
developer tools, because the editor runs entirely under their control.

**You must sanitize on the server.** The `@openleaf/sanitize` package
ships the canonical allowlist as data (`allowlist.json`) precisely so
that your server-side sanitizer can enforce the same policy in the same
terms. Using the editor's output as trusted HTML is a vulnerability in
your application, and no configuration of Openleaf can fix it.

### In scope

- XSS reachable through the editor's own parsing, serialization, or
  paste handling that would surprise a correctly-sanitizing server
- The published allowlist permitting a construct that is unsafe to render
- Prototype pollution or code execution in the parsing path
- Content-destroying bugs in the preservation layer (we treat silent
  content loss as a security-grade defect)

### Out of scope

- Un-sanitized editor output rendered as trusted HTML by an application
- Vulnerabilities in upstream `prosemirror-*` packages (report upstream;
  tell us too so we can pin or patch)
- Anything requiring the attacker to already control the page
