# Contributing

Read [AGENTS.md](AGENTS.md) and, for behavior or isolation changes, [docs/architecture.md](docs/architecture.md). Do not deploy, create paid cloud resources, enable live payments, or apply production infrastructure without explicit approval.

Keep secrets and real customer data out of source, tests, logs, and pull requests. `.env.example` stays placeholders only.

## Checks

Node.js 22+ and pnpm 9.15.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Update tests and the three files under `docs/` when behavior changes. Tenant isolation or authorization failures block the change.

## Pull requests

- Keep the diff focused. Describe behavior, security impact, and how you tested.
- Do not claim production readiness for unused adapters or unverified infrastructure.
- Confirm generated files and `.env` are not staged.
- Wait for required CI and review before merging.
