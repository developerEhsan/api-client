# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

Pick the affected packages and a bump type (patch / minor / major), and write a
short summary. This creates a markdown file here describing the change. On merge
to `master`, the Release workflow opens a "Version Packages" PR that applies the
bumps and updates changelogs; merging that PR publishes to npm.
