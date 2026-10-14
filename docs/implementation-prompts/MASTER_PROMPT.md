# Master implementation prompt — Nivasa

You are implementing the production-oriented Nivasa apartment operations SaaS
in this repository. First inspect the source prototype and architecture
documents. Product behavior comes from
[`../../figma-prototype/src/App.tsx`](../../figma-prototype/src/App.tsx);
the Nivasa architecture and technology decisions are authoritative at
[`../architecture/README.md`](../architecture/README.md).

## Required product

Build the complete prototype feature surfaces for:

1. Residents: email-OTP sign-in, tenant-aware home, maintenance bill breakdown,
   payment review and provider-backed lifecycle, receipts/history, notices,
   profile/unit details, communication/privacy/ad preferences, support, and
   carefully constrained sponsored home placements.
2. Apartment administrators: overview, property/building/unit management,
   resident invitations and access, billing rules and invoice runs,
   collections/offline-payment recording, reconciliation/discrepancies,
   overdue aging and permitted follow-up, reports/exports, organization/team/
   permissions/settings.
3. Platform operators: aggregate overview and health, customer onboarding and
   provisioning, organization lifecycle/plan entitlements, revenue separation,
   campaigns with resident-trust restrictions, platform transaction/
   settlement visibility, support operations, audit logs, and platform
   configuration.

Use the precise feature map in
[`../architecture/product-and-system.md`](../architecture/product-and-system.md).
Prototype data is illustrative only. Replace it with database-backed,
tenant-scoped API behavior and complete loading, empty, validation, success,
failure, and retry states.

For apartment creation, preserve the prototype's three-stage flow: apartment
name/city/address/billing start month; building name/floors/units per floor/
unit prefix and generated numbering preview/optional per-square-foot rate; and
completion. Persist the generated vacant units atomically with their apartment
and building. Validate generation bounds on the server, and never start billing
or send resident notifications as a side effect of setup.

## Architecture that must not drift

- TypeScript pnpm monorepo; Flutter resident client; Next.js admin and separate
  operator web; NestJS modular API and worker; Prisma/PostgreSQL; Redis/BullMQ;
  OpenAPI contracts.
- PostgreSQL `platform_db` plus one database per SaaS tenant, initially on a
  shared private PostgreSQL cluster. A customer may own multiple properties.
- `TenantContext` is derived server-side from validated Auth0 identity and
  active control-plane membership/status. Never trust a client tenant ID,
  token metadata, host header, or UI selection as authorization.
- Platform entitlements, tenant preferences, actor permissions, and platform
  policy are distinct checks. Tenant configuration is typed, declarative,
  validated, versioned, and audited. It cannot execute code or grant
  entitlements.
- Domain/application layers depend on ports, never provider SDKs. Provider
  integrations live in infrastructure adapters.
- Auth0 OIDC with passwordless email OTP as the primary login. Use Resend for
  transactional email and configure Auth0-supported OTP delivery. Optional
  SMS/WhatsApp are login/verification channels only; prefer Twilio messaging
  behind a validated Auth0-compatible delivery adapter and keep disabled until
  the integration is verified and approved. Do not use them for resident
  reminders or announcements.
- Use Firebase FCM for push and Filebase S3-compatible object storage, with
  separate per-environment resources. Keep providers behind ports.
- `PaymentPort` remains provider-neutral. Do not hard-code Razorpay or imply
  live payment processing until provider, merchant model, credentials, and
  settlement rules are approved. Never fake payment success.
- Initial production target is OCI plus Cloudflare and Terraform. The cost
  policy prohibits unapproved paid fallback. The operator web has private
  production ingress only. Staging and production credentials/resources are
  separate.
- Never expose secrets, database locators, raw payment credentials, or
  internal service endpoints to clients or logs.

## Engineering rules

1. Inspect existing files and local instructions before editing. Preserve
   unrelated changes and existing behavior unless the task specifically
   replaces it.
2. Produce end-to-end behavior, not decorative screens: connect every visible
   action to an authorized use case or make its unavailable dependency clear.
3. Generate and keep OpenAPI contracts in sync. Validate all untrusted input;
   use typed results and explicit errors rather than silent fallbacks.
4. Enforce authorization and tenant ownership in the backend even if the UI
   hides an action. Scope repository methods and job payloads explicitly.
5. Make queue jobs idempotent, observable, bounded-retry, and recoverable.
6. Use minor units or documented decimal money with ISO currency; do not store
   formatted display strings or rely on browser arithmetic.
7. Add tests for business rules, permissions, tenant boundaries, integration
   failures, retries, and behavior shifts. Tenant-isolation tests are release
   blockers.
8. Use secure defaults and repository-standard tooling. Do not add dependencies
   without need. Do not deploy, provision external accounts, or apply
   infrastructure without explicit human approval.
9. At completion, report files changed, behavior delivered, commands/tests run
   and results, unresolved decisions, and any manual credentials/setup still
   required.

## Completion criteria

The product is not done because the prototype looks similar. Every prototype
surface has a real API-backed workflow; API authorization and database
isolation are tested; migrations and recovery are operable; environment
configuration and deployment are reproducible; operational telemetry and
human approval gates are documented.

## Phase usage

Execute one phase prompt at a time, in order:

- [`PHASE-1-FOUNDATION.md`](./PHASE-1-FOUNDATION.md)
- [`PHASE-2-TENANT-PRODUCT.md`](./PHASE-2-TENANT-PRODUCT.md)
- [`PHASE-3-PLATFORM-OPERATIONS.md`](./PHASE-3-PLATFORM-OPERATIONS.md)
- [`PHASE-4-LOCAL-DOCKER-COMPOSE.md`](./PHASE-4-LOCAL-DOCKER-COMPOSE.md)
- [`PHASE-5-PRODUCTION-READINESS.md`](./PHASE-5-PRODUCTION-READINESS.md)

Phase 4 must leave the complete first-party product runnable locally with
Docker Compose. Auth0, Resend, Firebase, and Filebase remain external services
configured from the ignored local `.env`; do not add local imitations of those
providers. Do not use production credentials locally.

Before resolving any item in
[`../architecture/open-decisions.md`](../architecture/open-decisions.md),
ask the authorized human or leave the capability safely gated.
