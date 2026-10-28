# AGENTS

MyApartment by BLOCK9: apartment operations SaaS. Next.js login/resident/admin/operator apps, Node HTTP API, worker health stub, Postgres (platform + shared application DB with forced RLS), Redis, Auth0 OTP, Resend invitations.

Do not invent NestJS, Prisma migrations, Flutter, fake payments, or job processors. Prisma in root `package.json` is unused. Schema is SQL in `migrations/`.

## Layout

```
apps/login-web | resident-web | admin-web | operator-web | api | worker
packages/domain application contracts api-client shared config auth-types
packages/ui  app-platform (locales en/te)  design-tokens
infrastructure/ports adapters  proxy/nginx.conf
migrations/myapartment_platform_db  migrations/myapartment_tenant_db
docker/  compose.yaml  compose.dev.yaml
```

Local how-to: [docs/local-setup.md](docs/local-setup.md). System: [docs/architecture.md](docs/architecture.md). Gates: [docs/security-and-ops.md](docs/security-and-ops.md). HTML frames (not product truth): `ui-prototype/ui_design_prototype/myapartment-screen-designs`.

Minutes of Meeting: [feature details](docs/minutes-of-meeting-plan.md). Admin drafts/review/publication; resident latest/history. Published notes and attendance snapshots are immutable. Use resident UUIDs for selection; block/flat numbers are display labels, not authorization. Requires tenant migration `035`.

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
| Schema | Next numbered `migrations/myapartment_{platform,tenant}_db/*.sql` then `scripts/run-migrations.sh` |

Fresh initialization applies platform SQL and tenant SQL through `037` to
`myapartment_platform_db` and `myapartment_app_db`. No tenant template or per-tenant
databases. `036` requires empty tenant tables; there is no customer-data upgrade.
Run pending migrations with `scripts/run-migrations.sh platform` or `tenant`.
The runner records checksums and serializes execution; never edit applied SQL.
Tenant runtime SQL must use `getTenantPool(serverAuthorizedTenantId)`, preserving
explicit transactions. Never expose a raw application pool or use session-scoped
tenant settings. New tenant-owned tables require non-null ownership, composite
foreign keys, forced RLS, restricted grants, and isolation tests. Lifecycle purge
uses a separate credential; normal product writes preserve immutable history.

## Hard rules

- Resolve tenant from validated Auth0 `sub` + `myapartment_platform_db` membership. Never trust client tenant ids, token metadata, or host as authz.
- Fail closed: missing `OPERATOR_IDS`, suspended tenant, ambiguous membership (`tenant_selection_required`).
- Parameterized SQL. Bound tenant connection only.
- Platform and tenant SQL objects live in PostgreSQL schemas `block9_platform` and `block9_tenant`, respectively.
- No secrets in git, logs, `NEXT_PUBLIC_*`, or client bundles.
- Do not enable or fake checkout. Do not add SMS/WhatsApp OTP without an approved Auth0-compatible path.
- Invitations: seven-day single-use email; OTP must match invited address; accept still required.
- Display refs `CMP-`/`MNT-` are not API ids (UUIDs are).
- Match existing patterns in the file you edit. No drive-by refactors.

## Verify

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Targeted: `pnpm run test tests/<file>.spec.ts`. Postgres specs need `MYAPARTMENT_DATABASE_TESTS=1`. After API schema or route changes, rebuild/restart `api`. Do not claim production-ready.

## Private images

Complaint photos use direct browser WebP uploads to private S3-compatible staging,
then server validation and separate sanitized objects. API accepts verified upload
UUIDs, not base64. Retention defaults to 90 days. See
[docs/private-image-storage.md](docs/private-image-storage.md). New image flows
must enforce entity/role authorization and use the storage port. Never expose
public object URLs or log signed URLs. Required SQL: platform `010`, tenant `037`.
