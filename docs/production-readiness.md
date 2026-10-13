# Local MVP readiness report

**Decision: NO-GO for production.** This implementation makes a limited
resident/admin/operator MVP runnable locally. It does not complete the
production-readiness exit criteria in
[`implementation-prompts/PHASE-5-PRODUCTION-READINESS.md`](./implementation-prompts/PHASE-5-PRODUCTION-READINESS.md).
No cloud resources were created, no deployment was performed, and no external
provider was enabled.

## Delivered in this change

- Replaced the selectable demo-role login and hard-coded resident/admin/
  operator metrics with Auth0 sign-in and database-backed views.
- Added Auth0 JWT signature, issuer, audience, and expiry verification in the
  API. Tenant membership and database names are resolved from `platform_db`;
  client-supplied tenant selection cannot grant access. Ambiguous memberships
  fail closed for this MVP.
- Added tenant-scoped resident home, invoice breakdown, payment history,
  notices, and mark-all-read APIs; added an admin collection overview and an
  aggregate operator overview.
- Kept checkout disabled pending owner approval of provider and settlement
  policy. Removed the fake OTP acceptance and fake worker job endpoint.
- Added forward-only platform and tenant MVP migrations, local Compose mounts,
  loopback-only published ports, and non-root API, worker, admin, and operator
  image runtimes.
- Documented manual, development-only tenant setup using real Auth0 subject
  identifiers in [`../README.md`](../README.md). No demo identity or automatic
  resident seed is installed.

## Verification performed

| Check | Result |
| --- | --- |
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed |
| `corepack pnpm test` | Passed: 4 files, 17 tests |
| `corepack pnpm --filter @nivasa/api run build` | Passed |
| `corepack pnpm --filter @nivasa/worker run build` | Passed |
| `corepack pnpm --filter @nivasa/admin-web run build` | Passed |
| `corepack pnpm --filter @nivasa/operator-web run build` | Passed |
| `corepack pnpm run ci` | Passed: typecheck, lint, tests, and all workspace builds |
| `docker compose config --quiet` | Passed |
| `docker compose up -d --build --wait admin-web operator-web` / final service health | All six services healthy after correcting web image working directories |
| Platform/tenant SQL migrations | Applied successfully to the local Compose databases |
| HTTP smoke checks | API health/readiness/OpenAPI, both web health routes, and worker health/readiness returned HTTP 200 |
| Anonymous `GET /v1/platform/overview` | HTTP 401 |
| Deprecated `POST /v1/public/auth/otp` | HTTP 410; no OTP challenge is issued |
| Container user check | API, worker, admin web, and operator web run as UID 1000 |

Authenticated business-flow tests were not run: this environment has no
configured non-production Auth0 application or user credentials. The browser
surfaces correctly show a configuration-required state instead of accepting
demo identities.

## Remaining go-live blockers

- **Identity owner:** configure separate non-production Auth0 SPA applications,
  email OTP, callback/logout/web-origin allowlists, and API audience; populate
  local `.env`. Set `OPERATOR_ID` to the approved operator subject. Production
  secret-manager configuration and rotation remain unverified.
- **Product/finance owner:** approve a payment provider, merchant and
  settlement model, accounting ownership, credentials, webhooks, refunds, and
  reconciliation before implementing or enabling checkout.
- **Platform owner:** operator onboarding/provisioning, lifecycle changes,
  campaigns, audit operations, and queue processors remain unimplemented.
  The worker currently exposes truthful health/Redis status only.
- **Product/security owner:** resident invitations, resident/unit management,
  invoice preview/publication, offline collection, exports, and reports remain
  unimplemented. The MVP expects one active tenant membership per account.
- **Operations/data owner:** no approved RPO, RTO, retention, deletion, or
  legal-hold values are recorded. Encrypted backups, inventory, and platform
  or tenant restore tests are absent; no recovery promise is made.
- **Security/platform owner:** production operator private-access technology,
  production ingress, least-privilege database roles, rate limits, full
  tenant-isolation integration tests, audit-write protections, and
  incident/provider-outage runbooks remain open.
- **Release owner:** OCI/Cloudflare Terraform review, CI dependency/container/
  infrastructure scans, staging separation, protected production approval,
  artifact digests, and rollback ownership are not verified.
- **Client owner:** the resident experience in this MVP is the web surface;
  the canonical Flutter resident client is not implemented here.

The local stack is useful for exercising the implemented read and notice
flows after Auth0 and local membership data are configured. Local success is
not evidence of production availability, compliance, tenant-isolation
completeness, backup validity, or deployment approval.

## Local stop and rollback

Stop the local services without deleting local database data:

```sh
docker compose down
```

Do not use `docker compose down -v` unless intentionally deleting the local
PostgreSQL and Redis volumes. Schema changes are forward-only; production
rollback and migration compatibility still require an owner-approved plan.
