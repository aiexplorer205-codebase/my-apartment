# Resident QR signup, email OTP and passkeys

Every resident needs a verified email. Supported choices are email OTP only, or passkey plus email OTP. Auth0 owns authentication and credentials. MyApartment owns flat invitations, profile details, tenant membership, audit records and application-session invalidation. No Custom Token Exchange is needed.

## Human changes in Auth0

Use a development Auth0 tenant first. These settings are not applied by this repository.

1. Create a **database connection** named `myapartment-residents` (or set `AUTH0_RESIDENT_CONNECTION` to your chosen name). Enable it for the resident Regular Web Application only. Retain the separate legacy `email` passwordless connection for admin/operator; disable that connection for the resident application. Do not enable social or phone authentication for this resident flow.
2. Enable Universal Login and the Identifier First authentication profile. Disable the Classic custom login page. On the resident database connection, activate Attributes: require email for signup and on the profile, use email as the identifier, select OTP verification, and require verification at signup. Disable username and phone identifiers. Allow signup on this connection: Auth0 may create an identity, but MyApartment grants no flat access until invitation acceptance.
3. Allow **Email OTP** for login. Enable passkeys with the button and autofill UI. Under password policy, block passwords for signup, login and self-service password changes, and enable **Support users without a password**. Passkeys remain optional; do not force enrollment. Auth0's progressive enrollment can offer a passkey after OTP, and the app also provides a setup screen.
4. Configure Auth0's email delivery provider and test delivery. Auth0 sends OTP messages. The app's existing Resend configuration sends invitation and security-notification messages; these are separate configurations.
5. On the resident application, enable Authorization Code, Refresh Token and Passwordless OTP grants. The last grant supports fresh email verification in the explicit replacement screen. Enable offline access on the MyApartment API.
6. Activate **My Account API** under Applications → APIs. Keep its user access policy restricted to explicit application grants. Grant the resident application `read:me:authentication_methods`, `create:me:authentication_methods`, and `delete:me:authentication_methods`. Configure the resident application's Multi-Resource Refresh Token policy to allow the MyApartment API and `https://YOUR_AUTH0_DOMAIN/me/` with those scopes; enable offline access where required. MRRT requires a first-party app and APIs allowing skipped consent. Use the same Auth0 domain for login, the My Account audience and requests. Configure any My Account authentication-assurance policy consistently with the email OTP/passkey flow; test it rather than disabling protections blindly.
7. Configure an HTTPS custom auth domain and a WebAuthn relying-party ID valid for **both** the hosted Auth0 page and the resident browser origin. For example, resident app `residents.example.com`, hosted auth `auth.residents.example.com`, RP ID `residents.example.com`. Use the resident subtree rather than the entire organization's domain. Add the exact resident callback (`/auth/callback`), logout and web origins to the application's allowlists. An arbitrary remote RP ID does not work on `localhost`: use an HTTPS development origin within the configured RP subtree to test embedded passkey enrollment.
8. Create a **Post Login Action** from [resident-login-action.js](../infrastructure/auth0/resident-login-action.js), set Action secrets `RESIDENT_CLIENT_ID` to the resident application's client ID and `RESIDENT_CONNECTION` to the database connection name, then deploy and attach it to the Login flow. It restricts resident authentication to the verified database identity and adds the original authentication time to API access tokens. Do not replace this timestamp with token issue time or refresh time. If the original proof is unavailable after refresh, replaced sessions fail closed and require a fresh sign-in.

Set `AUTH0_RESIDENT_CONNECTION` in `.env`, and use the existing resident client ID, secret and session secret. Keep `AUTH0_DOMAIN`/`AUTH0_ISSUER` consistent with your chosen Auth0 login domain. No passkey private key or additional OTP issuer belongs in the application configuration. Keep all secrets server-side.

Official references: [database OTP configuration](https://auth0.com/docs/authenticate/database-connections/passwordless-authentication-for-db-connect), [My Account API](https://auth0.com/docs/manage-users/my-account-api), [MRRT](https://auth0.com/docs/secure/tokens/refresh-tokens/multi-resource-refresh-token), [passkey APIs and RP ID](https://auth0.com/docs/authenticate/database-connections/passkeys/passkey-apis).

## Database and service changes

Apply earlier migrations first. Apply each new file once; the runner does not track migration history.

```sh
scripts/run-migrations.sh platform myapartment_platform_db 010_resident_session_revocations.sql
scripts/run-migrations.sh tenant all-tenants 036_resident_qr_signup.sql
docker compose up --build -d --no-deps api resident-web admin-web
```

`all-tenants` includes the template used when provisioning new organizations. No existing database or Auth0 tenant is automatically modified by this code change.

## Product behavior

Create apartment structure manually, then open Flats & Residents. A vacant eligible flat offers **Generate signup QR** and **Add resident** (manual details plus email invitation). Bulk CSV onboarding is removed from the UI and its send endpoint is retired; apartment structure requests containing resident onboarding details are rejected.

QR generation stores only a random token's hash, enforces the admin's server-resolved tenant and saved flat, and audits the issuing admin. Regeneration revokes previous pending QR tokens. Share the QR privately: it authorizes one enrollment for that flat and expires after seven days. The URL carries the token in its fragment; the resident page moves it to session storage, removes it from the address bar and uses a no-referrer policy. Closing the tab discards the in-progress details; scan the still-valid QR again to restart.

The resident enters name, required email, optional phone, owner/tenant status and start date. Flat/block labels are fixed, and client-supplied flat IDs are ignored during acceptance. Auth0 verifies the email, then the resident explicitly accepts. Invitation consumption, profile creation and flat occupancy changes are serialized in the tenant transaction. A retry after tenant commit can repair platform membership if the platform write failed. Only one current/scheduled resident account can claim the flat through these flows.

Residents can add a passkey from the post-signup screen or Profile → Passkeys and sign-in. **Replace lost passkey** requires a fresh email OTP for the signed-in account, valid for five minutes. Auth0 confirms creation of the new passkey before the previously captured passkeys are deleted. Email authentication methods are preserved. Partial completion can be retried with **Retry finishing a saved replacement** while the verification is valid. Completion sends a security notification, audits application session revocation, and invalidates previous MyApartment API access, including access tokens refreshed from old logins. The resident then signs in again.

This is application access invalidation, not global Auth0 session/refresh-token deletion. Existing application cookies may remain on other devices, but requests using their earlier login proof are rejected. Passkeys can sync across physical devices; removal revokes the credential at Auth0 rather than erasing copies from a password manager. There is no admin device deletion, recovery QR, cooling period or `RELINK_DELAY_HOURS` behavior in this version. Loss of access to the email account is outside this recovery flow.

## Verify after configuration

Test QR rotation, expiry and reuse; mismatched/unverified email; attempts to change the flat; simultaneous QR acceptance; occupied and cross-tenant flats; manual email acceptance; OTP-only login; passkey enrollment and subsequent login; cancelled enrollment; incorrect/expired recovery OTP; replacement with two existing passkeys; interrupted replacement and retry; preserved email OTP; and denial of both old access tokens and refreshed old sessions. Check tenant `resident_access_audit` and platform `platform_audit` without logging tokens or credential responses. Verify actual Auth0 email, RP ID, My Account policy and refresh behavior on the deployed HTTPS origin before enabling this for residents.
