# Phase 1 — foundation and architecture enforcement

Read [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), the architecture documents it
links to, and the repository's current source before changing files. Implement
this phase in the repository; do not return only a design or scaffold. Preserve
existing working code and unrelated changes.

## Goal

Establish and verify the secure backend and monorepo foundation that the
resident, apartment-admin, operator, and local Compose phases can build on.
Audit what is already present and complete gaps instead of recreating or
duplicating it.

## Scope

1. **Workspace and package boundaries**
   - Maintain the pnpm TypeScript workspace and the agreed package boundaries:
     domain, application, contracts, config, shared, infrastructure ports and
     adapters, API, worker, admin web, operator web, and Flutter resident
     client.
   - Domain code has no I/O or provider-SDK dependencies. Application use
     cases depend on domain and ports. Provider SDKs are confined to
     infrastructure adapters and composition roots.
   - Configure consistent formatting, lint, type-check, test, build, and
     workspace scripts using repository-standard tools.
2. **Contracts and HTTP API**
   - Establish the NestJS modular API composition root with versioned `/v1`
     routes, request validation, explicit response/error shapes, pagination
     limits, structured logs, request IDs, and OpenAPI generation/validation.
   - Keep public, tenant, platform, and health route groups distinct. Ensure
     public and platform routes cannot be captured by generic tenant routing.
   - Health and readiness responses disclose no secrets, connection strings,
     database locators, or internal service endpoints.
3. **Persistence and tenant boundary**
   - Establish Prisma schemas/clients and independently versioned migrations
     for `platform_db` and tenant databases. Platform persistence stores
     control-plane data only; operational records belong in the correct
     tenant database.
   - Define trusted `TenantContext` resolution from validated Auth0 identity
     and active platform membership/status. Client tenant IDs, host headers,
     token metadata, and UI selections are hints only, never authorization.
   - Define server-only tenant database locator resolution, bounded connection
     pools, and tenant-bound repository APIs. Prohibit shared tenant
     operational tables or schema-per-tenant as substitutes for
     database-per-tenant.
   - Make migrations and local provisioning repeatable, explicit, and
     non-destructive. Never auto-reset a database containing data.
4. **Authentication and authorization**
   - Implement the `IdentityPort` and Auth0 OIDC/JWKS validation boundary:
     issuer, audience, signature, expiry, and required claims are verified.
   - Model membership, actor permissions, plan entitlements, tenant status,
     and platform policy as separate server-side checks. Fail closed when
     operator authorization configuration is missing.
   - Use email OTP as the intended Auth0 sign-in method. Do not add a demo
     role switcher, default user, bypass token, or production mock identity.
5. **Provider ports and configuration**
   - Define typed ports and explicit error/result handling for database,
     identity, payments, email, push, object storage, and queues.
   - Validate environment configuration at process startup. Keep secrets out
     of browser/mobile bundles, logs, source control, generated artifacts, and
     error responses.
   - Keep payment provider-neutral and disabled pending the approvals in
     `open-decisions.md`; do not implement fake success.
6. **Queue and audit foundation**
   - Establish Redis/BullMQ wiring and worker composition. Define explicit
     tenant-bound job payloads, idempotency, bounded retries, observability,
     and a failed-job/recovery path.
   - Implement append-only audit primitives for privileged tenant and
     platform actions, with redacted metadata.
7. **Repository quality gates**
   - Add/complete CI checks for type-check, lint, tests, and builds. Do not
     deploy, publish images, create cloud resources, or run infrastructure
     applies in this phase.
   - Ensure ignored `.env` files, secrets, generated output, and Terraform
     state cannot be accidentally committed; keep `.env.example` placeholder
     only.

## Required tests and phase exit criteria

- Unit-test domain invariants and authorization/entitlement decision logic.
- Test invalid/expired/wrong-audience identity tokens and fail-closed operator
  authorization.
- Add tenant isolation tests for forged/missing tenant selection, cross-tenant
  IDs, suspended tenants, tenant-bound repository resolution, and platform vs
  tenant data ownership. Any isolation failure blocks later phases.
- Test migration validation, queue idempotency/retry behavior, explicit
  provider errors, and secret-safe health/log output.
- Run the repository's type-check, lint, tests, and build. Report exact
  commands/results, files changed, remaining scaffolding, and all human-owned
  decisions. Do not call the app production-ready.
