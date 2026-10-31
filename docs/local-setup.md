# Local setup

Run MyApartment by BLOCK9 on Docker Compose. Operator sign-in uses a non-production Auth0 tenant; resident and admin sign-in use their isolated Better Auth services. Do not use production credentials.

## Prerequisites

- Node.js 22+, Corepack, pnpm 9.15.0
- Docker Compose v2
- Non-production Auth0 tenant for the operator app (containers start without it; operator sign-in does not)
- Resend development key and verified sender (admin and resident invitations)

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env` is gitignored. `.env.example` is the variable list; never commit real values.

## Auth0

Create one Regular Web Application for the Operator app. Set `http://localhost:3101/auth/callback` as the callback, `http://localhost:3101/` as the logout URL, and `http://localhost:3101` as an Allowed Web Origin. Set Organization Usage to **No Organization**.

Create an Auth0 API whose identifier matches `AUTH0_AUDIENCE` (example: `https://api.myapartment.local`). Configure only `AUTH0_DOMAIN`, `AUTH0_ISSUER` (trailing slash), `AUTH0_AUDIENCE`, and the operator app's `AUTH0_OPERATOR_CLIENT_ID`, `AUTH0_OPERATOR_CLIENT_SECRET`, and `AUTH0_OPERATOR_SECRET`. Never put secrets in `NEXT_PUBLIC_*`.

Set `OPERATOR_IDS` to the exact approved operator Auth0 `sub` values (not emails). The API fails closed if the list is empty or the subject is not listed.

Generate a random `RESIDENT_AUTH_CACHE_INVALIDATION_SECRET` (for example, `openssl rand -hex 32`) and set it in `.env`. Compose passes this same secret to both `api` and `resident-auth` for immediate session-cache eviction after logout, revocation and passkey replacement. Do not leave it blank.

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

Set public origins (`RESIDENT_WEB_PUBLIC_URL`, `ADMIN_WEB_PUBLIC_URL`, `OPERATOR_WEB_PUBLIC_URL`) to the correct app origins; only the operator origin must match Auth0 allowlists. Invitation emails use those URLs. CORS must include the authenticated app origins.

Optional hosts-file routing through the proxy on port 8080 (`app.myapartment.local`, `admin.myapartment.local`, `ops.myapartment.local`, `api.myapartment.local`). Loopback ports still work.

Firebase and Filebase variables in `.env.example` are unused by current flows.

## Shared databases and migrations

Fresh initialization creates `myapartment_platform_db` (`block9_platform`) and
`myapartment_app_db` (`block9_tenant`), applying every ordered SQL migration through
tenant `044` and platform `016`. Migration `040_resident_change_signals.sql`
converts version triggers to statement-level triggers and adds signals for
resident-visible records. Migration `041_resident_signal_scopes.sql` keeps
community-wide signals only for community-scoped data and removes version bumps
for resident-specific state. Migration `042_resident_signal_trigger_cleanup.sql`
removes dependent-table triggers left behind by that scope change. The migrations
create separate platform, tenant-runtime, and lifecycle logins.
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

## Resident Web Push

Web Push is opt-in in resident Profile settings. Generate VAPID keys with
`pnpm --filter @block9/api exec web-push generate-vapid-keys`, set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` in the server
environment, and never expose the private key to a web build. Configure a
separate random `PUSH_DATABASE_PASSWORD`; the API uses the least-privilege
`POSTGRES_PUSH_TENANT_URL` and `POSTGRES_PUSH_PLATFORM_URL` dispatcher logins.
Fresh Compose databases provision those logins. For an existing database, run
the role provisioning SQL against each database with a database administrator
and `-v push_password="$PUSH_DATABASE_PASSWORD"`:
`scripts/provision-push-tenant.sql` on `myapartment_app_db` and
`scripts/provision-push-platform.sql` on `myapartment_platform_db`.

The API dispatcher retries the transactional outboxes at least once. A crash
after provider acceptance but before marking delivery complete may result in
a duplicate; the service worker collapses matching `(type,event id)` tags.
The Web Push provider keys, endpoints, and payloads must not be logged. The
optional process-local counters endpoint requires `PUSH_METRICS_SECRET` in the
`X-Push-Metrics-Secret` header at `/internal/push/metrics`.

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

Resident authentication uses a separate self-hosted Better Auth service behind the resident web proxy. Admin uses its own Better Auth service; operator remains on Auth0. See [resident authentication, database provisioning and deployment](resident-authentication.md).
