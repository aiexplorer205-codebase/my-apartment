# Auth0 passkeys and email OTP implementation plan

Status: proposed implementation plan; no application or Auth0 configuration changes made.

## Goal and decisions

Launch the resident and apartment-admin web apps with Auth0 passkeys for repeat
sign-in and email OTP for onboarding and fallback. The product is unreleased:
do not build legacy account linking, dual-connection compatibility, or identity
migration machinery. Any removal of existing test identities or data must still
be explicit and scoped; implementation must not automatically erase them.

- Keep Auth0 as the identity authority and use New Universal Login.
- Use one database connection supporting both email OTP and passkeys. Do not
  put OTP users in the separate legacy `email` passwordless connection.
- Retain separate resident/admin Auth0 application clients and session cookies.
- Keep apartment membership and authorization in Nivasa's database. Do not
  require one Auth0 Organization per apartment.
- Offer email OTP as the initial fallback. Defer magic links, SMS, social login,
  native mobile passkeys, and custom embedded WebAuthn ceremonies.
- Keep the operator console's authentication and network policy outside this
  change. Audit shared dependencies before removing any legacy functionality.
- Target Auth0 Free plus a production email provider. Verify actual tenant
  entitlements before implementation; do not assume a trial-only feature will
  remain available on Free.

## Current repository baseline

- `apps/resident-web/src/lib/auth0.ts` and the admin equivalent instantiate the
  Auth0 Next.js server client with separate cookies and an API audience.
- Both `src/lib/auth-ui.tsx` files implement embedded four-digit OTP forms.
- Both apps have `src/app/api/auth/passwordless/config/route.ts` and
  `verify/route.ts`; inspect their session behavior before replacing them.
- `apps/api/src/auth0-management.ts` provisions users on the `email` connection,
  sends codes through `/passwordless/start`, and deletes provisioned identities.
- `apps/api/src/index.ts` exposes the public passwordless-start endpoint,
  validates Auth0 JWTs, accepts invitations, and authorizes tenant membership.
- `infrastructure/adapters/src/auth0.ts` contains placeholder OTP behavior;
  establish its callers and remove or implement the relevant contract so it
  cannot authenticate a production user.
- `apps/login-web/src/features/sign-in/sign-in-screen.tsx` is an additional
  sign-in entry point that must route to the appropriate application flow.

## 1. Prove the Auth0 configuration first

Use a non-production tenant and fresh test accounts to validate this complete
flow before refactoring app authentication:

1. Create/configure a database connection with email as identifier, email OTP
   authentication and verified email at signup, and passkeys enabled. Disable
   password authentication if supported by the selected configuration.
2. Enable the connection for the resident and admin clients and use Universal
   Login. Confirm the API audience and refresh-token settings remain compatible.
3. Prove email OTP login, progressive passkey enrollment, repeat passkey login,
   cancelled passkey prompt, and email OTP fallback on a new device.
4. Verify both methods resolve to the same Auth0 subject and that email
   verification remains trustworthy. Never grant access based solely on a
   pre-provisioned `email_verified` flag.
5. Verify how fresh passkey authentication can be requested and evidenced in
   API access tokens. Record the actual supported claims and configuration;
   do not infer authentication strength from an ID token, UI state, or an
   undocumented `amr` value.
6. Verify supported passkey enrollment/deletion management and the distinction
   between authentication time and initial session creation time.

Deliverable: configuration checklist with exact settings, tenant-plan
availability, token behavior, and any unsupported requirements. If a required
feature is unavailable, document the concrete limitation before implementing
an alternative architecture.

## 2. Set domains, email, and environment configuration

- Choose the permanent production authentication hostname, for example
  `auth.example.com`, before enrolling production passkeys. Record the actual
  Auth0 relying-party ID and origin behavior; do not guess a shared root RP ID.
- Both apps redirect to that authentication hostname. Keep separate app
  sessions; never broaden cookie scope just to share authentication.
- Configure exact callback, logout, and allowed-origin URLs per application.
  Document local HTTP localhost behavior and use HTTPS for deployed environments.
- Separate development and production credentials and passkeys. Check which
  environment separation is available within the chosen plan.
- Configure Resend or SES for production authentication emails, verified sender
  DNS, delivery failures, and quota alerts. Include invitations and other
  transactional emails when calculating the sending budget.
- Update `.env.example`, Compose forwarding, and setup documentation with
  non-secret placeholders. Use a distinct database-connection setting rather
  than retaining a misleading `AUTH0_PASSWORDLESS_CONNECTION=email` default.
- Keep client secrets, Management API tokens, and email credentials server-only.

## 3. Replace embedded OTP with hosted authentication

- Retain the branded app entry page and replace embedded OTP inputs with a
  clear sign-in action explaining passkey and email-code options.
- Let Universal Login offer passkeys and its supported alternative-method UI.
  Do not promise an app button can force a specific method until step 1 proves
  a documented way to do so.
- Use the installed Next.js Auth0 SDK's supported authorization/callback flow,
  including state, nonce, PKCE where applicable, and secure session handling.
- Preserve invitation context through a server-controlled flow. Validate
  return paths against allowed local routes; never accept arbitrary redirects.
  Avoid placing invitation secrets in logs or forwarding them unnecessarily
  to third-party authorization parameters.
- Review `auth-provider.tsx`, middleware, API proxy/token refresh behavior,
  logout, and both clients' cookie isolation. Retain existing session durations
  initially unless the security requirements require a deliberate change.
- Update login-web routing and resident/admin invitation screens that currently
  call `EmbeddedLogin`.
- Remove resident/admin legacy config/verify routes and obsolete OTP-start
  callers after checking operator usage. Remove the public API route only if
  no in-scope or out-of-scope client still requires it.

## 4. Update provisioning and invitation acceptance

- Replace legacy passwordless provisioning with the supported database-user
  provisioning flow proved in step 1. Preserve retry and conflict handling.
- Prefer invitation-controlled provisioning with public signup disabled when
  supported. If signup is enabled, an authenticated uninvited account must
  still have zero apartment access; rate-limit invitation creation separately.
- Verify email by actual OTP proof during onboarding. Keep invitation expiry,
  one-time acceptance, expected-email checks, and transaction boundaries.
- One identity may hold multiple apartment memberships or both resident/admin
  roles. Do not create a second identity merely for another app or invitation.
- Update organization/resident provisioning, retries, and deletion logic.
  Deleting one apartment or membership must not delete a shared identity.
- Continue to verify JWT signature, issuer, audience, expiry, active membership,
  required role, and resident status on every protected API request.

## 5. Enrollment, credential management, and recovery

Resident experience:

1. Verify email and accept the invitation.
2. Offer optional passkey enrollment through Auth0's supported flow.
3. Prefer a passkey on return; keep email OTP available.
4. Provide a supported path to add another passkey and remove a lost one,
   with recent authentication and protection against accidental lockout.

Admin experience:

- Encourage a second passkey on another device or password manager.
- Permit email fallback for ordinary access, but define sensitive actions
  explicitly: admin grants, security/email changes, destructive organization
  actions, and payout changes if implemented.
- Enforce recent strong authentication for those actions on the API, with a
  short-lived authorization bound to subject, intended operation, and session.
  Validate the provider evidence established in step 1.
- A newly enrolled passkey after email-only recovery must not immediately
  bypass recovery restrictions. Define trusted enrollment and a controlled
  recovery path before exposing sensitive actions.
- Lost-all-passkeys recovery requires documented verification by another
  authorized administrator or platform support, audit records, notifications,
  and session revocation where appropriate. Email possession alone must not
  immediately restore unrestricted security administration.
- If the selected plan cannot support the required assurance checks, block
  affected actions behind controlled recovery or explicitly revise the launch
  policy; do not silently treat email OTP as equivalent to a passkey.

Do not describe the entire account as phishing-resistant while email fallback
remains available. Keep authentication claims out of product copy unless true.

## 6. Abuse controls and operational readiness

- Use provider OTP expiry, attempt limits, resend cooldowns, and attack
  protections. Prefer at least six-digit OTPs; verify the effective policy.
- Add application rate limits to remaining public invitation/auth endpoints.
  Use generic responses and avoid account-existence disclosure.
- Audit invitation acceptance, recovery, credential changes, and sensitive
  authorization failures. Never record OTPs, tokens, or invitation secrets.
- Track login failures, fallback usage, email delivery/quota failures, and
  onboarding completion. Set billing and quota alerts.
- Keep missing or broken provider configuration visibly unavailable; do not
  substitute fake authentication success.

## 7. Verification and release criteria

Automated coverage must verify:

- Correct SDK redirect/callback integration, return-path validation, and no
  accidental removal of operator authentication dependencies.
- Invalid issuer/audience/token rejection; unauthenticated, wrong-role,
  suspended-member, and cross-tenant access denial.
- Expired/replayed/mismatched-email invitations and concurrent acceptance.
- Shared-identity provisioning/deletion and provider-failure retry behavior.
- Sensitive admin actions reject email-only and stale authentication, including
  immediate passkey enrollment following email-only recovery.
- No production path uses the placeholder OTP verifier or legacy four-digit UI.

Real Auth0 browser verification must cover Safari/iPhone, Chrome/Android,
desktop browsers, unsupported/cancelled passkey prompts, a second device,
OTP expiry/resend, same-subject fallback, credential management, logout, and
session expiry. Mocked tests cannot establish WebAuthn/provider compatibility.

Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build`.
Validate Compose configuration if its environment wiring changes. Report real
provider checks separately from automated checks, with untested cases explicit.

Release only after both apps complete invitation-to-login flows, API tenant
isolation passes, production email delivery works, admin recovery is operable,
and required features remain available outside any Auth0 trial.

## Suggested implementation sequence

1. Auth0 proof of concept and documented configuration.
2. Hosted-login conversion for both apps and invitation entry points.
3. Database-connection provisioning and legacy-route cleanup.
4. Credential management, admin assurance/recovery, and abuse controls.
5. Automated checks, real-device checks, setup documentation, and pilot release.

No compatibility migration is required. Do not deploy or change external tenant
settings as part of merely writing this plan.

## Provider references

Recheck these at implementation time because provider features and plans change.

- [Passwordless authentication on database connections](https://auth0.com/docs/authenticate/database-connections/passwordless-authentication-for-db-connect)
- [Passkeys on database connections](https://auth0.com/docs/authenticate/database-connections/passkeys)
- [Production email providers](https://auth0.com/docs/customize/email/smtp-email-providers)
- [Auth0 pricing and limits](https://auth0.com/pricing)
- [Resend pricing and limits](https://resend.com/pricing)
