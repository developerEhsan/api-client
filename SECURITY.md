# Security Policy

## Supported versions

The latest published minor of each `@developerEhsan/api-client*` package receives
security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/developerEhsan/api-client/security/advisories/new)
(Security → Report a vulnerability), or email **<ehsanshahid787@gmail.com>**.

Please include a description, affected package/version, and a reproduction if
possible. We aim to acknowledge within 72 hours and to ship a fix or mitigation
as quickly as the severity warrants.

## Scope of note

This library ships an **SSR RPC bridge** whose security model is deny-by-default:
the browser bundle must never contain backend hosts, paths, the OpenAPI spec, or
`axios`. A regression that leaks any of these into the browser bundle is treated
as a security issue. CI enforces this via `scripts/check-browser-bundle.mjs`.
