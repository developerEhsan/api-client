---
"@developerehsan/api-client": minor
---

Add a dev-time server-only guard: `createRpcHandler` now throws immediately if constructed in a browser context (`enforceServerOnly`, on by default), and `defineModule({ serverOnly: true, ... })` does the same for your own server-only modules. Both are defense-in-depth on top of the existing `scripts/check-browser-bundle.mjs` CI check, which remains authoritative.
