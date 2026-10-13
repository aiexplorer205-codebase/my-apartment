# Tenant isolation and configuration

## Isolation decision

The SaaS tenant is a Nivasa customer organization/apartment association. One
organization may contain multiple properties, buildings, floors, units, and
resident memberships.

Use PostgreSQL database-per-tenant:

```text
PostgreSQL private cluster
  platform_db
  tenant_<stable-tenant-id-1>
  tenant_<stable-tenant-id-2>
  ...
```

The shared private cluster is the initial hosting boundary; the database is
the tenant data isolation and migration/backup/restore unit. A tenant can later
move to a dedicated cluster by changing its server-side locator. Do not use
schema-per-tenant or shared tenant tables as the isolation mechanism.

## Data ownership

### `platform_db`

Contains control-plane data only:

- Stable tenant ID, organization name, normalized slug, lifecycle state, and
  verified domain mappings.
- Database locator and migration/provisioning status; never exposed to clients.
- Plans, platform-owned feature entitlements and usage limits.
- Tenant-admin and resident membership index needed to establish trusted
  tenant context.
- Identity subject mapping and platform roles.
- Provisioning attempts, operator actions, and platform audit records.
- Non-secret platform-managed tenant configuration required before tenant DB
  creation.

Do not copy operational tenant application records here for convenience.

### `tenant_<id>`

Contains that customer organization's application data only:

- Organization profile, locale, timezone, default currency, branding and
  communication preferences.
- Properties, buildings, floors, units, occupancy, owner/tenant records, and
  resident relationships.
- Tenant-local user profile data, roles/permissions, and notification
  preferences.
- Charge rules, billing periods, invoices, invoice lines, offline payment
  records, payment intents/references, refunds, settlement reconciliation, and
  receipts.
- Announcements, in-app notices, resident ad preferences, campaign delivery
  events as permitted by the campaign policy, and tenant-scoped support data.
- Tenant audit events, import/export jobs and metadata.

Payment card data and authentication secrets must not be stored in tenant
databases. Store only provider references and the minimum payment metadata
needed to fulfill and reconcile the product.

## Trusted tenant resolution

1. Validate the Auth0 token and normalize the subject via `IdentityPort`.
2. Resolve requested organization from a verified host or an explicit
   selection hint. A browser/mobile-supplied tenant ID is not proof of access.
3. Look up active membership, tenant status, entitlements, and database locator
   in `platform_db`.
4. Reject missing, suspended, provisioning, or unauthorized tenants before
   opening a tenant connection.
5. Create an immutable `TenantContext` containing the server-resolved tenant
   ID, actor ID, membership, roles, permissions, entitlements, and trace ID.
6. Resolve the server-side locator through `DatabasePort`, then execute
   tenant repositories only using the connection bound to that context.
7. Apply permission and entitlement checks in the use case/API for every
   protected read and write. UI feature visibility is not an authorization
   check.

Public endpoints resolve only active tenants and return an explicit public
projection. They never expose tenant locators or private member data.

## Connection and database operations

- Keep one explicitly tenant-bound pool per active database locator, with
  bounded pool counts, idle eviction, connection timeouts, and measured pool
  sizing. Never create unbounded pools from arbitrary tenant IDs.
- Cache locators only with a short TTL and explicit invalidation on provisioning
  or tenant moves. Tenant suspension/status checks must not depend only on a
  stale cache.
- Use least-privilege application DB users. Provisioning uses a separate,
  tightly controlled credential for database creation and migration.
- Apply platform migrations to `platform_db` and versioned tenant migrations
  independently. Track tenant schema version and provisioning state.
- Provisioning jobs must be idempotent and resumable. Record failures, expose
  status to authorized operators, retry safely, and retain a dead-letter path.
- Never accept a database name, host, connection string, or database locator
  from a client request, job payload without server validation, or bootstrap
  response.
- Tenant deletion requires an approved retention/export workflow and explicit
  audit. Suspension blocks access; it does not silently delete data.

## Tenant-level configuration model

Configuration is declarative, typed, versioned, schema-validated, and
auditable. A tenant cannot submit HTML, CSS, JavaScript, SQL, arbitrary
templates, executable rules, or provider credentials through a configuration
API.

| Configuration concern | Owner | Examples |
| --- | --- | --- |
| Platform entitlements | Platform/operator | Maximum units, available product modules, campaign eligibility, plan limits |
| Tenant preferences | Authorized tenant admin | Locale/currency, timezone, branding, notice preferences, supported contact details |
| Tenant business rules | Authorized tenant admin | Billing charge definitions, due date, late-fee rules, billing cycle, property/unit defaults |
| Platform policy | Platform/operator | Ad safety rules, allowed placements, global rate limits, integration policy |
| Secrets/integration credentials | Secrets system and approved operator workflow | Identity, payment provider, email, push, storage credentials |

An effective feature is available only when platform entitlement, tenant setting,
and actor authorization all allow it. Tenant settings may disable an entitled
feature but must not grant a feature omitted by the plan or bypass a role check.
The API computes effective capabilities; clients cannot self-assert them.

Validate configuration at write time and on reads where legacy data is
possible. Version changes, actor, timestamp, and before/after hashes or
redacted diffs belong in audit records. Do not log secrets or full payment
credentials. Apply cache invalidation on committed changes.

Feature-specific configuration should include, as applicable:

- Brand name/colors/logo, time zone, locale, and default ISO currency.
- Billing cycle, charge-rule definitions, rounding policy, due dates, grace
  periods, and authorized late-fee policies.
- Allowed notification preferences, tenant public contact information, and
  resident communication policy.
- Tenant plan entitlement and limits, maintained by the platform.
- Home ad placement eligibility and resident preference; never checkout
  placement, sensitive-payment targeting, or tenant-specific arbitrary code.

Do not store currency as formatted text. Use integer minor units or a
documented decimal representation with ISO currency; perform server-side
calculations and render using tenant locale.

## Required isolation tests

Release-blocking automated tests must prove that:

- A user cannot read or mutate another tenant's residents, buildings, bills,
  invoices, payments, notices, reports, files, or support records by changing
  a route ID, host, request body, token claim, or job payload.
- Missing, forged, stale, or conflicting tenant selection hints never select a
  database without active server-side membership.
- Suspended tenants cannot use authenticated or public tenant endpoints.
- Tenant repositories cannot fall back to `platform_db` for tenant-owned data.
- Background jobs bind and revalidate the intended tenant context and are
  idempotent across retries.
- File paths, exports, and signed URLs are scoped to tenant and expire.
- Operator aggregate views do not return resident-level identifying data.
- Entitlement and permission denial is enforced by server use cases even when
  clients directly call APIs.
