---
"@developerehsan/api-client": patch
---

Document and type-test full type-safety without codegen: `createTypedClient<Ops>()` already accepts a hand-written `Ops` interface with the exact shape codegen emits (`{ params, query, body, response }` per operation) — see `docs/manual-types.md`.
