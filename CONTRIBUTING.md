# Contributing

Thanks for your interest in improving `@developerehsan/api-client`! 🎉

## Prerequisites

- **Node 22** (Node 20 also supported)
- **pnpm 10** (`corepack enable` then `corepack use pnpm@10`)

## Getting started

```bash
pnpm install
pnpm build       # build all packages (tsup)
pnpm test        # run all tests (vitest)
pnpm typecheck   # tsc --noEmit
pnpm lint        # Biome check
```

> **Build ordering matters.** The `tanstack-query` package and the examples
> consume `@developerehsan/api-client` through its built `dist/`, not its source.
> After editing `packages/core/src`, run its build before typechecking dependents:
>
> ```bash
> pnpm --filter @developerehsan/api-client build
> ```

## Workflow

1. Create a branch off `master`.
2. Make your change, with tests.
3. Run `pnpm build && pnpm typecheck && pnpm test && pnpm lint`.
4. **Add a changeset** if you touched a published package:
   ```bash
   pnpm changeset
   ```
   Pick the affected packages and a bump type, and write a user-facing summary.
5. Open a PR. The **PR title must follow
   [Conventional Commits](https://www.conventionalcommits.org/)** (e.g.
   `feat(core): add retry backoff`) — this is enforced by CI.

## Releases

Releases are automated with [Changesets](https://github.com/changesets/changesets).
Merging PRs with changesets into `master` opens a "Version Packages" PR; merging
that PR publishes the affected packages to npm (with provenance) and creates
GitHub Releases. Maintainers do not bump versions by hand.

## Code style

Formatting and linting are handled by [Biome](https://biomejs.dev). Run
`pnpm format` to auto-fix before committing.
