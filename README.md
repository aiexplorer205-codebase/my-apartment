# MyApartment by BLOCK9

Multi-tenant apartment operations for residents, apartment administrators, and platform operators. Resident and admin sign-in use isolated Better Auth services; operator sign-in uses Auth0. Tenant data uses a shared PostgreSQL application database with forced RLS.

This repository is a local, testable product. It is **not** a production-supported service: checkout, backups, production ingress, and several operational gates remain open. See [docs/security-and-ops.md](docs/security-and-ops.md).

## Documentation

- [Agent map](AGENTS.md)
- [Local setup](docs/local-setup.md) — Auth0, Compose, migrations, seed
- [Architecture](docs/architecture.md) — stack, isolation, shipped features
- [Security and operations](docs/security-and-ops.md)
- [Deployment plan](docs/deployment-plan.md) — provider comparison, OCI pilot, ECS production, CI/CD, and rollout phases
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

Optional HTML screen frames live in the prototype directory. The running apps are the source of truth.

## Quick start

Prerequisites: Node.js 22+, pnpm 9.15.0 (Corepack), Docker Compose, a non-production Auth0 tenant. Invitation email needs Resend.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Fill Auth0, session secrets, OPERATOR_IDS, and Resend. Never use production values.

docker compose config --quiet
docker compose up --build -d --wait
```

Hot reload: `docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait`.

Full Auth0 allowlists, migrations (including tenant `030`–`034` on the runner), and local tenant SQL are in [docs/local-setup.md](docs/local-setup.md).

## Local URLs

| Service | URL |
| --- | --- |
| Resident | http://localhost:3098 |
| Admin | http://localhost:3100 |
| Operator (loopback) | http://localhost:3101 |
| API health | http://localhost:4101/v1/health |
| API OpenAPI | http://localhost:4101/openapi.json |
| Worker health | http://localhost:4110/health |
| PostgreSQL | localhost:5434 |
| Redis | localhost:6381 |

## Shipped vs gated

**Shipped:** resident/admin email OTP and passkeys; operator Auth0 login, organization onboarding and lifecycle; admin/resident invitations; apartment setup and unused-setup deletion; billing rules, preview, publish, adjustments; offline payment report and admin confirmation; accounts/ledgers/reconciliation; complaints and maintenance; announcements and polls.

**Gated or stubbed:** online checkout, worker job processors, operator campaigns/support, report file exports, production deploy.

Resident surface is the Next.js PWA. There is no Flutter client in this repo.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
