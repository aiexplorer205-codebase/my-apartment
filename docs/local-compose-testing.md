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

Auth0 handles sign-in for resident/admin/operator flows. Resend is also needed
to deliver operator-created administrator invitation links.

1. In a **non-production** Auth0 tenant, create two Single Page Applications:
   one for the resident/admin web app and one for the operator web app.
2. Enable the Auth0 **Email (passwordless)** connection on the resident/admin
   SPA and configure email OTP delivery. Admin sign-in explicitly selects this
   connection, so administrators enter an email and its one-time code; they do
   not use a username or password. Do not use Auth0 Organization invitations
   for this flow because Auth0 does not support passwordless connections for
   Organization invitations.
3. Create or configure a custom Auth0 API whose identifier is
   `https://api.nivasa.local`. Use that exact identifier for the API audience.
4. For each SPA, allow its local origin as a Callback URL, Logout URL, and Web
   Origin:
   - Resident/admin: `http://localhost:3100`
   - Operator: `http://localhost:3101`
5. Copy the tenant's domain and each SPA's client ID into `.env`. Obtain the
   exact `sub` claim for the account approved to use the operator console;
   set it in `OPERATOR_IDS`. It is a subject identifier (for example,
   `auth0|...`), not an email or a token.
6. Create a non-production Auth0 Machine-to-Machine application and authorize
   it for the Auth0 Management API with only `create:users` and `read:users`.
   Set its client ID and secret in `AUTH0_MGMT_CLIENT_ID` and
   `AUTH0_MGMT_CLIENT_SECRET`. Keep the passwordless Email connection's signup
   toggle disabled; the API creates each invited email identity through the
   Management API before sending the app invitation. Set
   `AUTH0_PASSWORDLESS_CONNECTION` to that connection's exact name (usually
   `email`). The passwordless connection must also be enabled for the M2M
   application's client ID, because Auth0 checks the calling client when it
   creates a user. Keep the connection enabled for the resident/admin SPA too.
   If the dashboard cannot enable a connection for an M2M client, an Auth0
   administrator can make this one-time change with the Management API's
   Update Enabled Clients endpoint and `update:connections`, then remove that
   extra permission from the app's M2M grant.
7. Configure `RESEND_API_KEY` and `RESEND_FROM` with a development Resend key
   and a verified sender. Nivasa sends the administrator a single-use
   invitation link via Resend; accepting it requires an Auth0 Email OTP login
   matching the invited address. No Auth0 Organization or
   username/password database connection is needed.

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
| `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET` | Credentials for a dedicated Auth0 Machine-to-Machine application authorized for the Management API with `create:users` and `read:users` only. Enable the Email passwordless connection for this M2M client. Keep the secret server-side. |
| `AUTH0_PASSWORDLESS_CONNECTION` | Exact name of the Auth0 Email passwordless connection used by the admin SPA; normally `email`. |
| `AUTH0_OTP_ENABLED` | Legacy setting; browser login selects Auth0's `email` passwordless connection directly. Configure and enable that connection on the admin SPA in Auth0. |
| `RESEND_API_KEY`, `RESEND_FROM` | Configure a development Resend key and verified sender to deliver organization administrator invitation links. |
| `OPERATOR_IDS` | Comma-separated exact approved operator `sub` claims from Auth0. The API fails closed if the list is empty or the signed-in subject is not listed. |
| `OPERATOR_ID` | Legacy single-operator fallback used only when `OPERATOR_IDS` is empty. Prefer `OPERATOR_IDS`, including for one operator. |
| `AUTH0_REDIRECT_URI`, `AUTH0_OPERATOR_REDIRECT_URI` | The template includes these for reference, but the current Compose setup derives the actual SPA redirect URIs from `ADMIN_WEB_PUBLIC_URL` and `OPERATOR_WEB_PUBLIC_URL`. Keep them aligned if retaining them; do not rely on them to override the app URLs. |

The admin and operator applications use separate client IDs. A configured
Auth0 domain and client ID let the UI initiate sign-in; the API additionally
validates the configured issuer and audience on protected requests.
Organization onboarding creates a tenant database from `tenant_template`,
pre-creates the administrator in Auth0's passwordless Email connection using
the Management API, then sends a seven-day, single-use invitation link via
Resend. Passwordless connection signup remains disabled; the Auth0 OTP login
proves mailbox access, and accepting the app invitation is still required for
membership. The API verifies the access token with Auth0, requires a verified
email matching the invite, and atomically creates
the tenant admin membership. If a step fails after the platform record is
created, the console reports the error and offers **Retry setup** where safe.

### External provider placeholders

Resend is required for administrator invitation emails. Firebase and Filebase
are not used by the current implemented flows. Do not enter production
credentials. Resend's API key and verified sender are separate from Auth0's
own passwordless-email delivery configuration.

| Variables | Local onboarding configuration |
| --- | --- |
| `RESEND_API_KEY`, `RESEND_FROM` | Use a development Resend API key and a sender address/domain verified with Resend. Do not use an unrestricted production sender. |
| `FILEBASE_ENDPOINT`, `FILEBASE_BUCKET`, `FILEBASE_REGION`, `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY` | Use a development bucket and scoped development credentials from Filebase. Keep access keys server-side. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Use a non-production Firebase service account with only required permissions. Keep the private key on one quoted, multiline value in `.env`; do not commit or expose it to browser code. |

Compose forwards Resend credentials to the API for administrator invitations.
Firebase and Filebase remain inactive; supplying their values does not enable
or verify those integrations.

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
