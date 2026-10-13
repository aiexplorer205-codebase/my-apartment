# Nivasa

Nivasa is a multi-tenant apartment operations platform for residents,
apartment administrators, and platform operators. The local MVP has
Auth0-backed sign-in, PostgreSQL-backed tenant dashboards and notices, and an
aggregate operator overview. It is a testable release candidate, **not a
production-ready service**: infrastructure approval, restore evidence,
deployment controls, and several product workflows remain incomplete.

## Project documentation

- [Architecture overview](docs/architecture/README.md)
- [Product and system architecture](docs/architecture/product-and-system.md)
- [Tenant isolation and configuration](docs/architecture/tenant-isolation-and-configuration.md)
- [Security and production deployment](docs/architecture/security-and-production-deployment.md)
- [Implementation phases](docs/implementation-prompts/README.md)
- [Local MVP readiness report](docs/production-readiness.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

## Local MVP with Docker Compose

For the full variable-by-variable `.env` guide, manual Auth0 setup, and
step-by-step smoke test, see
[Local Docker Compose setup and testing](docs/local-compose-testing.md).

Prerequisites: Node.js 22 or later, pnpm 9.15.0 (Corepack is recommended),
Docker Compose, and a non-production Auth0 tenant. Auth0 handles sign-in;
operator onboarding email delivery additionally requires a configured Resend
account. Online payments, invoice publication, and queue jobs are not
simulated; see the gated capabilities below.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Set the Auth0 values described below; never use production credentials.

docker compose config --quiet
docker compose up --build -d --wait

docker compose ps
docker compose logs -f api worker admin-web operator-web

docker compose down
```

The repo keeps local settings in the ignored `.env` file at the repository
root. `.env.example` contains placeholders; never commit real credentials or
use production values. PostgreSQL init scripts apply the platform and
`tenant_template` migrations only when creating a fresh volume. Existing
volumes are never reset automatically. For an existing local volume, apply
forward migrations explicitly:

```sh
docker compose exec -T postgres psql -U postgres -d platform_db \
  -v ON_ERROR_STOP=1 -f /migrations/platform_db/001_init_platform.sql \
  -f /migrations/platform_db/002_mvp_access.sql \
  -f /migrations/platform_db/003_operator_onboarding.sql \
  -f /migrations/platform_db/004_email_otp_admin_invites.sql
docker compose exec -T postgres psql -U postgres -d tenant_template \
  -v ON_ERROR_STOP=1 -f /migrations/tenant_db/001_init_tenant.sql \
  -f /migrations/tenant_db/002_mvp_product.sql
```

### Auth0 local setup

Configure two non-production Auth0 Single Page Applications: one for the
resident/admin web app and one for the private operator web app. Enable
passwordless email OTP in Auth0 and configure each app's callback, logout, and
web-origin allowlists for `http://localhost:3100` or `http://localhost:3101`.
Configure the same API audience as a custom API in Auth0. In `.env`, set
`AUTH0_DOMAIN`, `AUTH0_ISSUER`, `AUTH0_AUDIENCE`,
`AUTH0_ADMIN_CLIENT_ID`, `AUTH0_OPERATOR_CLIENT_ID`,
`AUTH0_MGMT_CLIENT_ID`, and `AUTH0_MGMT_CLIENT_SECRET`. Authorize the dedicated
Management API M2M app for `create:users` and `read:users`; set
`AUTH0_PASSWORDLESS_CONNECTION` to the exact Email connection name (normally
`email`). Keep signup disabled on that connection. Set `OPERATOR_IDS` to
a comma-separated list of exact approved operator `sub` claims, for example
`auth0|...`; these are not passwords or tokens. The legacy `OPERATOR_ID`
setting remains supported for one operator when `OPERATOR_IDS` is empty. The
operator API fails closed if no approved identity is configured or the signed-in
subject does not match an approved identity.

### Local tenant test data

No demo users or tenant data are created automatically. After applying schema
migrations and configuring Auth0, create one local tenant database by cloning
the empty template. Replace the example Auth0 subjects and email with accounts
you control in the non-production Auth0 tenant. These commands create test
community records only; they do not bypass Auth0.
For this MVP slice, each resident/admin account should have one active tenant
membership; API requests with an ambiguous multi-tenant membership fail with
`tenant_selection_required`.

```sh
docker compose exec postgres createdb -U postgres -T tenant_template tenant_local

docker compose exec -T postgres psql -U postgres -d platform_db \
  -v ON_ERROR_STOP=1 \
  -v tenant_id=tenant_local \
  -v tenant_slug=local-community \
  -v tenant_name='Local Test Community' \
  -v database_name=tenant_local \
  -v admin_subject='auth0|replace-with-admin-subject' \
  -v resident_subject='auth0|replace-with-resident-subject' <<'SQL'
INSERT INTO tenant_records (id, tenant_id, slug, org_name, status, database_locator, database_name)
VALUES (gen_random_uuid(), :'tenant_id', :'tenant_slug', :'tenant_name', 'active', :'database_name', :'database_name');
INSERT INTO tenant_memberships (subject, tenant_id, role, status)
VALUES (:'admin_subject', :'tenant_id', 'admin', 'active'),
       (:'resident_subject', :'tenant_id', 'resident', 'active');
SQL

docker compose exec -T postgres psql -U postgres -d tenant_local \
  -v ON_ERROR_STOP=1 \
  -v tenant_id=tenant_local \
  -v tenant_name='Local Test Community' \
  -v resident_subject='auth0|replace-with-resident-subject' \
  -v resident_email='resident@example.test' <<'SQL'
INSERT INTO organizations (id, tenant_id, name, locale, currency, timezone)
VALUES (gen_random_uuid(), :'tenant_id', :'tenant_name', 'en-IN', 'INR', 'Asia/Kolkata');
INSERT INTO units (id, tenant_id, number, status, building_name, floor_number, maintenance_minor)
VALUES (gen_random_uuid(), :'tenant_id', 'A-101', 'occupied', 'Main building', 1, 100000)
RETURNING id AS unit_id \gset
INSERT INTO residents (id, auth_subject, unit_id, full_name, email)
VALUES (gen_random_uuid(), :'resident_subject', :'unit_id', 'Local Test Resident', :'resident_email')
RETURNING id AS resident_id \gset
INSERT INTO invoices (id, invoice_number, resident_id, billing_period, due_date, status, total_minor, currency)
VALUES (gen_random_uuid(), 'INV-LOCAL-001', :'resident_id', DATE '2026-10-01', DATE '2026-10-31', 'open', 100000, 'INR')
RETURNING id AS invoice_id \gset
INSERT INTO invoice_items (invoice_id, category, description, amount_minor)
VALUES (:'invoice_id', 'maintenance', 'Monthly maintenance', 100000);
INSERT INTO notices (id, tenant_id, title, body)
VALUES (gen_random_uuid(), :'tenant_id', 'Local test notice', 'This notice was created for local MVP testing.');
SQL
```

The seed is intentionally SQL-driven so identity subjects remain your real
Auth0 identities, not built-in demo accounts. Log into the resident or admin
portal with the corresponding account. Add each approved operator's exact
Auth0 `sub` claim to `OPERATOR_IDS` to grant access to the separate operator
console.

### MVP behavior and gated features

- Resident home, invoice breakdown, payment history, notices, and unit/profile
  data come from the resident's tenant database. Mark-all-read updates
  resident-specific database state.
- Admin overview calculates billing and verified payment totals within the
  authorized tenant database.
- Operator overview reads aggregate organization and provisioning status from
  `platform_db`; it does not show resident-level data or database locators.
- Checkout is disabled until a payment provider and settlement model are
  approved. No fake payment success is available.
- Operator onboarding now provisions a tenant database and sends the first
  administrator a one-time invitation link by Resend. The administrator signs
  in with Auth0 Email OTP only; the API matches the verified email to the
  invitation before granting tenant admin access. Configure the Auth0 email
  connection and Resend sender as described in
  [local setup](docs/local-compose-testing.md) before using it.
- Invoice publishing, resident invitations, offline collection, campaigns,
  organization lifecycle actions, and audit exports are not yet implemented.
  Their controls are disabled or identified as unavailable.
- The worker has truthful health/Redis checks but no job processors yet.
  Firebase and Filebase are not required by these MVP flows and are not
  replaced with local fake providers.
- The resident experience in this slice is the web surface; the canonical
  Flutter resident client is not implemented yet.

Local service URLs:

- API: http://localhost:4101/v1/health
- Admin web: http://localhost:3100
- Operator web: http://localhost:3101 (development-only local access)
- Worker: http://localhost:4110/health
- PostgreSQL: localhost:5434
- Redis: localhost:6381

The API exposes `/openapi.json`, `/v1/health`, and database readiness at
`/v1/ready`. Authenticated APIs require an Auth0 access token with the
configured issuer and audience. The operator console is bound to loopback for
local development; production operator access still requires an approved
private-access design.

Successful local Compose execution does not certify staging or production;
production-only private ingress and provider rules still apply.

## GitHub setup and publishing

Create an **empty** GitHub repository under the organization/account approved
for this project; do not choose a license on behalf of the project owner. If
this working tree has not already been initialized as Git, initialize and
publish it from the repository root:

```sh
# Run only for a working tree that does not already contain .git.
git init -b main
git add .
git diff --cached --check
git status --short
git commit -m "Add Nivasa foundation"
git remote add origin git@github.com:OWNER/REPOSITORY.git
git push -u origin main
```

Replace `OWNER/REPOSITORY` with the approved GitHub location. Review staged
files and confirm no secrets, local environment files, generated output, or
private data are included before committing or pushing. Use an approved SSH
key or GitHub CLI authentication; never put a token in a remote URL.

After pushing, enable branch protection for the default branch and require the
`Foundation CI` workflow to pass before merging. Enable Dependabot alerts and
secret scanning where available. Repository visibility, license, owners,
branch rules, and any organization-specific security settings require project
owner approval.
