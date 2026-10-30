# Resident authentication providers

Residents can use self-hosted Better Auth or Auth0. Admin uses a separate Better Auth service; operator uses Auth0. See [admin authentication](admin-authentication.md).
`RESIDENT_AUTH_PROVIDER=better-auth|auth0` is a **server-side deployment flag**, set consistently on API and resident web.
Compose and `.env.example` select Better Auth. Without the variable, standalone processes retain Auth0.
An unknown value fails closed. There is no automatic provider fallback, identity linking or migration.
Switching providers creates independent identities and requires fresh resident onboarding; it is not a seamless rollback for existing accounts.

## Architecture

`resident-web /api/resident-auth/*` proxies an allowlist to the private `resident-auth` Node service.
Browser requests stay on the resident origin. The service owns Better Auth, email OTP, passkeys and session tables.
Six digit OTPs expire after five minutes, allow five attempts, and are stored hashed. Resend delivers codes.
Database-backed IP rate limits and an atomic per-address resend cooldown are shared across instances.
Read-only `/get-session` checks are exempt from the authentication attempt limiter because every resident API request validates its session through that endpoint. Sign-in, OTP and QR limits remain enabled.
Successful OTP can create an identity, but grants **no tenant access**. The original seven-day, single-use
invitation still requires matching verified email and explicit acceptance. Flat/block labels are not authorization.

The resident web backend forwards only the signed session cookie in a namespaced bearer envelope.
The API validates it against the auth service on each request, checks verified email and expiry, namespaces
the subject as `betterauth|id`, then resolves platform membership and the tenant-bound database as before.
No browser-supplied identity or tenant claim is trusted. Better Auth identities cannot use admin or operator routes.
Auth0 identities cannot use resident routes when Better Auth is selected. Suspended tenants remain denied.
Do not configure operator IDs or tenant memberships to bypass these checks.

Sessions have a fixed eight-hour lifetime, no sliding refresh and no cookie cache. Sign-out invalidates server state.
Passkeys are optional; email OTP remains available. QR signup may omit email or collect an optional email address.
If an email is entered, the resident verifies it with Email OTP before registering the passkey; without email,
passkey registration is the first step. Residents with a verified email can request a
fresh OTP and register a replacement passkey from Profile → Passkeys and sign-in. Existing passkeys are retained
until the replacement credential is successfully registered; then previous credentials and other sessions are
invalidated under a transaction and the change is audited. The current verified session remains active.

Residents without a verified email must ask an administrator for a new passkey QR. The admin app issues a
single-use, seven-day reset QR; the resident sees a banner and can cancel it. The current passkey remains valid
until a replacement is registered. Synced passkeys are credentials, not physical devices. Mailbox loss requires a
separately designed identity recovery procedure; administrators cannot bypass mailbox proof here.

## Local setup

1. Copy the new resident settings from `.env.example` into `.env`. Generate `RESIDENT_AUTH_SECRET` with
   `openssl rand -hex 32`; retain it securely across deploys. Set valid `RESEND_API_KEY` and `RESEND_FROM`.
2. Keep `RESIDENT_WEB_PUBLIC_URL=http://localhost:3098` and `RESIDENT_PASSKEY_RP_ID=localhost` locally.
   Local processes outside Compose use `RESIDENT_AUTH_INTERNAL_URL=http://localhost:4120` and a host-reachable
   `POSTGRES_AUTH_URL`. Container processes use service names from Compose.
3. New database volumes apply SQL and auth login grants during bootstrap. For an existing local volume, apply pending migrations and refresh the resident-auth role grants:

   ```sh
   docker compose up -d postgres
   scripts/run-migrations.sh platform
   scripts/run-migrations.sh tenant
   docker compose exec -T postgres bash /docker-entrypoint-initdb.d/05-resident-auth-role.sh
   ```

4. Build and start services:

   ```sh
   docker compose up --build -d --no-deps resident-auth api resident-web
   ```

5. Invite residents by email or generate a QR from Flats & Residents. QR signup may include a resident email for
   Email OTP recovery or leave it blank for passkey-only access. Verify the optional email by OTP before testing
   self-service replacement; test an admin-issued replacement QR and resident cancellation for passkey-only users.
   Different providers do not
   share sessions or memberships. Do not reuse old Auth0 identities as Better Auth identities.

Setting the flag to `auth0` on API and resident web restores the existing embedded Auth0 OTP flow, which still
requires its Auth0 resident client configuration. The resident auth service can be stopped in that mode.

## Cloud and managed PostgreSQL

Use the same OCI containers on a VM, a container service or Kubernetes; no cloud SDK or cloud identity service is required.
Run at least the API, resident web and private resident auth service, with standard PostgreSQL URLs and Resend.
The auth service has `/health` for liveness and `/ready` for database/schema readiness, runs as a non-root user in
its image, and drains connections on SIGTERM. Readiness does not certify email delivery or browser passkeys.

`POSTGRES_PLATFORM_URL`, `POSTGRES_TENANT_URL`, `POSTGRES_MAINTENANCE_URL` and `POSTGRES_AUTH_URL` select database endpoints.
Use TLS with certificate verification for remote databases (for example `sslmode=verify-full` and the provider CA).
Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable database certificate checks. Treat URLs as secrets.
Auth tables are ordinary PostgreSQL tables inside `block9_platform`; tenant RLS and schemas stay in place.
No PostgreSQL provider-specific API or database-per-tenant creation is introduced.

Migration runners can run outside Docker with `psql` installed:

```sh
export PLATFORM_MIGRATION_URL='postgresql://migration-user@managed-host/platform-db?sslmode=verify-full'
export TENANT_MIGRATION_URL='postgresql://migration-user@managed-host/application-db?sslmode=verify-full'
scripts/run-migrations.sh platform
scripts/run-migrations.sh tenant
```

Supply passwords through a secret manager, `.pgpass` or protected environment; avoid shell-history secrets.
The runner checks migration history/checksums. It uses the URL's actual database name, independent of local names.
Provision database logins outside the application: apply `scripts/provision-resident-auth.sql` to the platform
database using `psql` variables for the password. That script assumes the existing `myapartment_platform` login;
adapt that one API-role reference if your managed deployment uses another name. The auth login receives no access
to platform membership/business tables or tenant data. API and auth must not share database credentials.
Apply migrations with an owner/migration login, then run services using restricted logins.

Existing tenant migrations require PostgreSQL RLS, role membership, `citext` and `pgcrypto`; verify provider support
and provisioning permissions before selecting a managed service. Use direct connections or a compatible session
pooler initially. Transaction poolers must be tested with schema startup options, transaction-local RLS and migration
advisory locks; use direct connections for migrations. Switching providers still requires database backup/restore and
application secrets, not merely replacing hostnames. Test the restore on the destination provider.

## Pilot and production checks

- Choose the final HTTPS resident origin and RP ID **before** enrolling production passkeys. An RP ID change can
  require re-enrollment. Never share resident session cookies across admin/operator subdomains.
- Keep auth service and databases private. Publish only the resident web proxy. The ingress must overwrite
  `X-Real-IP`; prevent access bypassing that ingress. When absent, the proxy uses a conservative shared rate bucket.
- Configure origin URLs consistently, secure cookies, HTTPS, trusted reverse proxy settings and email sender DNS.
  Keep CSRF/origin checks enabled. Restrict ingress body sizes and timeouts.
- Size database pools against total replica count. Monitor error/latency rates, resend throttling and Resend delivery;
  never log OTPs, session cookies, invitation tokens or database URLs.
- Back up databases and secrets, exercise restores, pin and patch dependencies, and schedule
  `scripts/resident-auth-maintenance.sql` using an external scheduler. No job processor is added.
- Test wrong/expired/reused OTPs, resend and attempt limits across replicas, incorrect invitation email,
  suspended/cross-tenant access, admin/operator isolation, passkey cancellation, recovery expiry,
  concurrent replacement and immediate rejection of revoked sessions. Exercise Chrome/Safari/mobile passkeys
  and real Resend delivery on the final HTTPS origin before enabling a resident pilot.

## Verification and upstream references

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
The real auth integration suite uses a dedicated disposable database whose name ends in `_auth_test`:
`MYAPARTMENT_AUTH_TEST_DATABASE_URL=... pnpm test tests/resident-auth-postgres.spec.ts`.
Use a fresh database for each run; the suite creates its own schema and never uses application data.

Better Auth is MIT licensed; retain dependency license notices in distributions. Optional hosted services have
separate terms. See [license](https://github.com/better-auth/better-auth/blob/main/LICENSE.md),
[OTP](https://better-auth.com/docs/plugins/email-otp), [passkeys](https://better-auth.com/docs/plugins/passkey),
[sessions](https://better-auth.com/docs/concepts/session-management), and [PostgreSQL](https://better-auth.com/docs/adapters/postgresql).
