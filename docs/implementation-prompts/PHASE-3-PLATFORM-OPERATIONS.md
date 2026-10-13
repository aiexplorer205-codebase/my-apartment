# Phase 3 — platform operator operations

Read [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), prior phase results, and
[`../architecture/product-and-system.md`](../architecture/product-and-system.md)
before implementation. Implement the separate operator console and its API
and worker workflows; do not turn it into a tenant-admin role or expose
tenant-level resident information through aggregate screens.

## Goal

Complete the private platform-operations product: customer onboarding and
tenant provisioning, lifecycle and entitlements, aggregate monitoring,
monetization visibility, campaigns, support, audit, and platform configuration.

## Scope

1. **Operator identity and private surface**
   - Use a distinct operator web app and API audience/authorization boundary.
     Require validated Auth0 identity, an exact approved operator identity
     (or separately approved role policy), and platform role checks on every
     API operation.
   - Fail closed if the approved-operator configuration is absent. The UI is
     not an authorization boundary. Do not provide a public tenant-admin
     route to the operator console.
2. **Aggregate overview and health**
   - Implement aggregate organization, resident, unit, transaction, platform
     revenue, and service-health views from authorized platform data.
   - Ensure organization aggregates cannot reveal resident-level details or
     operational tenant records. Separate platform fees/advertising revenue
     from customer maintenance funds.
3. **Organization onboarding and provisioning**
   - Support customer/organization details, location, initial administrator
     invitation state, estimated units, plan selection, onboarding/review
     status, and provisioning progress.
   - Provision tenant DBs through an idempotent, resumable worker process,
     record schema version and failures, expose safe retry/status, and audit
     operator actions. Never accept client-provided database locators or
     connection details.
   - Activate an organization only after provisioning and required onboarding
     checks succeed. Keep any undecided invitation behavior gated.
4. **Lifecycle, plans, and entitlements**
   - Manage onboarding/active/review/suspended states with explicit
     confirmation, permission checks, and immutable audit events.
   - Manage plans, limits, and platform-owned entitlements. Tenant preferences
     cannot grant a missing plan entitlement. Test every effective feature
     decision against entitlement, tenant preference, permission, and policy
     separately.
5. **Campaigns and resident-trust controls**
   - Implement draft, review, publish, pause, end, eligibility, date range,
     reporting, and frequency cap workflows.
   - Enforce approved home-only placements, clear sponsorship labeling,
     opt-out/preferences, campaign eligibility, and no sensitive-payment
     targeting. Reject checkout, bill-review, payment-processing, and receipt
     placements at both API and UI boundaries.
6. **Transactions, support, audit, configuration**
   - Provide provider-neutral platform transaction/settlement visibility
     without implying a payment gateway is selected or mixing tenant funds
     with platform revenue.
   - Implement platform support queue and safe case metadata. Tenant-data
     access is default-deny; only build elevated access if an approved scope,
     explicit consent/approval, short duration, and full audit design exist.
   - Provide append-only platform audit search/filter/export with redacted
     data and authorization checks.
   - Implement typed, validated, versioned platform configuration and
     integration/access-policy views. Never expose provider secrets or permit
     executable tenant configuration.

## Required tests and phase exit criteria

- Test operator authorization fail-closed behavior, role/permission gates,
  tenant lifecycle transitions, provisioning idempotency/resumption, and
  audit creation.
- Test aggregate views against resident-level data leakage, revenue
  classification, tenant-data access denial, entitlement enforcement, and
  direct API calls that bypass UI visibility.
- Test campaign placement/targeting/date/frequency policy enforcement and
  prove ads do not appear in protected payment workflows.
- Test provider or database failures and operator-visible safe recovery paths.
- Verify all operator UI actions are API-backed and have loading, empty,
  success, validation, error, and retry states.
- Run relevant tests plus repository type-check, lint, and build. Keep
  production operator ingress private and leave unresolved support-access or
  identity-policy choices safely disabled.
