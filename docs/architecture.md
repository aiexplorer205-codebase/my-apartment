# Architecture

MyApartment by BLOCK9 is a multi-tenant apartment operations product for India (INR default, locale per tenant). This document describes the **implemented** system. Visual HTML frames in the prototype directory are optional reference; the running apps are authoritative.

## Runtime

TypeScript pnpm/Turbo monorepo. Three Next.js apps, one Node HTTP API, a worker stub, PostgreSQL, Redis.

| Piece | Path | Role |
| --- | --- | --- |
| Resident | `apps/resident-web` | PWA: home, invoices, offline payment report, notices/polls, complaints, profile |
| Admin | `apps/admin-web` | Property setup, residents, billing, collections, accounts, complaints, maintenance, communications |
| Operator | `apps/operator-web` | Platform overview, org onboarding/lifecycle, audit list |
| API | `apps/api` | Authn/z, tenant routing, product and platform HTTP (`/openapi.json`) |
| Worker | `apps/worker` | Health and Redis readiness only; no job processors |
| Proxy | `infrastructure/proxy/nginx.conf` | Optional local hostname routing |

Web apps keep server-side authentication sessions and proxy API calls through `/api/backend`. The resident PWA uses TanStack Query for tenant-and-user-scoped client caching; its conditional `/api/resident/pulse` endpoint carries small change versions and passkey reset status. Authenticated pulse responses are private, ETag-validated and never edge-cacheable. Browser code never holds Management API or database credentials.

The API applies a 60-requests/minute resident limit keyed by the authenticated user subject and returns `429` with `Retry-After`; the resident query retry policy honors that delay. For Cloudflare deployments, manually add cache-bypass rules for `/api/resident/*`, `/api/backend/v1/tenant/*`, and `/api/resident-auth/*`; add edge rate limits for those resident-facing paths (the edge rule is an additional perimeter guard, not the user-keyed application limit); and enable Brotli compression. Application responses set private/no-store headers where appropriate, but zone rules and compression are deployment settings and are not provisioned or verified by this repository.

### Resident change signals

The pulse contains per-community counters stored as `(tenant_id, entity)` rows.
Statement-level PostgreSQL triggers bump them in the same transaction as source
writes. The client fetches full lists only when their screen is enabled, and
invalidates the relevant TanStack Query key after a pulse version changes. A
focus/reconnect refetch only fetches the pulse when its 60-second `staleTime` has
elapsed; there is no fixed polling timer.

Current resident-visible data and its signal scope:

- **Per-community signals:** `notices` writes bump `notices`, `updates`, and
  `home`; `polls` and `poll_options` writes bump `polls`, `updates`, and `home`;
  `meeting_minutes` and `meeting_minutes_attendees` writes bump `minutes` and
  `home`; `organizations`, `units`, and `apartment_buildings` writes bump
  `profile` and `home`. These are community-visible records and are included in
  the pulse ETag for every resident in that community.
- **Per-resident data with no community-wide signal:** `notice_reads`,
  `poll_participation`, and `poll_ballots` are individual resident state. Per-user
  unread/open-poll counts are included in that resident's pulse, so they change
  only that resident's ETag; these tables have no version trigger. `complaints`,
  `complaint_messages`, `complaint_events`, and `complaint_photos` are scoped to
  the complaint's resident; `residents` profile fields, `invoices`,
  `invoice_items`, `payments`, `payment_reports`, `billing_adjustments`,
  `resident_credits`, `resident_credit_uses`, `opening_credit_allocations`, and
  `resident_opening_balances` are also resident-scoped. These have no shared
  version trigger. The resident's own UI updates after its mutations, while
  active queries refresh on focus/reconnect when stale or when reopened.
- **Community ledger without a resident pulse signal:** `account_entries` is a
  community-level ledger, not a resident list. Entries linked to a particular
  resident report are reflected through that resident's payment/report records;
  unrelated ledger entries must not change resident pulse ETags.
- **Poll votes:** participation and ballots do not increment a community-wide
  version per vote. The voter's open-poll count changes their own pulse, and the
  voting client invalidates its poll/update queries. Other residents refresh
  aggregate results when their active query becomes stale and refetches (such
  as on focus) or when they reopen the poll. This avoids shared-counter write
  contention during busy polls.
- **Per-resident authentication state:** a pending passkey-reset QR is looked up
  by the signed-in Better Auth user in the auth service and returned only in that
  session's pulse. The client never supplies the user ID.
- **Not implemented:** money-transparency feeds and resident scheduler data have
  no current tables, endpoints, or change signals.

Every new resident-visible entity must be registered here as per-community or
per-resident, define how its changes reach the appropriate client, and extend
the trigger-registry and behavior tests. Only per-community writes bump a shared
pulse version. Per-resident writes must use a resident-keyed signal or no pulse
signal; they must never bump a community-wide counter. Bulk SQL statements with
community signals use statement-level transition-table triggers and bump once
per distinct tenant/entity in that statement.

The Better Auth five-minute cookie cache is for the resident client session UI;
API authorization calls Better Auth with cookie caching disabled. The API also
has a five-minute per-process cache keyed by a hash of the session bearer, indexed
by user ID for eviction on logout/revocation/passkey replacement. Sensitive auth
operations bypass it and validate against the session database. If the internal
eviction callback is unavailable, an ordinary API read may accept a revoked
session for at most five minutes; sensitive operations still fail closed. This
bound assumes the current single API process; multiple replicas require shared
or broadcast invalidation.

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

Schema is ordered SQL in `migrations/myapartment_platform_db` (`001`–`015`) and `migrations/myapartment_tenant_db` (`001`–`042`). SQL objects are created in PostgreSQL schemas `block9_platform` and `block9_tenant`; each API pool sets the matching `search_path`. Prisma in root `package.json` is unused.

Copy lives in `packages/app-platform/locales/{en,te}/{common,admin,resident,validation}.json`. Keep key parity. Validate with `pnpm platform:validate`.

## Tenant isolation

SaaS tenant = one customer organization (may have multiple blocks/flats). The
platform database remains separate from shared application data:

- `myapartment_platform_db`: tenant records, memberships, operator audit, and provisioning, under `block9_platform`.
- `myapartment_app_db`: shared community tables under `block9_tenant`. Every tenant-owned table has a non-null `tenant_id`, tenant-aware foreign keys, and forced PostgreSQL row-level security (RLS).
- There is no tenant database template or database creation during onboarding. Database locator fields are internal metadata; they never authorize requests or select the tenant database.

`TenantContext` is derived server-side from a validated identity subject plus active
membership and tenant status. Auth0 is used for operator JWTs; isolated Better Auth
services provide admin and resident sessions. Client hints never grant membership. Missing or
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

Onboarding inserts organization and apartment rows and sends an administrator
invitation. Operator deletion first blocks platform access, then invokes
`purge_tenant` using a separate lifecycle credential. That role cannot read tenant
tables. Purge removes only the selected tenant, including immutable history, and
keeps a non-personal deletion marker that rejects stale requests. Normal runtime
DELETE cannot bypass history guards or invoke purge.

See [shared-database-operations.md](./shared-database-operations.md) for setup,
migration history, tenant export/restore, and verification.

## Auth and invitations

Open the resident app directly at `/`, the admin app at `/` (redirects to
`/dashboard`), or the operator app at `/login`. Each app handles its own sign-in.

- API validates JWT issuer, audience, signature/JWKS, and expiry.
- Resident and admin sign-in: isolated Better Auth services with email OTP and passkeys.
- Operator: separate Auth0 app; API require `OPERATOR_IDS` exact `sub` match.
- Operator onboarding creates shared workspace rows and emails a seven-day single-use admin invitation (Resend). Accepting requires OTP on the invited email.
- Resident invitations use the same single-use invitation pattern. SMS/WhatsApp OTP is not enabled.

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

Resident authentication uses a separate self-hosted Better Auth service behind the resident web proxy. Auth0 is reserved for the operator app and API JWT validation. See [resident authentication, database provisioning and deployment](resident-authentication.md).
