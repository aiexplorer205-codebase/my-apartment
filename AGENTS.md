# AGENTS

Nivasa: apartment operations SaaS. Next.js login/resident/admin/operator apps, Node HTTP API, worker health stub, Postgres (platform + one DB per tenant), Redis, Auth0 OTP, Resend invitations.

Do not invent NestJS, Prisma migrations, Flutter, fake payments, or job processors. Prisma in root `package.json` is unused. Schema is SQL in `migrations/`.

## Layout

```
apps/login-web | resident-web | admin-web | operator-web | api | worker
packages/domain application contracts api-client shared config auth-types
packages/ui  app-platform (locales en/te)  design-tokens
infrastructure/ports adapters  proxy/nginx.conf
migrations/platform_db  migrations/tenant_db
docker/  compose.yaml  compose.dev.yaml
```

Local how-to: [docs/local-setup.md](docs/local-setup.md). System: [docs/architecture.md](docs/architecture.md). Gates: [docs/security-and-ops.md](docs/security-and-ops.md). HTML frames (not product truth): `docs/design/nivasa-screen-designs`.

## Where to change what

| Change | Place |
| --- | --- |
| Admin screens | `apps/admin-web/src/features/` |
| Resident screens | `apps/resident-web/src/features/` |
| Operator console | `apps/operator-web/` (overview module) |
| HTTP + domain modules | `apps/api/src/` (`index.ts` wires routes) |
| Shared React | `packages/ui` |
| Copy / i18n | `packages/app-platform/locales/{en,te}/*.json` (keep key parity) |
| Tenant context / guards | `packages/application` |
| Ports vs Auth0/Postgres/Resend | `infrastructure/ports` vs `infrastructure/adapters` |
| Schema | Next numbered `migrations/{platform,tenant}_db/*.sql` then `scripts/run-migrations.sh` |

Init on a new volume applies tenant SQL only through `029`. Apply `030`–`034` with the runner (`all-tenants` includes `tenant_template`). Runner has no history table; do not re-apply a file that already ran.

## Hard rules

- Resolve tenant from validated Auth0 `sub` + `platform_db` membership. Never trust client tenant ids, token metadata, or host as authz.
- Fail closed: missing `OPERATOR_IDS`, suspended tenant, ambiguous membership (`tenant_selection_required`).
- Parameterized SQL. Bound tenant connection only.
- No secrets in git, logs, `NEXT_PUBLIC_*`, or client bundles.
- Do not enable or fake checkout. Do not add SMS/WhatsApp OTP without an approved Auth0-compatible path.
- Invitations: seven-day single-use email; OTP must match invited address; accept still required.
- Display refs `CMP-`/`MNT-` are not API ids (UUIDs are).
- Match existing patterns in the file you edit. No drive-by refactors.

## Verify

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Targeted: `pnpm run test tests/<file>.spec.ts`. Postgres specs need `NIVASA_DATABASE_TESTS=1`. After API schema or route changes, rebuild/restart `api`. Do not claim production-ready.
