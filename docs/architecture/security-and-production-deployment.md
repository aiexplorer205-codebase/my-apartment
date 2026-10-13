# Security and production deployment

## Authentication and authorization

- Auth0 is the OIDC issuer behind `IdentityPort`; the API validates issuer,
  audience, expiry, signature/JWKS, and required claims.
- Primary sign-in is passwordless email OTP. The authentication flow must not
  reveal whether an email is registered; rate-limit issuance and verification,
  set short code lifetime, prevent replay, and audit security-relevant events.
- Use Resend for transactional email and configure Auth0's supported email
  delivery integration for OTP. Keep development, staging, and production
  identities and credentials separate.
- SMS and WhatsApp OTP are optional login/verification channels only. They are
  not resident reminder or announcement channels. Prefer Twilio messaging
  behind an Auth0-compatible delivery adapter; keep both channels disabled
  until the Auth0 integration, WhatsApp template where applicable, abuse
  controls, consent, regional compliance, and production credentials are
  approved and tested. The Auth0-issued OTP remains authoritative; do not
  create a second token issuer or accept an OTP verified outside the approved
  Auth0 flow.
- Tenant membership and tenant status are server-side control-plane facts.
  Identity-provider metadata or client-supplied organization IDs do not grant
  membership.
- Platform operator access requires OIDC identity, platform role, and exact
  match against a server-configured approved operator identity (or an
  explicitly approved role-based alternative). Fail closed if operator
  authorization configuration is absent.
- Enforce every permission and plan entitlement at the API/use-case boundary.
  Frontend guards only improve UX.
- Use separate Auth0 applications/audiences as appropriate for mobile, admin,
  operator, and API; keep operator access separate and private in production.

## Security controls

Implement and test, rather than merely document:

- Strict input validation, output projection, parameterized SQL, safe file
  handling, pagination limits, and API rate limits.
- Tenant-bound repositories and release-blocking isolation tests.
- CSRF protection if cookie-based browser sessions are used; secure CORS,
  headers, and session storage consistent with Auth0 guidance.
- Webhook signature verification, idempotency keys, replay protection, and
  server-side payment status verification. Do not trust redirect query
  parameters or client callbacks as proof of payment.
- Audit trails for operator actions, tenant-admin privileged actions, plan and
  configuration changes, payment adjustments, offline-payment records, and
  support access. Logs are append-only from product paths; protect audit
  retention/exports.
- Secrets in OCI Vault or the environment's approved secret manager; no
  credentials in git, client bundles, images, logs, crash reports, or
  Terraform state outputs.
- Private PostgreSQL and Redis; least-privilege network rules and database
  users. Only required HTTPS ingress is public.
- Encrypted transport, encrypted storage where supported, scoped object
  credentials, short-lived signed links, upload validation, and secret
  rotation.
- Dependency, source, container, infrastructure, and secret scanning in CI.
- Data minimization and retention policy for resident data, OTP events,
  payment metadata, exports, and backups.
- Keep repository credentials out of Git: ignore local environment files,
  private keys, generated output, and infrastructure state; review staged
  changes before commit. Enable GitHub secret scanning and Dependabot alerts
  where available. Report vulnerabilities through a private channel, never a
  public issue.

Structured logs may include tenant ID only after trusted context resolution.
Never log access/refresh/OTP tokens, passwords, connection strings, bank
details, or unnecessary resident PII.

## Payment safety and unresolved dependency

`PaymentPort` is intentionally provider-neutral. Payment setup remains
unavailable until a payment provider and merchant model are approved. Before
enabling live payments, document and test provider onboarding, tenant or
platform merchant-of-record model, settlement account ownership, fees,
webhook verification, refunds, disputes, reconciliation, accounting exports,
and operational support.

Persist payment intents and state transitions in the tenant database. Treat
webhooks as authoritative provider events, verify signatures, deduplicate
events, reconcile delayed or ambiguous results, and provide a human-reviewed
exception path. Never store raw card data. Do not show ads in billing review or
payment flows.

## Environments

| Environment | Required shape |
| --- | --- |
| Local | Docker Compose PostgreSQL and Redis; `.env.example` contains placeholders only; non-production Auth0, Resend, Filebase, and Firebase accounts; allowlisted test recipients |
| Staging | Required production-shaped OCI deployment; separate Auth0, Filebase buckets, Resend, Firebase, secrets, tenant DBs, and test payment credentials if a provider is approved |
| Production | OCI baseline, Cloudflare edge, private data services, Filebase, Auth0, Resend, Firebase, approved secrets store, operator private ingress, and gated immutable release |

No runtime fake identity, payment, mail, notification, or storage provider.
Automated tests may mock ports. Local and staging must not use production
credentials or send to unrestricted recipients.

## OCI production topology

- Cloudflare DNS/TLS/WAF in front of the approved public web/API entry points.
- OCI public load balancer for approved public HTTPS routes.
- API and worker compute as OCI-format containers or equivalent OCI compute;
  worker does not need a public IP.
- Private PostgreSQL cluster and Redis, with no public listener or
  `0.0.0.0/0` ingress.
- Filebase S3-compatible object storage with production-only buckets and
  restricted credentials for resident media, exports, and backups.
- Separate, private operator web ingress. No public DNS, Cloudflare public
  route, or public LB listener for the operator console. Use only the
  human-approved private access method; OCI Bastion is not assumed to provide
  end-user web connectivity.
- Terraform modules and environment state under the repository's approved
  `terraform/` layout. State must be remote or otherwise protected, encrypted,
  access-controlled, and must not expose secrets in outputs.
- GitHub Actions: lint, type-check, unit/architecture tests, integration and
  isolation tests, dependency/container scans, build, immutable image publish,
  staging deploy/smoke tests, then human approval before production.
- Protect the default branch with required CI checks and review. The initial
  foundation workflow runs typecheck, lint, tests, and build only; it does not
  publish artifacts, deploy, or run production scans.
- Deploy immutable image digests. Use health/readiness checks, migration
  compatibility planning, canary/rolling strategy where the selected OCI
  footprint supports it, and documented rollback. Database migrations must
  follow expand/migrate/contract where old and new versions can overlap.

The default cost policy allows only resources verified as eligible and
available in the chosen OCI region. Before every plan/apply, verify current
quotas, capacity, service eligibility, external-service charges, and data
transfer costs. If the required production shape is unavailable, stop and
request explicit approval; do not silently create paid resources. This profile
does not promise high availability, capacity, or an SLA. Document that
limitation honestly.

## Backups and recovery

- Encrypt `platform_db` and each tenant database backup before upload to
  Filebase; use distinct environment buckets, least-privilege credentials,
  retention, integrity verification, and monitored backup jobs.
- Back up tenant databases independently and maintain a tenant-to-backup
  inventory without exposing database locators to clients.
- Test point-in-time and single-tenant restore procedures, including
  re-provisioning and credential rotation. A backup not restore-tested is not
  considered verified.
- Record RPO/RTO, retention durations, legal hold requirements, and restore
  approval procedure as explicit human decisions; do not invent numeric
  guarantees.
- Define Redis persistence and recovery according to its actual role: queue
  state durability/reprocessing and cache loss must be handled separately.

## Operational readiness gates

Do not declare production-ready until there is:

1. A threat model, data inventory/classification, privacy/retention policy, and
   approved operator access path.
2. Auth0 OTP delivery verified in production-like staging, plus separately
   approved/verified SMS or WhatsApp login integration if those channels will
   be enabled.
3. Payment provider and settlement ownership approved before live checkout.
4. Tenant isolation, authorization, webhook, backup/restore, and migration
   tests passing.
5. Monitoring/alerting for API and worker health, queue backlog, failed jobs,
   database capacity/connections, payment reconciliation, OTP abuse, storage,
   and backup status.
6. Runbooks for tenant provisioning/suspension/move, incident response,
   credential rotation, payment exception handling, restore, and rollback.
7. Staging signoff, production approval gate, verified resource quota/cost,
   and documented deployment limitations.
