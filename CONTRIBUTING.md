# Contributing

## Before making changes

- Read the [master implementation prompt](docs/implementation-prompts/MASTER_PROMPT.md)
  and relevant [architecture documents](docs/architecture/README.md).
- Implement only the currently authorized phase. Do not deploy, create
  external accounts, enable live payments, or apply infrastructure without
  explicit approval.
- Keep secrets and real customer data out of source, tests, logs, and pull
  requests. `.env.example` must contain placeholders only.

## Local checks

Use Node.js 22+ and pnpm 9.15.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run the checks relevant to your change before opening a pull request. Update
tests and directly related documentation with behavior changes. Tenant
isolation and authorization failures block progression to later phases.

## Pull requests

- Keep changes focused and explain the behavior, security impact, and testing.
- Link related issues or decisions without copying sensitive information.
- Do not claim production readiness for placeholder adapters or unverified
  infrastructure.
- Confirm generated files and local configuration are not staged.
- Wait for required CI checks and review before merging.

Repository maintainers should configure the GitHub default branch and branch
protection rules after the remote repository is created.
