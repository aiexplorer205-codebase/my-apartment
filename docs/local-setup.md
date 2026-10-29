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

Create **three Regular Web Applications** (Resident, Admin, Operator) in one Auth0 tenant.

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

Set in `.env`: `AUTH0_DOMAIN`, `AUTH0_ISSUER` (trailing slash), `AUTH0_AUDIENCE`, each app’s `AUTH0_*_CLIENT_ID` / `AUTH0_*_CLIENT_SECRET`, and three independent ≥32-byte session secrets (`AUTH0_RESIDENT_SECRET`, `AUTH0_ADMIN_SECRET`, `AUTH0_OPERATOR_SECRET`). Never put secrets in `NEXT_PUBLIC_*`.

Set `OPERATOR_IDS` to the exact approved operator Auth0 `sub` values (not emails). The API fails closed if the list is empty or the subject is not listed.

Optional: an Auth0 Post Login Action that denies operator-client logins unless `event.user.user_id` is in the same `OPERATOR_IDS` list. The operator app and API still enforce the allowlist.

## Compose

Default host ports: Resident `3098`, Admin `3100`, Operator `3101`, API `4101`, Worker `4110`, PostgreSQL `5434`, Redis `6381`, proxy `8080`. Inside Compose, Postgres is `postgres:5432` and Redis is `redis:6379`. Keep `POSTGRES_*_URL` and `REDIS_URL` on those service names, not `localhost`.

```sh
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Hot reload:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

Open Resident at `http://localhost:3098` or Admin at `http://localhost:3100`
(the admin root redirects to `/dashboard`). Each app provides its own sign-in.

A local `pnpm --filter @block9/admin-web build` does not update a running image. Rebuild the service container after Dockerfile or dependency changes.

Set public origins (`RESIDENT_WEB_PUBLIC_URL`, `ADMIN_WEB_PUBLIC_URL`, `OPERATOR_WEB_PUBLIC_URL`) to the same values as Auth0 allowlists. Invitation emails use those URLs. CORS must include the authenticated app origins.

Optional hosts-file routing through the proxy on port 8080 (`app.myapartment.local`, `admin.myapartment.local`, `ops.myapartment.local`, `api.myapartment.local`). Loopback ports still work.

Firebase and Filebase variables in `.env.example` are unused by current flows.

## Shared databases and migrations

Fresh initialization creates `myapartment_platform_db` (`block9_platform`) and
`myapartment_app_db` (`block9_tenant`), applying every ordered SQL migration through
tenant `038` and platform `012`. It creates separate platform, tenant-runtime, and lifecycle logins.
There is no database-per-tenant template or cloning step.

Use the URLs and password variables in `.env.example`. Existing `.env` files
must be updated: an old PostgreSQL superuser tenant URL is deliberately rejected.
Compose defaults are development examples; production requires independent random
credentials. Preserve passwords across container restarts.

This change requires a fresh empty database. Existing Docker volumes do not
rerun initialization. Preserve any useful developer fixtures before choosing a
fresh volume or explicitly deleting a disposable local volume. The application
will not silently reinterpret or migrate old data.

```sh
scripts/run-migrations.sh platform
scripts/run-migrations.sh tenant
```

The runner targets one platform or shared application database, records SHA-256
checksums, skips applied files, rejects changed history, and serializes runners.
Individual filenames are optional. `all-tenants` and database-name arguments are
removed. Rebuild/restart `api` after SQL or route changes.

Nothing is seeded. Prefer operator onboarding to create a community and invite
its administrator. Local SQL fixtures must explicitly identify their tenant;
runtime writes use a validated membership and transaction-local RLS context.
A single tenant may contain multiple blocks and flats.

See [shared-database-operations.md](./shared-database-operations.md) for credentials,
export/restore, lifecycle deletion, and database test commands.

## Smoke checks

```sh
curl --fail http://localhost:4101/v1/health
curl --fail http://localhost:4101/v1/ready
curl --fail http://localhost:4101/openapi.json
curl --fail http://localhost:4110/health
```

Web health: `http://localhost:3098/api/v1/health`, `http://localhost:3100/api/v1/health`, `http://localhost:3101/api/v1/health`. Health is not Auth0 or tenant-authorization proof.

`docker compose down` keeps volumes. `docker compose down --volumes` deletes local Postgres and Redis data.

## Checks without Compose

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database-backed tests need `MYAPARTMENT_DATABASE_TESTS=1` and the schema-check Postgres container used by those specs.

## Private photo configuration

Text-only complaints work without object storage. Photo upload requires a private
R2/S3-compatible bucket and server-side `S3_*` settings; it fails closed if those
are absent. Apply platform `010` / tenant `037` and rebuild API. Browser image
bytes bypass the web proxy. Configure lifecycle/CORS and scheduled cleanup as
specified in [private-image-storage.md](./private-image-storage.md).

Resident authentication can use a separate self-hosted Better Auth service behind the resident web proxy. Admin/operator remain on Auth0. See [resident provider configuration, database provisioning and deployment](resident-authentication.md).
