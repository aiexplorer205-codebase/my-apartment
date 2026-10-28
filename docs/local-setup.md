# Local setup

Run MyApartment by BLOCK9 on Docker Compose with a non-production Auth0 tenant. Do not use production credentials.

## Prerequisites

- Node.js 22+, Corepack, pnpm 9.15.0
- Docker Compose v2
- Non-production Auth0 tenant (containers start without it; sign-in does not)
- Resend development key and verified sender (admin and resident invitations)

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env` is gitignored. `.env.example` is the variable list; never commit real values.

## Auth0

Create **three Regular Web Applications** (Resident, Admin, Operator) in one Auth0 tenant. Login web only lists app choices and does not need an Auth0 application.

Enable the Email connection (`email`) and the Passwordless OTP grant on Resident and Admin. Set **Organization Usage** to **No Organization**. MyApartment stores tenants and memberships in its own databases.

Local allowlists per app: origin as Callback (`{origin}/auth/callback`), Logout (`{origin}/`), and Allowed Web Origins.

| App | Origin | Callback |
| --- | --- | --- |
| Resident | `http://localhost:3098` | `http://localhost:3098/auth/callback` |
| Admin | `http://localhost:3100` | `http://localhost:3100/auth/callback` |
| Operator | `http://localhost:3101` | `http://localhost:3101/auth/callback` |

Also create:

- An Auth0 API whose identifier matches `AUTH0_AUDIENCE` (example: `https://api.myapartment.local`).
- A Machine-to-Machine application for the Management API with `create:users`, `read:users`, and `delete:users`. Enable the Email passwordless connection for that M2M client. Keep connection signup disabled; the API creates invited users.

For resident QR signup, email OTP and optional passkeys, complete [the resident Auth0 setup](./resident-authentication.md). Residents use a separate database connection; retain the legacy email connection for admin/operator.

Set in `.env`: `AUTH0_DOMAIN`, `AUTH0_ISSUER` (trailing slash), `AUTH0_AUDIENCE`, each app’s `AUTH0_*_CLIENT_ID` / `AUTH0_*_CLIENT_SECRET`, and three independent ≥32-byte session secrets (`AUTH0_RESIDENT_SECRET`, `AUTH0_ADMIN_SECRET`, `AUTH0_OPERATOR_SECRET`). Never put secrets in `NEXT_PUBLIC_*`.

Set `OPERATOR_IDS` to the exact approved operator Auth0 `sub` values (not emails). The API fails closed if the list is empty or the subject is not listed.

Optional: an Auth0 Post Login Action that denies operator-client logins unless `event.user.user_id` is in the same `OPERATOR_IDS` list. The operator app and API still enforce the allowlist.

## Compose

Default host ports: Login `3099`, Resident `3098`, Admin `3100`, Operator `3101`, API `4101`, Worker `4110`, PostgreSQL `5434`, Redis `6381`, proxy `8080`. Inside Compose, Postgres is `postgres:5432` and Redis is `redis:6379`. Keep `POSTGRES_*_URL` and `REDIS_URL` on those service names, not `localhost`.

```sh
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Hot reload:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

A local `pnpm --filter @block9/admin-web build` does not update a running image. Rebuild the service container after Dockerfile or dependency changes.

Set public origins (`LOGIN_WEB_PUBLIC_URL`, `RESIDENT_WEB_PUBLIC_URL`, `ADMIN_WEB_PUBLIC_URL`, `OPERATOR_WEB_PUBLIC_URL`) to the same values as Auth0 allowlists. Invitation emails use those URLs. CORS must include the authenticated app origins.

Optional hosts-file routing through the proxy on port 8080 (`login.myapartment.local`, `app.myapartment.local`, `admin.myapartment.local`, `ops.myapartment.local`, `api.myapartment.local`). Loopback ports still work.

Firebase and Filebase variables in `.env.example` are unused by current flows.

## Migrations

Init scripts on a **new** Postgres volume apply `migrations/myapartment_platform_db` `001`–`009` to database `myapartment_platform_db` in schema `block9_platform`, and `migrations/myapartment_tenant_db` `001`–`029` to `myapartment_tenant_template` in schema `block9_tenant`. Existing volumes are never reset. The runner does not record history; apply each file once, in order.

Tenant migrations `030`–`035` (bulk import, setup deletion, apartment setup reviews, readable `CMP-`/`MNT-` references, Minutes of Meeting) are not in the init script. Apply them to the template and every tenant after first start, and after any volume that was created before those files existed:

```sh
scripts/run-migrations.sh tenant all-tenants \
  030_bulk_resident_imports.sql \
  031_property_setup_deletion.sql \
  032_delete_all_property_setup.sql \
  033_apartment_setup.sql \
  034_readable_work_references.sql \
  035_minutes_of_meeting.sql
```

If `030`–`034` have already run, apply only the new MoM migration once:

```sh
scripts/run-migrations.sh tenant all-tenants 035_minutes_of_meeting.sql
```

MoM appears under Community in admin and in resident navigation. Admins save drafts, select attendees by block/flat/person, review, and publish. Residents open the latest meeting by meeting date and fetch older meetings on demand. Published notes and attendance snapshots cannot be edited. No new provider keys or worker processes are needed.

`all-tenants` updates `myapartment_tenant_template` and every database in `myapartment_platform_db.tenant_records`. Then rebuild the API:

```sh
docker compose up --build -d --no-deps api
```

For QR signup and passkey session invalidation, also apply these new files **once** (after the earlier migrations):

```sh
scripts/run-migrations.sh platform myapartment_platform_db 010_resident_session_revocations.sql
scripts/run-migrations.sh tenant all-tenants 036_resident_qr_signup.sql
docker compose up --build -d --no-deps api resident-web admin-web
```

## Local tenant data

Nothing is seeded. Clone the template, insert platform memberships and tenant rows with **your** Auth0 `sub` values. Prefer one active tenant membership per account; ambiguous memberships fail with `tenant_selection_required`.

```sh
docker compose exec postgres createdb -U postgres -T myapartment_tenant_template myapartment_tenant_local

docker compose exec -T postgres psql -U postgres -d myapartment_platform_db \
  -v ON_ERROR_STOP=1 \
  -v tenant_id=myapartment_tenant_local \
  -v tenant_slug=local-community \
  -v tenant_name='Local Test Community' \
  -v database_name=myapartment_tenant_local \
  -v admin_subject='auth0|replace-with-admin-subject' \
  -v resident_subject='auth0|replace-with-resident-subject' <<'SQL'
SET search_path TO block9_platform, public;
INSERT INTO tenant_records (id, tenant_id, slug, org_name, status, database_locator, database_name)
VALUES (gen_random_uuid(), :'tenant_id', :'tenant_slug', :'tenant_name', 'active', :'database_name', :'database_name');
INSERT INTO tenant_memberships (subject, tenant_id, role, status)
VALUES (:'admin_subject', :'tenant_id', 'admin', 'active'),
       (:'resident_subject', :'tenant_id', 'resident', 'active');
SQL
```

Then insert organization, unit, resident, and optional invoice/notice rows in `myapartment_tenant_local` under `block9_tenant`, using the same subjects. Operator onboarding also provisions a database named `myapartment_tenant_<id>` from the template and emails the first admin invitation.

## Smoke checks

```sh
curl --fail http://localhost:4101/v1/health
curl --fail http://localhost:4101/v1/ready
curl --fail http://localhost:4101/openapi.json
curl --fail http://localhost:4110/health
```

Web health: `http://localhost:3098/api/v1/health`, `http://localhost:3099/api/v1/health`, `http://localhost:3100/api/v1/health`, `http://localhost:3101/api/v1/health`. Health is not Auth0 or tenant-authorization proof.

`docker compose down` keeps volumes. `docker compose down --volumes` deletes local Postgres and Redis data.

## Checks without Compose

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database-backed tests need `MYAPARTMENT_DATABASE_TESTS=1` and the schema-check Postgres container used by those specs.
