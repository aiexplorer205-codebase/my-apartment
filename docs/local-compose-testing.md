# Local Docker Compose setup and testing

This guide covers the manual setup needed to populate the repository-root
`.env`, start the local stack, and exercise the implemented MVP. It uses
development-only credentials and data. Do not use production accounts or
secrets.

## 1. Prerequisites

- Docker Desktop (or Docker Engine with the Docker Compose v2 plugin), running.
- Node.js 22 or later, Corepack, and pnpm 9.15.0 for installing workspace
  dependencies and running repository commands.
- A non-production Auth0 tenant if you want to sign in and test authenticated
  flows. The containers can start without Auth0 credentials, but the web apps
  will show an authentication-configuration notice and protected API calls
  cannot be tested.

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env` is ignored by Git. Keep real credentials there only; never paste them
into a Dockerfile, command-line argument, issue, or committed file.

## 2. Set up Auth0 for authenticated testing

Auth0 is the only external provider needed by the current MVP's sign-in and
resident/admin/operator flows.

1. In a **non-production** Auth0 tenant, create two Single Page Applications:
   one for the resident/admin web app and one for the operator web app.
2. Enable passwordless email OTP for the applications and set up an email
   delivery method in Auth0. Auth0 remains the identity authority; do not
   substitute a local OTP or demo identity.
3. Create or configure a custom Auth0 API whose identifier is
   `https://api.nivasa.local`. Use that exact identifier for the API audience.
4. For each SPA, allow its local origin as a Callback URL, Logout URL, and Web
   Origin:
   - Resident/admin: `http://localhost:3100`
   - Operator: `http://localhost:3101`
5. Copy the tenant's domain and each SPA's client ID into `.env`. Obtain the
   exact `sub` claim for the account approved to use the operator console;
   set it as `OPERATOR_ID`. It is a subject identifier (for example,
   `auth0|...`), not an email or a token.

If the ports or local origins are changed, update the Auth0 allowlists,
`CORS_ORIGINS`, `ADMIN_WEB_PUBLIC_URL`, `OPERATOR_WEB_PUBLIC_URL`, and the
corresponding published port settings together.

## 3. Fill in `.env`

The checked-in `.env.example` is the authoritative list of variables and safe
local defaults. The following table explains what to replace for this test.

### Local services and URLs

| Variable | Local test value / action |
| --- | --- |
| `NODE_ENV` | Keep `development`. |
| `API_PORT`, `ADMIN_WEB_PORT`, `OPERATOR_WEB_PORT`, `WORKER_PORT` | Keep the defaults `4101`, `3100`, `3101`, and `4110`, unless those host ports are already occupied. These are host ports; containers use their own fixed ports. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Keep the local defaults unless needed for your machine. These credentials are for local development only. If changing them, update both database URLs below to match. |
| `POSTGRES_PORT` | Host port for local database tools; default `5434`. Inside Compose, PostgreSQL is `postgres:5432`. |
| `POSTGRES_PLATFORM_URL` | Use the Compose-network URL for `platform_db`, such as `postgresql://postgres:postgres@postgres:5432/platform_db`, with your chosen local username/password if changed. |
| `POSTGRES_TENANT_URL` | Use the Compose-network URL for `tenant_template`, such as `postgresql://postgres:postgres@postgres:5432/tenant_template`, with matching credentials. |
| `REDIS_HOST`, `REDIS_URL` | Keep `redis` and `redis://redis:6379`; these are Compose service DNS values, not host addresses. |
| `REDIS_PORT` | Host port for local Redis tools; default `6381`. |
| `NEXT_PUBLIC_API_URL` | Keep `http://localhost:4101`; browsers use this URL. |
| `ADMIN_WEB_PUBLIC_URL`, `OPERATOR_WEB_PUBLIC_URL` | Keep `http://localhost:3100` and `http://localhost:3101`. These are also the redirect URIs passed to the Auth0 SDKs. |
| `CORS_ORIGINS` | Keep both local web origins: `http://localhost:3100,http://localhost:3101`. |

PostgreSQL and Redis are started by Compose; no separate local installation or
manual database creation is needed for their initial platform/template
schemas. Do not change the database URLs to `localhost` for container
connections.

### Auth0

| Variable | Local test value / action |
| --- | --- |
| `AUTH0_DOMAIN` | Your Auth0 tenant domain only, without `https://` (for example, `your-tenant.us.auth0.com`). |
| `AUTH0_ISSUER` | The matching issuer URL, including the trailing slash: `https://<AUTH0_DOMAIN>/`. |
| `AUTH0_AUDIENCE` | The API identifier configured above, `https://api.nivasa.local`. |
| `AUTH0_ADMIN_CLIENT_ID` | Client ID of the resident/admin SPA. |
| `AUTH0_OPERATOR_CLIENT_ID` | Client ID of the operator SPA. |
| `AUTH0_CLIENT_ID` | Optional compatibility fallback for the admin SPA; prefer setting `AUTH0_ADMIN_CLIENT_ID`. |
| `AUTH0_OTP_ENABLED` | Keep `false` for this MVP test. The current browser login delegates to Auth0 and does not read this flag; configure the desired passwordless/email sign-in method in Auth0 itself. |
| `OPERATOR_ID` | Exact approved operator account `sub` claim from Auth0. Required for operator authorization; the API fails closed if it is missing or does not match. |
| `AUTH0_REDIRECT_URI`, `AUTH0_OPERATOR_REDIRECT_URI` | The template includes these for reference, but the current Compose setup derives the actual SPA redirect URIs from `ADMIN_WEB_PUBLIC_URL` and `OPERATOR_WEB_PUBLIC_URL`. Keep them aligned if retaining them; do not rely on them to override the app URLs. |

The admin and operator applications use separate client IDs. A configured
Auth0 domain and client ID let the UI initiate sign-in; the API additionally
validates the configured issuer and audience on protected requests.

### External provider placeholders

The current local MVP does not use Resend, Firebase, or Filebase for its
implemented flows. Leave their safe placeholder values unchanged for this
Compose test; no account or key is required to start the stack or test
Auth0-backed resident/admin/operator pages. Do not enter production
credentials. These variables are reserved for provider integrations and are
not a substitute for Auth0's own passwordless-email delivery configuration.

| Variables | When a future test explicitly exercises that integration |
| --- | --- |
| `RESEND_API_KEY`, `RESEND_FROM` | Use a development Resend API key and a sender address/domain verified with Resend. Do not use an unrestricted production sender. |
| `FILEBASE_ENDPOINT`, `FILEBASE_BUCKET`, `FILEBASE_REGION`, `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` | Use a development bucket and scoped development credentials from Filebase. Keep access keys server-side. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Use a non-production Firebase service account with only required permissions. Keep the private key on one quoted, multiline value in `.env`; do not commit or expose it to browser code. |

The Compose file currently forwards only a subset of those integration
variables to containers, and the MVP has no active Resend, Firebase, or
Filebase workflows. Supplying their values alone does not enable or verify an
integration.

### Other settings

| Variable | Local test value / action |
| --- | --- |
| `QUEUE_RETRY_LIMIT` | Keep `3`; it must be a positive integer. |
| `OPERATOR_WEB_PRIVATE_INGRESS` | Keep `true`. Local Compose publishes the operator app on loopback only; this setting is not a production ingress control. |

## 4. Validate and start

Validate Compose without printing the fully interpolated configuration (which
may contain credentials), then build and start all services:

```sh
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

If a port is occupied or a service is unhealthy, inspect its logs:

```sh
docker compose logs --tail=100 postgres redis api worker admin-web operator-web
```

The first database volume initialization applies the platform and
`tenant_template` migrations. Existing volumes are not reset automatically.
For already-created volumes requiring forward migrations, use the migration
commands in the [README local Compose section](../README.md#local-mvp-with-docker-compose).

## 5. Smoke-test the stack

Open the resident/admin app at <http://localhost:3100> and the development-only
operator app at <http://localhost:3101>. Log in through Auth0 with accounts
from the non-production tenant. The local operator port is loopback-bound and
is not a model for production access.

Check service health and API discovery:

```sh
curl --fail http://localhost:4101/v1/health
curl --fail http://localhost:4101/v1/ready
curl --fail http://localhost:4101/openapi.json
curl --fail http://localhost:4110/health
docker compose ps
```

The web health endpoints are `http://localhost:3100/api/v1/health` and
`http://localhost:3101/api/v1/health`. Authenticated API requests require an
Auth0 access token with the configured issuer and audience. Health checks do
not prove Auth0 login or tenant authorization works.

No demo accounts or tenant records are seeded automatically. To test
tenant-scoped resident/admin data, create real test identities in the
non-production Auth0 tenant and follow the manual, development-only SQL in the
[README local tenant test data section](../README.md#local-tenant-test-data),
replacing its example subjects and email with identities you control. This
does not bypass Auth0. The worker currently provides health/Redis status only;
it does not process application jobs.

## 6. Stop the stack

Stop containers while keeping the local PostgreSQL and Redis data:

```sh
docker compose down
```

To intentionally erase local database and queue data, `docker compose down -v`
removes the Compose volumes. Use it only when you mean to reset this local
test data; it is not needed for normal shutdown.

Successful local Compose testing does not certify staging or production.
Production-only private ingress, provider setup, and approval requirements
still apply.
