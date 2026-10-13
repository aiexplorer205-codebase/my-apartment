# Phase 5 — production readiness and approved deployment

Read [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), all prior phase results,
[`../architecture/security-and-production-deployment.md`](../architecture/security-and-production-deployment.md),
and [`../architecture/open-decisions.md`](../architecture/open-decisions.md)
before making changes. This phase prepares release artifacts and operational
evidence. Do not create external accounts, spend money, provision resources,
apply Terraform, deploy, or enable customer traffic without explicit human
approval.

## Goal

Make the verified product supportable and releasable on the approved OCI
baseline, with reproducible builds, secure configuration, observability,
backup/recovery, and human-controlled rollout/rollback. Do not claim an SLA,
HA, RPO, RTO, or legal compliance target that the owner has not approved.

## Scope

1. **Release and runtime artifacts**
   - Build immutable production images for API, worker, admin web, operator
     web, and any approved resident-client delivery target. Use non-root
     runtime users, minimal build contexts, pinned base images where practical,
     and health/readiness checks.
   - Add environment-specific configuration schemas and deployment
     documentation for local, staging, and production. Keep secrets in the
     approved secret manager; no secret in CI logs, image layers, Terraform
     outputs/state, client assets, or generated OpenAPI documents.
   - Require migration compatibility planning (expand/migrate/contract where
     rolling overlap exists), preflight checks, and explicit migration
     ownership.
2. **OCI and Cloudflare infrastructure**
   - Complete reviewed Terraform modules/environment structure for the
     approved OCI topology: public API/admin routes, Cloudflare edge, private
     PostgreSQL and Redis, API/worker compute, Filebase, and a separate
     private operator web access path.
   - The operator console must have no public DNS, public Cloudflare route, or
     public load-balancer listener. Do not assume a private-access technology
     that has not been approved.
   - Verify current OCI region eligibility, quotas, capacity, fees, and data
     transfer cost before suggesting/applying resources. If the required
     shape is unavailable under the approved cost policy, stop and request
     approval rather than introducing paid fallbacks.
3. **CI/CD and release controls**
   - Extend CI to run unit, integration, API contract, tenant-isolation,
     migration, and worker tests plus lint/type/build and approved
     dependency/container/infrastructure scans.
   - Use immutable artifact digests, protected-branch checks, staging
     deployment and smoke tests, explicit human approval before production,
     environment separation, and documented rollback.
   - CI must not receive production credentials for unapproved workflows.
     Production deploy jobs must fail closed without required approvers and
     configured protected environments.
4. **Operations and recovery**
   - Add structured redacted logs, metrics, traces/correlation IDs, service
     dashboards, alerts, and operational runbooks for health, queue lag,
     failed jobs, database/pool health, provider outages, provisioning,
     reconciliation exceptions, and suspected security incidents.
   - Implement encrypted platform and per-tenant backups, distinct
     environment-specific storage and credentials, integrity verification,
     backup inventory, retention hooks, and monitored failure reporting.
   - Document and test platform restore and isolated single-tenant restore,
     re-provisioning, key/credential rotation, and rollback/recovery. Do not
     call backups valid until restore tests pass.
   - Obtain owner-approved RPO/RTO, retention, deletion, and legal-hold
     policies before configuring values that imply commitments.
5. **Security and go-live gates**
   - Re-run and close tenant-isolation tests as release blockers. Verify
     Auth0, rate limits, CORS/CSRF as applicable, session handling, webhooks,
     audit protections, secrets, file access, data exports/deletion, least
     privilege, and operator private access.
   - Keep payments unavailable until the payment provider, merchant and
     settlement model, credentials, webhooks, refunds/disputes, and
     operational ownership are explicitly approved and tested.
   - Keep optional SMS/WhatsApp OTP disabled until the Auth0-compatible
     integration, abuse controls, consent, compliance, and human approval are
     complete. Never use these channels for reminders or announcements.
   - Create a go-live checklist with named human owners/approvers required
     for all remaining open decisions. Do not mark unresolved decisions as
     complete by assuming defaults.

## Required tests and phase exit criteria

- Run all CI checks plus tenant-isolation, API contract, migration,
  provisioning, integration-failure, queue recovery, and backup restore tests.
- Run Terraform format/validate and plan only when tooling and approved
  credentials are available. Never run `apply` without explicit approval.
- Verify staging and production configurations cannot share credentials,
  storage buckets, tenant databases, or callbacks.
- Review built images and client bundles for secrets; verify production
  network rules keep PostgreSQL, Redis, and the operator surface private.
- Produce a release-readiness report with changed files, exact checks/results,
  remaining open decisions, required owners and credentials, cost/availability
  assumptions, restore evidence, deployment/rollback steps, and explicit
  go/no-go status. A prepared deployment is not authorization to deploy.
