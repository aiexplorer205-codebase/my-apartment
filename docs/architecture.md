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

Schema is ordered SQL in `migrations/myapartment_platform_db` (`001`–`009`) and `migrations/myapartment_tenant_db` (`001`–`035`). SQL objects are created in PostgreSQL schemas `block9_platform` and `block9_tenant`; each API pool sets the matching `search_path`. Prisma in root `package.json` is unused.

Copy lives in `packages/app-platform/locales/{en,te}/{common,admin,resident,validation}.json`. Keep key parity. Validate with `pnpm platform:validate`.

## Tenant isolation

SaaS tenant = one customer organization (may have multiple blocks/flats). Isolation is **database-per-tenant** on a shared private Postgres cluster:

- `myapartment_platform_db`: tenant records, memberships, locators, operator audit, provisioning. Locators never go to clients.
- `myapartment_tenant_<id>`: that organization's units, residents, invoices, payments, notices, complaints, maintenance, and ledgers, under schema `block9_tenant`.
- `myapartment_tenant_template`: clone source for new organizations. It must include every tenant migration before onboarding.

`TenantContext` is derived server-side from a validated Auth0 subject plus active membership and tenant status. A client tenant id, host header, token custom claim, or UI picker is not authorization. Ambiguous multi-tenant membership fails closed (`tenant_selection_required`) in this slice.

## Auth and invitations

- API validates JWT issuer, audience, signature/JWKS, and expiry.
- Resident sign-in: Auth0 Universal Login on a database connection, with required verified email OTP and optional passkeys. Admin sign-in retains embedded Auth0 email OTP.
- Operator: separate Auth0 app; API require `OPERATOR_IDS` exact `sub` match.
- Operator onboarding clones `myapartment_tenant_template`, creates the admin in Auth0 via Management API, emails a seven-day single-use link (Resend). Accepting requires OTP on the invited email.
- Residents join through a flat-specific signup QR or an email invitation. Both require verified Auth0 email and explicit acceptance before platform membership is created. Resident identities are created by Auth0, without pre-provisioning legacy passwordless users. SMS/WhatsApp OTP is not enabled. See [resident authentication setup](./resident-authentication.md).

## Product (shipped)

**Resident:** tenant home, invoice breakdown, payment history, report offline payment, notices and polls, complaints (photos), profile, invitation accept.

**Admin:** apartment setup (manual review/confirm), unused setup deletion, flats/residents and invitations, billing rules/preview/publish, invoice adjustments, collections (confirm offline reports), overdues, accounts (ledgers, reconciliation, opening balances, credits/refunds), complaints and maintenance (`CMP-`/`MNT-` display ids; UUIDs remain API ids), announcements/polls with retry-safe publication, Minutes of Meeting drafts and reviewed publication with attendance by resident/block/flat.

**Operator:** aggregate overview, create organization, retry provisioning, deactivate/reactivate/delete, audit log list, monetization/transaction views from API data. Campaigns and support consoles are placeholders.

**Gated:** online checkout, worker jobs, report file exports, operator campaigns.

### Minutes of Meeting

[Minutes of Meeting](./minutes-of-meeting-plan.md) supports admin drafts, plain-text meeting notes, attendee selection by block/flat and person, and reviewed publication. Residents see the latest published meeting by meeting date, with older summaries fetched on demand. Publication is retry-safe and version-checked; published content and attendee name/flat snapshots are immutable. Resident responses exclude internal attendance identifiers and publisher subjects. Tenant migration `035_minutes_of_meeting.sql` is required before use; existing application databases were not migrated as part of implementation.

### Apartment setup (summary)

Review (`POST /v1/admin/apartment-setup/review`) stores an immutable structure draft. Confirm (`…/confirm`) creates blocks/flats in one transaction. Resident details in structure setup are rejected; bulk CSV onboarding is removed. After saving a flat, admins generate a seven-day single-use signup QR or manually enter resident details and send an email invitation. QR tokens are generated and hashed server-side, rendered locally by the admin browser, and rotated on regeneration. A tenant-wide invitation lock serializes signup, invitation creation, QR generation and resident move-out.

### Unused setup deletion (summary)

`POST /v1/admin/property-deletions/review` then `…/confirm` with `DELETE ALL SETUP`. Blocked if any resident history, billing, or linked records exist. Pending invitations need explicit cancel consent.

## API modules

Feature code lives next to routes in `apps/api/src/` (`apartment-setup.ts`, `property-setup-deletion.ts`, `billing-*.ts`, `collections.ts`, `manual-payments.ts`, `accounts.ts`, `complaints.ts`, `maintenance.ts`, `resident-invitations.ts`, `admin-communications.ts`, `meeting-minutes.ts`, and related files). `index.ts` wires HTTP, auth, and OpenAPI.

## Local vs production

Compose publishes services on loopback. Successful local runs do not certify staging or production. See [security-and-ops.md](./security-and-ops.md).
