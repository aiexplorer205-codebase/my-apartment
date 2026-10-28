# Architecture

MyApartment by BLOCK9 is a multi-tenant apartment operations product for India (INR default, locale per tenant). This document describes the **implemented** system. Visual HTML frames in the prototype directory are optional reference; the running apps are authoritative.

## Runtime

TypeScript pnpm/Turbo monorepo. Four Next.js apps, one Node HTTP API, a worker stub, PostgreSQL, Redis.

| Piece | Path | Role |
| --- | --- | --- |
| Login | `apps/login-web` | App chooser; no Auth0 session |
| Resident | `apps/resident-web` | PWA: home, invoices, offline payment report, notices/polls, complaints, profile |
| Admin | `apps/admin-web` | Property setup, residents, billing, collections, accounts, complaints, maintenance, communications |
| Operator | `apps/operator-web` | Platform overview, org onboarding/lifecycle, audit list |
| API | `apps/api` | Authn/z, tenant routing, product and platform HTTP (`/openapi.json`) |
| Worker | `apps/worker` | Health and Redis readiness only; no job processors |
| Proxy | `infrastructure/proxy/nginx.conf` | Optional local hostname routing |

Web apps keep server-side Auth0 sessions and proxy API calls through `/api/backend`. Browser code never holds Management API or database credentials.

**Not implemented (do not assume):** NestJS, Prisma as the schema source, Flutter resident client, BullMQ processors, live checkout, FCM/Filebase in product flows.

## Packages

| Package | Role |
| --- | --- |
| `packages/domain` | Domain types |
| `packages/application` | Tenant context, provisioning, guards |
| `packages/contracts` | OpenAPI/types |
| `packages/api-client` | HTTP client helpers |
| `packages/shared` | Errors, logging, result types |
| `packages/config` | Env loading |
| `packages/auth-types` | Auth types |
| `packages/ui` | Shared React (complaints, receipts, workspace nav, PWA) |
| `packages/app-platform` | Config, branding, i18n (`en`, `te`) |
| `packages/design-tokens` | CSS tokens |
| `infrastructure/ports` | Ports |
| `infrastructure/adapters` | Auth0, Postgres, Redis, Resend |

Schema is ordered SQL in `migrations/myapartment_platform_db` (`001`–`012`) and `migrations/myapartment_tenant_db` (`001`–`038`). SQL objects are created in PostgreSQL schemas `block9_platform` and `block9_tenant`; each API pool sets the matching `search_path`. Prisma in root `package.json` is unused.

Copy lives in `packages/app-platform/locales/{en,te}/{common,admin,resident,validation}.json`. Keep key parity. Validate with `pnpm platform:validate`.

## Tenant isolation

SaaS tenant = one customer organization (may have multiple blocks/flats). The
platform database remains separate from shared application data:

- `myapartment_platform_db`: tenant records, memberships, operator audit, and provisioning, under `block9_platform`.
- `myapartment_app_db`: shared community tables under `block9_tenant`. Every tenant-owned table has a non-null `tenant_id`, tenant-aware foreign keys, and forced PostgreSQL row-level security (RLS).
- There is no tenant database template or database creation during onboarding. Database locator fields are internal metadata; they never authorize requests or select the tenant database.

`TenantContext` is derived server-side from a validated Auth0 subject plus active
membership and tenant status. Client hints never grant membership. Missing or
ambiguous membership fails closed. Resident/admin permissions remain application
checks within the authorized tenant; RLS does not replace those checks.

`apps/api/src/persistence.ts` owns one bounded application connection pool.
`getTenantPool(tenantId)` returns a scoped database interface, not another physical
pool. Standalone queries run in a transaction; explicit repository transactions
retain their isolation level and execute on one checked-out client. Every
transaction assumes `myapartment_runtime`, sets `app.tenant_id` locally, and holds
a shared tenant lifecycle lock. Commit/rollback clears context; an abandoned
transaction destroys its connection. Runtime logins must not be superusers or
have `BYPASSRLS`. Views use `security_invoker`.

Migration `036_shared_tenant_rls.sql` is an **empty-database boundary**, not a
customer-data migration. It scopes uniqueness, converts foreign keys to include
tenant ownership, enables RLS on all tables, and installs lifecycle controls.
Existing identifiers remain TEXT. UUID API identifiers and published financial
and meeting history retain their existing behavior.

Onboarding inserts organization and apartment rows and sends the existing Auth0
invitation. Operator deletion first blocks platform access, then invokes
`purge_tenant` using a separate lifecycle credential. That role cannot read tenant
tables. Purge removes only the selected tenant, including immutable history, and
keeps a non-personal deletion marker that rejects stale requests. Normal runtime
DELETE cannot bypass history guards or invoke purge.

See [shared-database-operations.md](./shared-database-operations.md) for setup,
migration history, tenant export/restore, and verification.

## Auth and invitations

- API validates JWT issuer, audience, signature/JWKS, and expiry.
- Resident and admin sign-in: Auth0 email OTP, embedded in each app.
- Operator: separate Auth0 app; API require `OPERATOR_IDS` exact `sub` match.
- Operator onboarding creates shared workspace rows, creates the admin in Auth0 via Management API, emails a seven-day single-use link (Resend). Accepting requires OTP on the invited email.
- Resident invitations use the same pattern. SMS/WhatsApp OTP is not enabled.

## Product (shipped)

**Resident:** tenant home, invoice breakdown, payment history, report offline payment, notices and polls, complaints (photos), profile, invitation accept.

**Admin:** apartment setup (manual + CSV review/confirm), unused setup deletion, flats/residents and invitations, billing rules/preview/publish, invoice adjustments, collections (confirm offline reports), overdues, accounts (ledgers, reconciliation, opening balances, credits/refunds), complaints and maintenance (`CMP-`/`MNT-` display ids; UUIDs remain API ids), announcements/polls with retry-safe publication, Minutes of Meeting drafts and reviewed publication with attendance by resident/block/flat.

**Operator:** aggregate overview, create organization, retry provisioning, deactivate/reactivate/delete, audit log list, monetization/transaction views from API data. Campaigns and support consoles are placeholders.

**Gated:** online checkout, worker jobs, report file exports, operator campaigns.

### Minutes of Meeting

[Minutes of Meeting](./minutes-of-meeting-plan.md) supports admin drafts, plain-text meeting notes, attendee selection by block/flat and person, and reviewed publication. Residents see the latest published meeting by meeting date, with older summaries fetched on demand. Publication is retry-safe and version-checked; published content and attendee name/flat snapshots are immutable. Resident responses exclude internal attendance identifiers and publisher subjects. Tenant migration `035_minutes_of_meeting.sql` is required before use; existing application databases were not migrated as part of implementation.

### Apartment setup (summary)

Review (`POST /v1/admin/apartment-setup/review`) stores an immutable draft. Confirm (`…/confirm`) creates blocks/flats and durable invitation rows in one transaction; email is sent after commit and can be retried. CSV: one row per new flat, columns `block,floor,flatNumber,fullName,email,phone,occupancyType,startDate` (omit `block` when the apartment allows only one). Uploads never overwrite existing flats.

### Unused setup deletion (summary)

`POST /v1/admin/property-deletions/review` then `…/confirm` with `DELETE ALL SETUP`. Blocked if any resident history, billing, or linked records exist. Pending invitations need explicit cancel consent.

## API modules

Feature code lives next to routes in `apps/api/src/` (`apartment-setup.ts`, `property-setup-deletion.ts`, `billing-*.ts`, `collections.ts`, `manual-payments.ts`, `accounts.ts`, `complaints.ts`, `maintenance.ts`, `resident-invitations.ts`, `admin-communications.ts`, `meeting-minutes.ts`, and related files). `index.ts` wires HTTP, auth, and OpenAPI.

## Local vs production

Compose publishes services on loopback. Successful local runs do not certify staging or production. See [security-and-ops.md](./security-and-ops.md).

## Private photo storage

Complaint photos are compressed to WebP in the browser, uploaded directly through
short-lived S3 presigned PUT URLs, verified/sanitized by the API, and attached by
UUID. PostgreSQL stores metadata only. Private reads require authorization and a
short-lived signed GET. Default retention is 90 days, with one-day staging and
orphan cleanup. Platform `010` and tenant `037` are required.
See [private-image-storage.md](./private-image-storage.md).

Resident authentication can use a separate self-hosted Better Auth service behind the resident web proxy. Admin/operator remain on Auth0. See [resident provider configuration, database provisioning and deployment](resident-authentication.md).
