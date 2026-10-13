# Nivasa implementation prompts

Use these prompts with a coding agent from the repository root. Read
[`MASTER_PROMPT.md`](./MASTER_PROMPT.md) first, then run each phase in order.
Each phase is an implementation task, not a planning exercise: implement the
scope in the repository, run its verification, and report any genuine blockers
or human-owned decisions. Do not ask an agent to skip tests or declare
completion from generated code alone.

For repository setup, local development, safe GitHub publishing, and pull
request requirements, start with the root
[`README.md`](../../README.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
Do not publish secrets or production data. Repository visibility and
licensing remain project-owner decisions. Phase 4 deliberately runs only
first-party services and databases locally; external providers are configured
via `.env` and are never silently replaced with fake runtime adapters.

| Prompt | Outcome |
| --- | --- |
| [Master prompt](./MASTER_PROMPT.md) | Product scope, fixed architecture boundaries, safety and quality rules |
| [Phase 1: foundation](./PHASE-1-FOUNDATION.md) | Monorepo, typed contracts, database-per-tenant foundation, auth, CI/local env |
| [Phase 2: tenant product](./PHASE-2-TENANT-PRODUCT.md) | Resident and apartment-admin product workflows |
| [Phase 3: platform operations](./PHASE-3-PLATFORM-OPERATIONS.md) | Operator console, onboarding, plans, ads, audit and support |
| [Phase 4: local Docker Compose](./PHASE-4-LOCAL-DOCKER-COMPOSE.md) | Run resident, admin, operator, API, worker, PostgreSQL, and Redis locally; use external provider credentials from `.env` |
| [Phase 5: production readiness](./PHASE-5-PRODUCTION-READINESS.md) | OCI deployment, tests, backup/recovery, monitoring and release gates |

Run Phase 5 against a real cloud account or apply Terraform only with
explicit human authorization. Provider selection, external accounts, DNS,
secrets, and payment activation are human-owned gates.
