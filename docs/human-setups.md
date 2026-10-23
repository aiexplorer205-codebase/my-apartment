# Human setup required

The repository is wired for local development, but it cannot complete identity-provider, production-secret, DNS, or network-security setup automatically. Complete these steps before signing in or deploying.

## Auth0 tenant

Create three Auth0 **Regular Web Applications** for Resident, Tenant Admin, and Operator. The Login web app only presents the app choices and does not need an Auth0 application. Use each authenticated app's distinct client ID and client secret. Use one Auth0 tenant and API audience initially; configure stronger MFA and an appropriate access policy for the Operator app. Enable the Email connection (`email`) and the Passwordless OTP grant for Resident and Tenant Admin applications.

For each authenticated app, set its callback and logout URLs to its own origin plus `/auth/callback` and `/`, respectively. Add each origin to Allowed Web Origins. Local origins are:

| App | Origin | Callback |
| --- | --- | --- |
| Resident | `http://localhost:3098` | `http://localhost:3098/auth/callback` |
| Admin | `http://localhost:3100` | `http://localhost:3100/auth/callback` |
| Operator | `http://localhost:3101` | `http://localhost:3101/auth/callback` |

Set `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, and the Resident, Tenant Admin, and Operator `AUTH0_*_CLIENT_ID` / `AUTH0_*_CLIENT_SECRET` values in `.env`. The login web app only lets users choose an app and does not need an Auth0 application. Generate three independent high-entropy session secrets (at least 32 bytes) for `AUTH0_RESIDENT_SECRET`, `AUTH0_ADMIN_SECRET`, and `AUTH0_OPERATOR_SECRET`. Never reuse them or expose them through `NEXT_PUBLIC_*` variables. Each authenticated app uses a distinct Auth0 session cookie name so apps on the same hostname do not overwrite one another's sessions. Enable the Passwordless OTP grant for the Resident and Tenant Admin applications in Auth0. Set `AUTH0_ISSUER` to the issuer URL for the same tenant and configure the API to validate the chosen issuer and audience.

For API-managed invitations, configure a separate Auth0 Machine-to-Machine application authorized for the Management API scopes the backend uses. Set `AUTH0_MGMT_CLIENT_ID` and `AUTH0_MGMT_CLIENT_SECRET`. Configure `RESEND_API_KEY` and a verified `RESEND_FROM` sender for invitation email. The API remains responsible for membership and operator authorization; configure `OPERATOR_IDS` with the exact approved Auth0 `sub` values.

The Login app routes users to the selected app's embedded email-code sign-in. Resident and Tenant Admin each keep their own server-side Auth0 session; the API must continue checking tenant membership and role on every protected request.

## Local configuration and run

Copy `.env.example` to `.env`, replace placeholders, and keep `.env` out of version control. The example uses localhost ports: Login `3099`, Resident `3098`, Admin `3100`, Operator `3101`, API `4101`, PostgreSQL `5434`, Redis `6381`, and reverse proxy `8080`.

Install and run the services:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose config --quiet
docker compose up --build -d --wait
```

Open `http://localhost:8080` and use local host routing for named apps if desired (for example, add `127.0.0.1 login.nivasa.local app.nivasa.local admin.nivasa.local ops-login.nivasa.local ops.nivasa.local api.nivasa.local` to the machine's hosts file). Direct app ports remain available on loopback. Use the existing migration and local data setup in [README.md](../README.md). For live development, combine the base Compose file with its override: `docker compose -f compose.yaml -f compose.dev.yaml up -d --build`.

## URLs and resident invitations

Set `LOGIN_WEB_PUBLIC_URL`, `RESIDENT_WEB_PUBLIC_URL`, `ADMIN_WEB_PUBLIC_URL`, and `OPERATOR_WEB_PUBLIC_URL` to the canonical origins used by users and proxy host routing. The API sends Resident invitations to `RESIDENT_WEB_PUBLIC_URL`; Admin invitations continue to use `ADMIN_WEB_PUBLIC_URL`. Keep authenticated app origins aligned with Auth0 callback allowlists. Non-local production origins must use HTTPS.

## Production deployment

Provide production secrets through the deployment secret manager, not checked-in files or image build arguments. Configure DNS for Login, Resident, Admin, Operator login/console, and API origins. Terminate HTTPS at a managed load balancer or TLS-enabled reverse proxy and forward the original host and HTTPS scheme to the apps. The included Nginx config routes hostnames over HTTP inside the Compose network; it does not provision certificates or provide public TLS by itself.

Keep database, Redis, API, and app ports private. Restrict Operator ingress with an approved private-network or identity-aware access layer in addition to Auth0 MFA, API permission checks, and audit logging. Configure persistent storage, database backups and restore procedures, monitoring, log retention, and deployment health checks. Review Auth0 callback/logout/origin allowlists for exact production URLs. Do not enable production deployment until these controls and provider settings have been supplied by the deployment owner.

## Resident PWA behavior

The Resident app exposes a web manifest and registers a network-only service worker. Decide how users should be told when they are offline; authenticated API responses and tenant data are not cached for offline authorization or access.


## For testing build web apps as 

You can build a frontend without rebuilding Compose images. From the repo root, for example:

`pnpm --filter @nivasa/admin-web build`

Replace admin-web with `login-web`, `resident-web`, or `operator-web` for another app. This runs that app’s next build script. The repo-wide pnpm build runs the Turbo build for all packages and apps.
One distinction: the Compose dev override runs next dev, which compiles as you work. If you’re using that setup, you usually don’t need a separate frontend build. If you want the running container to use a production build, you’ll need to rebuild that app’s Docker image and recreate its container; a local pnpm ... build does not update the image.



### Delete local data 

From the repository root, this resets the local Docker databases and Redis data, then initializes the stack from scratch:

```sh
docker compose down --volumes --remove-orphans
docker compose up --build -d --wait
docker compose ps
```

`down --volumes` deletes the Compose volumes, including PostgreSQL’s `postgres-data` and Redis’s `redis-data`. This permanently removes local platform data, tenant databases, and queued Redis data. It does not delete Docker images or Auth0 users.

The fresh PostgreSQL volume initialization creates the platform database and `tenant_template`. If you want to check that they exist:

```sh
docker compose exec postgres psql -U postgres -d postgres -c '\l'
```

Run these commands with your local development Compose configuration. Don’t use them for production data.
## Correcting published maintenance charges

Apply `029_billing_adjustments.sql` to the template and all existing tenants
before deploying the updated API:

```sh
scripts/run-migrations.sh tenant all-tenants 029_billing_adjustments.sql
```

Run this migration once per database; the current runner does not track migration
history. Fresh volumes include it automatically.

In **Billing**, choose **Adjust charges / history** on an invoice. Select the
original charge line, credit or additional charge, amount, posting date and
reason. Review the resulting charges, outstanding amount and any new resident
credit before posting. Published invoices and lines stay unchanged; numbered
adjustments remain separately visible. Pending payment reports must be resolved
first. Imported opening invoices use the existing opening correction workflow.

For the same correction across residents, expand **Correct multiple published
invoices**, select up to 100 invoices and review every resident's result. The
whole batch posts in one transaction; a stale or invalid invoice rolls it back.
Use individual corrections for different amounts or multiple matching lines.

In **Accounts → Resident ledgers**, open a resident and use **Adjustment
credits** to apply available credit to an outstanding invoice or record a refund
already paid outside the app. Both actions require review. Applying credit adds
no cash receipt. Refunds consume credit once and create a separate Cash/Bank
outflow, shown separately from vendor expenses. Refund records cannot be reversed
as ordinary expenses. Residents see adjustments, credit uses and refunds in
payment history; administrators can inspect adjustment and refund ledger sources.

Invoice charges and invoice adjustments change resident receivables. Confirmed
payment reports create one cash receipt with invoice allocations. Repair/vendor
expenses link to maintenance tasks or complaints independently; completing a task
does not automatically bill residents. Existing posted vendor expenses retain the
reversal/replacement flow. Carried dues are excluded from new ledger charges.

Post corrections after the finalized account period and opening cutover. The
original invoice date is retained. Current invoice/overdue balances include
adjustments; dated resident ledgers record adjustments on their posting date.
The account registers are Cash/Bank books and resident subledgers, not a balanced
double-entry general ledger. Report exports remain unavailable in the current app.
