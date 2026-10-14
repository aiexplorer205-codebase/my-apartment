# Nivasa architecture

This is the implementation baseline for turning the Figma Make prototype in
[`../../figma-prototype/`](../../figma-prototype/) into a production-oriented,
multi-tenant apartment operations SaaS. The sample architecture in
[`../../sample-architecture/`](../../sample-architecture/) supplies the
technology and isolation patterns; the Nivasa prototype supplies the product
domain and user-facing feature scope.

## Decisions from the prototype and product discussion

- Product: Nivasa for apartment associations and residential communities in
  India. The prototype, not the sample church domain, is authoritative for
  product capabilities.
- SaaS tenant: one customer organization/apartment association. A tenant may
  manage multiple properties, buildings, floors, and units.
- Database isolation: a separate PostgreSQL database per SaaS tenant, with
  `platform_db` and tenant databases initially hosted on one private PostgreSQL
  cluster. Moving a tenant to another cluster must not change application
  contracts.
- Tenant configuration: tenant-level, declarative settings and entitlements;
  never tenant-supplied executable code.
- Payments: provider-neutral `PaymentPort`; do not select or hard-code a
  payment gateway. The prototype's Razorpay label is a visual placeholder, not
  provider approval.
- Object storage: Filebase S3-compatible adapter, with distinct environment
  resources and credentials.
- Login: Auth0 OIDC with email OTP as the primary sign-in experience. SMS and
  WhatsApp are optional login/verification channels only, not resident
  reminders or announcements. Prefer Twilio messaging behind a validated,
  Auth0-compatible adapter for these channels; require human approval before
  enabling them.
- Deployment: OCI production baseline, Cloudflare edge, and no unapproved paid
  resource fallback. This is a cost-constrained launch profile, not an implied
  high-availability or SLA guarantee.

## Documents

| Document | Purpose |
| --- | --- |
| [Product and system architecture](./product-and-system.md) | Roles, prototype feature map, stack, modules, and runtime shape |
| [Tenant isolation and configuration](./tenant-isolation-and-configuration.md) | Data ownership, database resolution, entitlements, and tenant settings |
| [Security and production deployment](./security-and-production-deployment.md) | Authentication, controls, environments, deployment, backup, and release gates |
| [Open decisions](./open-decisions.md) | Choices deliberately left to an authorized human |

Repository onboarding, local verification, publishing, and contribution
guidance are documented in the root
[`README.md`](../../README.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
GitHub CI, dependency-update configuration, issue forms, and pull-request
checklists live under [`.github/`](../../.github/). The repository does not
include a license; choosing one requires project-owner approval.

The implementation prompts are in
[`../implementation-prompts/`](../implementation-prompts/README.md). Read the
master prompt and execute its phases in order.

Apartment setup follows the prototype's three-stage details, unit generation,
and completion flow. Its server contract and safety bounds are documented in
[Product and system architecture](./product-and-system.md) and the master
implementation prompt.

## Source interpretation

[`figma-prototype/src/App.tsx`](../../figma-prototype/src/App.tsx) is an
interactive visual prototype with hard-coded demo records and some controls
that only look interactive. It is not an API contract, data model,
authentication implementation, or security boundary.
The production implementation must preserve the visible workflows and visual
hierarchy while replacing demo data and inert controls with persisted,
authorized behavior. It must not ship the prototype's role switcher, prefilled
demo credentials, fake payment success, or static operational metrics as
production functionality.

The prototype displays sample amounts in INR and Indian payment methods. The
initial target is India and INR by default; tenant locale and currency should
be modeled explicitly so that future expansion does not require storing
formatted money strings. Do not infer legal, tax, payment-settlement, SLA, RTO,
or RPO requirements from sample data.
