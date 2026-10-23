# Fresh-install database verification

The authoritative schema is the ordered SQL in `migrations/platform_db` and
`migrations/tenant_db`, not Prisma schema generation. API provisioning clones
`tenant_template`; therefore the template must have all tenant migrations before
creating organizations.

Docker first initialization runs:

1. `docker/postgres/initdb/01-tenant-template.sql`: creates `tenant_template` and
   installs pgcrypto/citext there.
2. `02-platform-schema.sql`: applies platform migrations 001–009 to `platform_db`.
3. `03-tenant-schema.sql`: applies tenant migrations 001–028 in order to
   `tenant_template`, including complaints, maintenance, grouped reports, accounts, reconciliation
   and opening balances/credits.

PostgreSQL init scripts run only when the database volume is empty. Restarting an
existing volume does not apply changed scripts. No existing volume needs deletion.

## Isolated new-install check

With Docker running, from the repository root, use a new Compose project name
and unused port. This creates its own volume and leaves the main stack intact:

```sh
fresh_project="nivasa-install-$(date +%Y%m%d%H%M%S)"
POSTGRES_DB=platform_db POSTGRES_PORT=55435 docker compose -p "$fresh_project" up -d postgres
POSTGRES_DB=platform_db POSTGRES_PORT=55435 docker compose -p "$fresh_project" logs postgres
POSTGRES_DB=platform_db POSTGRES_PORT=55435 docker compose -p "$fresh_project" exec -T postgres psql -U postgres -d tenant_template -v ON_ERROR_STOP=1 -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
POSTGRES_DB=platform_db POSTGRES_PORT=55435 docker compose -p "$fresh_project" exec -T postgres psql -U postgres -d platform_db -v ON_ERROR_STOP=1 -c "SELECT tenant_id, database_name FROM tenant_records LIMIT 1;"
```

Require logs to show complete initialization without SQL errors. Template tables
must include `complaints`, `complaint_messages`, `complaint_events` and
`maintenance_tasks`, `payment_reports` and `account_entries`, as well as
residents, invoices, payments, apartments, buildings, billing configuration and
polls. `payments.report_id` must be NOT NULL and report/invoice pairs unique.
Posted account rows must reject UPDATE and DELETE. Reconciliation tables
`account_reconciliations`, `account_reconciliation_matches` and
`account_reconciliation_actions` must exist. Finalized account periods must reject
new backdated posted entries until reopened. Opening tables `account_cutovers`, `account_opening_previews`,
`account_opening_batches`, `resident_opening_balances`,
`opening_credit_allocations` and `opening_credit_actions` must exist, along with
view `invoice_payment_credits`. Normal and opening invoices must have separate
uniqueness rules so a cutover does not consume the normal monthly billing slot.
Migration 023 adds stable credit-action IDs and resident ownership; allocations
reference their action so one multi-invoice credit appears once in history.
Migration 024 adds task checklists, same-community complaint source constraints
(no foreign-community complaint links), completion checks and `maintenance_actions`
for auditable, payload-checked retries. A completed task must have all checklist
items checked. Task completion does not create any account entry.
Migration 025 adds poll `closed_at`/`closed_by` and protects recorded closure,
planned schedule and retention from rewriting. Closing before the scheduled
start is valid; the original `ends_at > starts_at` constraint remains intact.
Resident result retention uses the earlier of scheduled end and actual closure,
so retries do not extend availability.
Migration 026 adds `communication_publications`, with a unique community/actor/
request identity, record kind, payload hash and created-record ID. Publication
creates the announcement or poll/options and this retry record in one transaction.
The creation APIs require a UUID `requestKey`; reuse it for identical retries.
Migration 027 adds `complaint_photos` and complaint creation hashes. Composite
foreign keys bind photos to their complaint/community; slots 1–3 cap attachment
count. Stored images are at most 1600 pixels per side and 1 MiB per row.

Create a new organization using the configured operator flow. Confirm the
resulting tenant database exists and inspect its public tables and constraints;
then exercise resident invitation, billing, collections, complaints and
maintenance against that new tenant. This proves the API clones the complete
template rather than merely proving the template itself has tables.

Stop the isolated service when done; retain its volume for inspection:

```sh
POSTGRES_DB=platform_db POSTGRES_PORT=55435 docker compose -p "$fresh_project" down
```

## Existing development databases

This is a fresh-install schema. Migration 019 requires every payment allocation
to belong to a report. It does not guess report groupings for existing ungrouped
payment data. Do not apply it blindly to a database containing old payments.
Migration 023 likewise assumes no pre-existing ungrouped credit actions.
Use the isolated fresh-install procedure for verification; any retained old data
requires a separately reviewed migration. No existing volume has been deleted.

For an empty development tenant/template, the existing migration runner can apply:

```sh
scripts/run-migrations.sh tenant tenant_template 017_complaints.sql 018_maintenance.sql 019_collections_and_accounts.sql 020_account_workflows.sql 021_reconciliation.sql 022_opening_balances.sql 023_resident_payment_history.sql 024_maintenance_workflows.sql 025_poll_closure.sql 026_communication_publications.sql 027_complaint_photos.sql
```

## Automated integration verification

The test runner below uses only the isolated `nivasa-schema-check` container on
port 55434. It reads its development password into process memory, creates a
uniquely named database from `tenant_template`, tests it and drops that generated
database. It never uses an application tenant database. Run with Docker access
and permission to bind the API runtime test server:

```sh
NIVASA_DATABASE_TESTS=1 pnpm test
```

Without the opt-in variable, PostgreSQL tests are skipped; a default green test
run alone does not prove SQL or financial integration. The database suite covers
one report across invoices, one receipt, pending exclusions, concurrent/repeated
confirmation, competing reports, access denial, former-resident settlement,
draft/review/post, immutable posted rows, reversal/replacement, account dates,
resident running balances, internal-note privacy, maintenance expense links,
statement matching, stale snapshots, period closure, audited reopening and
concurrent posting/finalization, full paginated resident payment history, grouped
credit records, complete financial-year totals and protected record details.
Complaint tests exercise more than 200 records, server filters and complete
counts, resident/community privacy, and query routing over authenticated HTTP.
Maintenance tests cover saved checklist progress, versioned and concurrent
completion retries, database checklist/source constraints, paged task search,
complaint-to-task links, and expense links through posting and correction.

## Opening-balance policy and data invariants

Cutovers start on the first day of a month so statement openings remain
consistent. Imported Cash/Bank funds appear in opening balances, not receipts.
Opening resident dues create identifiable invoices; they are not imported when
that resident already has normal invoice/payment activity. Opening credits are
non-cash sources and require explicit administrator review before allocation to
oldest available invoice charges. Pending payment reports are reserved first.

Posted sources retain their original amounts. Corrections create a new source
batch, reversing/replacement fund entries and resident ledger audit events.
Unused cutover dates can move through the same reviewed correction flow. Once
ordinary account or resident billing/payment/credit activity exists, the date is
locked. Used resident openings cannot be rewritten; later adjustments require a
separate reviewed workflow (still TODO). A fund-only correction preserves
collected resident openings. Finalized reconciliations must be reopened before
changing an affected opening. Ordinary postings and newly generated bills cannot
predate the imported cutover because starting balances already include prior
activity.

## Verification status

A new isolated project `nivasa-assignment-check` initialized a new empty
PostgreSQL volume through migration 028 on port 55435. Its tenant template has
36 public tables plus the non-cash credit view. SQL checks confirmed the final
pre-cutover posting and billing guards are installed, with NOT NULL credit-action
identity, resident ownership and allocation-to-action references. The new
maintenance action table and completion/source constraints were also verified.
The final initialization also contains both poll closure columns and the
`poll_closure_immutable` trigger and the publication request table/constraints. Integration project
`nivasa-schema-check` on port 55434 also has migration 028; tests create and clean
up uniquely named clones. The main application databases were not modified.

The HTTP integration suite creates a separate empty platform database, applies
all platform SQL migrations, clones new tenant databases and verifies routes
with locally signed test JWTs and real membership/role checks. It does not claim
real Auth0/email or browser verification.

Use a new project/volume name for each future *fresh* initialization check.
Restarting a retained test volume does not rerun init scripts. A real
operator-created tenant, configured identity/email services and browser journeys
remain required acceptance checks.

The final full suite passed 125 tests across 17 files, including 32 PostgreSQL
invariant tests and twenty-one authenticated HTTP cases. Both app production builds,
API/app typechecks and lint passed. The fresh-check container is stopped after
verification and its volume retained; the integration container remains available.

## Complaint photo storage and upload deployment

Photos are private tenant-database bytes, included in tenant backups and restores;
no object-storage credentials are required. Up to three JPEG/PNG/WebP inputs of
5 MiB and 20 megapixels each are accepted at complaint creation. Sharp decodes,
auto-orients, resizes and strips metadata, storing JPEG only. Original files are
not stored. Complaint and photos commit together; reuse the same request key on
retry. Later photo additions/removal are not exposed; the picker supports removal
before submission. Plan backup capacity for up to 3 MiB of image data per complaint.

Authenticated photo routes check resident ownership or community admin permission
on every read. Private bytes are not service-worker cached. BFFs read requests with bounded stream readers and preserve no-store/nosniff/sandbox headers. The resident Next middleware
limit and resident/API Nginx hosts allow 22 MiB including base64/JSON overhead; the
API still enforces stricter limits on other routes. Configure any additional
reverse proxy or hosting upload limit consistently. Build/install dependencies
from the lockfile so the API receives Sharp's matching native runtime package.

Fresh project `nivasa-photo-check` verified all 36 tables and the photo constraints
on a new volume. The service was stopped afterwards and its volume retained.
The tests use real image codecs and authenticated HTTP; device photo pickers and
real Auth0/BFF journeys remain acceptance checks.

## Community administrator assignment

Migration 028 adds complaint action payload fingerprints and permits audited
maintenance assignment actions; it creates no new tables. Fresh project
`nivasa-assignment-check` initialized all migrations on a new volume and verified
36 public tables, the complaint fingerprint column and assignment action check.

The admin directory requires active same-community admin membership and an
accepted invitation. Verified invitation acceptance stores the admin email in
platform `identity_subjects` for labels; older records use an honest subject label.
No additional platform migration or manual seed is necessary. Assignment is
revalidated on save, and unchanged historical assignments do not prevent replies.
Complaint resident DTOs hide assigned admin subjects.

## Account register pagination

The register reads all authorized activity through 20-entry server pages and
validated date/account/type/status/literal-search filters. Month bounds are the
default date range. Inclusive custom dates affect activity only; Cash/Bank totals
remain tied to the explicit accounts month. Reversed originals have their own
filter and source link. No additional migration is required beyond 028. HTTP
tests verify 521 entries across every page, oldest-entry search, correction status,
full-month fund totals and role/community denial. Browser layout and keyboard
acceptance are still pending.

## Resident ledger periods

Resident ledgers use server pages of 20 residents and 20 activity records,
validated literal search, residency/block filters and optional inclusive dates.
No schema migration is required beyond 028. Opening balances include activity
before the selected start; period charges and confirmed credits derive closing
balances. Running balances are computed before date filtering and pagination.
Current pending reports, current resident balance and unused opening credit are
explicitly separate from period totals. Opening reversals offset the original
debit/credit category; allocation of imported credit does not create a second
credit or a cash receipt. Reads use one repeatable-read snapshot. Ledger source details and grouped collection presentation are implemented;
browser acceptance remains pending.

## Ledger sources

No migration is required beyond 028. Scoped GET source routes validate admin,
community and resident ownership independently. Invoice source lines preserve
carry-forward dues while explaining the net ledger debit. One payment report is
one ledger credit, with invoice allocations, account, confirmation actor/time
and posted account receipt identity in its source detail. Opening sources return
only the selected resident entry and source/correction note, not the complete
multi-resident payload. Source reads use repeatable-read snapshots.

## Monthly accounts summary

No migration is required beyond 028. Complete monthly category totals use posted
expense/other-income sources and their corrections, grouped by Cash/Bank. A
reversal affects its posting month, with the original retained in the earlier
month. Opening entries, collections and drafts are excluded from these category
totals. The monthly fund equation includes net other income. Current invoice
outstanding/overdue and current pending reports are separately labeled and use
the same snapshot; applied non-cash credit reduces dues without creating income
or receipts. Register filters never narrow summary aggregates. The explicit
`posted_with_reversals` status lists all posted audit sources for review.

## Complete collection queue

No migration is required beyond 028. The Collections GET response is a paged
object with `payments`, `total`, `page`, `pageSize` (10) and complete-community
`summary`. Search/status/reported-month filters are server-side; there is no
latest-500 cap. Reported month and current confirmed-month boundaries use
Asia/Kolkata; confirmed totals use confirmation timestamps. Pending totals span
all months. Count, rows and summaries share a repeatable-read snapshot. Confirmed
records open scoped report/invoice source details. Browser acceptance remains.
