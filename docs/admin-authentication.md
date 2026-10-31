# Admin authentication

Admin uses Better Auth 1.7.14 with email OTP and optional passkeys, isolated from the resident Better Auth service. Operator remains on Auth0. There is no legacy identity migration.

The private admin-auth service uses separate admin_auth_* platform tables, a restricted database login, ADMIN_AUTH_SECRET, host-only myapartment-admin cookies and betterauth-admin| identity subjects. Resident sessions cannot authorize admin routes. Platform memberships, explicit invitation acceptance, active tenant checks and tenant-bound RLS remain required. OTP alone creates no membership.

Open the seven-day invitation, verify its email, explicitly accept, then optionally register a passkey or skip. After subsequent OTP logins, supported secure browsers show the prompt if no passkey exists. Skip is remembered for that session only. Unsupported browsers bypass the prompt. Setup failure allows retry or skip. The security page is /security/passkeys; registration requires OTP within five minutes. Replacement retains the old passkey until success, then revokes older credentials and other sessions and writes an audit event.

## Setup

Set ADMIN_AUTH_SECRET to an independent random secret of at least 32 characters (openssl rand -hex 32), ADMIN_WEB_PUBLIC_URL, ADMIN_PASSKEY_RP_ID, ADMIN_AUTH_DATABASE_PASSWORD and working Resend settings. Choose the final HTTPS origin/RP ID before enrollment. Do not share session cookies across apps. Compose supplies POSTGRES_AUTH_URL to admin-auth from POSTGRES_ADMIN_AUTH_URL or the separate restricted login. Outside Compose use ADMIN_AUTH_INTERNAL_URL=http://localhost:4121 and a host-reachable POSTGRES_AUTH_URL.

Apply pending platform migration 014 with scripts/run-migrations.sh platform. Provision the login with scripts/provision-admin-auth.sql using psql auth_password, or docker compose exec -T postgres bash /docker-entrypoint-initdb.d/06-admin-auth-role.sh after supplying ADMIN_AUTH_DATABASE_PASSWORD to postgres. Fresh initialization runs both automatically. Never edit applied migrations.

Build/restart admin-auth, api and admin-web. Keep admin-auth private. The ingress must overwrite X-Real-IP; missing addresses share a conservative rate bucket. Use HTTPS, exact origin checks, no-store responses and separate service/database secrets. OTPs are hashed, six digits, five-minute expiry, five attempts and a one-minute per-email cooldown; database-backed limits work across replicas. OTP sending uses a 60-request/minute IP ceiling (including the conservative shared fallback when ingress supplies no trusted IP), with the separate atomic one-code/address/minute cooldown. This overrides the plugin default of three sends/minute so multiple admins behind one IP do not exhaust that default. OTP verification limits remain enabled. Sessions expire after eight hours with no refresh/cache.

Verify OTP failures, expiry/replay and rate limits; invitation email mismatch/expiry/reuse; explicit acceptance; suspended/multiple tenants; resident/admin/operator isolation; optional prompt, skip, cancellation and unsupported browser; passkey registration/authentication/replacement and revocation on final HTTPS origins. Run pnpm typecheck, lint, test and build. This is not production certification.
