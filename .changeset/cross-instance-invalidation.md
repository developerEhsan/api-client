---
"@developerehsan/api-client": minor
---

Add cross-instance cache invalidation via Redis pub/sub: `createRedisStore(client, { crossInstance: true })` broadcasts tag/key/clear invalidations to sibling server instances (opt-in, off by default). Fixes stale cache reads when a mutation lands on one instance behind a load balancer but the stale GET was cached on another.
