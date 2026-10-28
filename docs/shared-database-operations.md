# Shared database operations

Implemented topology: one platform database and one shared application database.
The public product and identity flows remain unchanged. Production launch still
requires the gates in [security-and-ops.md](./security-and-ops.md).

## Credentials and setup

| Credential | Purpose | Privileges |
| --- | --- | --- |
| Bootstrap/migration owner | Initialize and migrate both databases | Administrator; offline/deployment use only |
| `POSTGRES_PLATFORM_URL` | Platform registry, membership, audit | Platform table DML and sequence access; no database creation |
| `POSTGRES_TENANT_URL` | Shared tenant repositories | Restricted login, member of `myapartment_runtime`; forced RLS |
| `POSTGRES_MAINTENANCE_URL` | Operator organization deletion | Member of `myapartment_lifecycle`; can execute purge, cannot read community tables |

Compose initializes logins `myapartment_platform`, `myapartment_app`, and
`myapartment_operator_lifecycle`. Set `PLATFORM_DATABASE_PASSWORD`,
`APP_DATABASE_PASSWORD`, and `LIFECYCLE_DATABASE_PASSWORD` before initial creation.
Use strong independent credentials in production, stored outside git. A changed
environment variable does not rotate an existing PostgreSQL role password.

Initialization creates `myapartment_app_db`, installs all SQL through tenant
`036`, records checksums, and grants privileges. The migration requires empty
application tables and rejects populated data. Existing development volumes
require an explicit fresh database/volume setup; no old database is dropped by
this implementation. Do not use old superuser URLs for tenant runtime access.

## Tenant transactions

Only pass a tenant ID obtained from validated Auth0 identity plus platform
membership, or from the existing verified invitation/lifecycle flow.
`getTenantPool(tenantId)` returns a scoped interface backed by one physical pool
(maximum ten application connections per API process). Standalone SQL runs in its
own transaction. For multi-statement operations acquire a client, BEGIN with the
required isolation level, COMMIT/ROLLBACK, and release in `finally`.

The wrapper sets a restricted role and transaction-local tenant context on that
same client. Never issue session-wide tenant settings or bypass the interface.
All tenant tables, including child records, enforce ownership. SQL filters remain
useful; resident/admin authorization still belongs in the application.

New migrations must explicitly install RLS and appropriate privileges on new
tables/views/functions. UUID primary keys remain globally unique. Business
uniqueness is tenant-local; references must include tenant ownership. Shared
display sequences may have gaps and must not be interpreted as counts or API IDs.

## Migrations

```sh
scripts/run-migrations.sh platform
scripts/run-migrations.sh tenant
# Or an explicit pending file:
scripts/run-migrations.sh tenant 036_shared_tenant_rls.sql
```

Run the explicit `036` example only after `001`–`035` have been applied to empty
tables. There is no `all-tenants` target. The runner uses
`block9_migrations.applied`, checks SHA-256 values, skips completed files, takes a
session advisory lock, and wraps each unapplied file plus its ledger entry in a
transaction. A failed file is not recorded. Previously completed files stay
committed; retry after correcting an unapplied migration. Do not edit applied SQL.

Retain a pre-deployment backup. Prefer forward SQL fixes; an application image
rollback does not reverse a schema change. Restart/rebuild API after migrations.

## Backups and tenant recovery

Back up both databases using an administrator with complete visibility, encrypt
artifacts before off-host storage, and keep PostgreSQL role definitions securely.
Include `block9_migrations` and test restoration to an isolated cluster. RLS-filtered
runtime dumps are not complete backups. RPO, RTO, schedule, retention, legal holds,
and storage quotas still need owner approval before production.

The offline administrator tool exports a consistent tenant snapshot and restores
it into an empty tenant on a schema with exactly matching table names:

```sh
# Supply DATABASE_ADMIN_URL through a protected environment/secret manager.
node scripts/tenant-data.mjs export TENANT_ID /protected/path/community.json
node scripts/tenant-data.mjs restore TENANT_ID /protected/path/community.json
```

Export files contain resident data, are created exclusively with mode 0600, and
must be encrypted and retained according to your policy. Existing files are never
overwritten. Snapshot restore uses administrator privileges, bypasses history
triggers only inside the restore transaction, validates tenant ownership and all
foreign-key relationships before commit, preserves IDs and published content,
and advances shared sequences without rewinding them. Restore is an offline
maintenance operation; do not run it alongside application writes.

For recovery from a full backup: restore the full databases into an isolated
instance, export the affected tenant there, validate the snapshot, then restore
into an empty target tenant during maintenance. Restore the matching platform
membership/registry state separately; the JSON tool intentionally does not grant
access or create identities. Never use tenant deletion as a restore preparation
step: deleted identities retain a tombstone and cannot be resurrected by this tool.
A schema-compatible new community identity requires a separate reviewed import,
not an implicit identifier rewrite.

## Tenant deletion

The authenticated operator lifecycle route marks the organization `deleting`
first. It invokes `purge_tenant` through the separate lifecycle credential and
then removes platform memberships and registry state, keeping the audit trail.
Cleanup is retry-safe. Other communities remain intact.

Purge takes an exclusive tenant lifecycle lock. Tenant transactions take its
shared counterpart and check the tombstone after acquiring it. This drains active
writes and prevents an earlier authorized request from recreating deleted data.
The lifecycle role cannot read tables, and the normal runtime cannot call purge.
Normal deletes continue to enforce immutable finance and published meeting rules.
The schema owner must remain an administrator because purge's fixed SECURITY
DEFINER function temporarily suppresses triggers while deleting just the selected
tenant; do not grant that function to runtime or PUBLIC.

## Verification

```sh
pnpm typecheck
pnpm lint
MYAPARTMENT_DATABASE_TESTS=1 pnpm test
pnpm build
```

Database specs use the isolated `myapartment-schema-check-postgres-1` PostgreSQL 16
container on loopback port 55434. Run `bash scripts/test-database.sh` to create the disposable database, execute all tests, and clean it up. Do not put application data in this test project. Fixtures
create/drop only their own test databases. Migration-stage domain tests exercise
the original SQL steps; shared HTTP and isolation suites apply the complete
schema and exercise restricted runtime roles. The RLS suite checks table coverage,
read/write isolation, foreign keys, missing context, privileges, concurrency,
rollback, abandoned clients, export/restore, and immutable-history purge.

## Verification recorded on 28 October 2026

- `pnpm typecheck`, `pnpm lint`, and `pnpm build`: passed.
- `MYAPARTMENT_DATABASE_TESTS=1 pnpm test`: 192 tests passed in 27 files.
- Fresh PostgreSQL 16 initialization and rebuilt API readiness: passed with restricted platform/application credentials.
- Migration replay skipped applied files; deliberate checksum drift was rejected.
- Authenticated tests verified onboarding without database creation, independent billing for the same period, cross-tenant isolation, and deletion preserving another community and its shared Auth0 identity.
- Export/restore checked schema compatibility, incomplete-export rejection, invalid-reference rollback, and target-tenant isolation.

Provider calls in lifecycle HTTP tests are stubbed. These checks do not validate
live Auth0/Resend configuration, production ingress, a cloud deployment, capacity,
or your off-host backup schedule. Those remain production rollout gates.
