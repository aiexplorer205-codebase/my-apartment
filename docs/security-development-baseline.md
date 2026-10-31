# Security and development baseline

Reviewed: 2026-10-29. Scope: repository source, SQL migrations, Compose, CI,
service workers and infrastructure templates. This is a source review, not a
penetration test or proof of deployed cloud settings. No cloud account, live
production cookies, backup schedule, restore drill or monitoring account was
verified. Existing uncommitted UI changes were left alone.

Pilot hardening has since added Origin enforcement/body limits/timeouts to admin/operator proxies,
web response headers, append-only platform audit migration `013`, CI secret/dependency scans
and an encrypted two-database backup script. See [pilot rollout and remaining release gates](pilot-release-gates.md).
Deployment, restore, monitoring and rollback gates still require evidence.

The application partially meets the requested checklist. Tenant isolation,
membership authorization and private complaint photos have substantial controls.
Production verification of headers/CSRF, complete sensitive-event audit coverage,
disaster recovery and release operations still require work. Do not label it production-ready.

## Checklist assessment

“Implemented” means supporting code exists, not that deployment was certified.
“Partial” means coverage or operational evidence is incomplete. “Open” means no
complete implementation was found in the reviewed runtime configuration.

### Security

| Requirement | Status | Evidence and remaining work |
| --- | --- | --- |
| Tenant ownership and RLS | Implemented foundation | [Migration 036](../migrations/myapartment_tenant_db/036_shared_tenant_rls.sql) adds non-null ownership, tenant indexes, composite relationships, forced RLS and restricted roles. [Persistence](../apps/api/src/persistence.ts) binds a server-authorized tenant in a transaction using `SET LOCAL ROLE` and transaction-local `set_config`. Not every query has a literal tenant predicate; scoped connections and RLS protect those queries. New tables must independently install these controls. |
| Server authorization / IDOR | Implemented foundation | [API](../apps/api/src/index.ts), especially `resolveTenantAccess`, validates identity, active platform membership, tenant lifecycle, accepted admin invitation and active resident profile. A client `x-tenant-id` is a selection among verified memberships, never authority. Entity ownership must also be checked per action; RLS alone does not stop one resident reading another resident's record in the same community. [Isolation tests](../tests/shared-tenant-postgres.spec.ts) cover database boundaries; this review did not exhaustively prove every route. |
| Zod on all untrusted inputs | Partial; requested Zod standard unmet | API modules use handwritten type, UUID, date, length and enum checks, e.g. [meeting minutes](../apps/api/src/meeting-minutes.ts) and [accounts](../apps/api/src/accounts.ts). JSON decoding and TypeScript casts do not validate inputs. No universal Zod boundary was found. Introduce Zod at new/changed boundaries with equivalent domain checks; avoid an unrelated mass rewrite. |
| CSRF / Origin checks | Implemented in backend proxies; verify browser flows | Resident checks are joined by configured-origin enforcement in admin/operator mutation proxies, before session access. Tests cover missing, foreign and sibling origins. Auth-specific routes retain their own checks; full browser sign-in regression remains required. |
| CSP, HSTS, nosniff, Referrer-Policy, frame-ancestors | Implemented baseline; production verification open | All three web configs emit CSP/framing/nosniff/referrer headers. WEB_HSTS enables one-year HSTS only after HTTPS verification. PHOTO_STORAGE_ORIGIN must be supplied at build time. Inline hydration scripts remain permitted; see [rollout](pilot-release-gates.md). |
| Cookie flags and session lifetime | Partial | Better Auth [configuration](../apps/resident-auth/src/auth.ts) uses HttpOnly, SameSite=Lax, Secure on HTTPS, eight-hour expiry and disabled refresh. Operator Auth0 uses bounded sessions and Lax cookies, relying on SDK behavior for other flags. Verify actual production Set-Cookie headers for every app. Do not claim cookie flags solely from local HTTP behavior. |
| Session invalidation on credential replacement | Partial coverage | [QR registration](../apps/resident-auth/src/qr.ts) deletes sessions on reset; [OTP passkey replacement](../apps/resident-auth/src/auth.ts) removes other credentials and sessions. This is evidence for those implemented flows, not a general account re-link mechanism. Every future re-link requires fresh proof, credential/session invalidation and audit in the same design. |
| Private presigned file uploads | Implemented for complaint photos | [Storage design](private-image-storage.md), [browser compression](../packages/ui/src/private-image-upload.ts), [photo API](../apps/api/src/complaint-photos.ts), [S3 adapter](../infrastructure/adapters/src/s3-images.ts). Private staging, random keys, short signed URLs, quotas, checksums, strict decoding and separate sanitized objects. Provider is S3-compatible, including R2; actual bucket policy/CORS/lifecycle must be configured. This does not cover arbitrary new file features. |
| Secret storage / dependency and secret scanning | Implemented scanning; deployment evidence open | CI now runs pinned gitleaks history scanning and a production dependency audit. Pre-commit configuration requires local activation. Dependabot remains enabled. Production secret-manager configuration and alert ownership must be verified. |
| Append-only sensitive audit | Platform immutability implemented; event coverage partial | Platform migration `013` denies UPDATE/DELETE/TRUNCATE with a trigger and revokes product-role permissions. Fresh provisioning preserves those revocations. Resident-auth audit remains INSERT-only. Audit event coverage for every future sensitive flow still requires review. |
| WebAuthn origin, RP ID, counters, challenge limits | Implemented foundation; verify plugin coverage | [Config](../apps/resident-auth/src/config.ts) restricts HTTPS/origin and RP relationship. [QR verification](../apps/resident-auth/src/qr.ts) verifies expected origin/RP/challenge, requires user verification and stores credential counters. Better Auth/passkey plugin owns normal authentication; database-backed limits and QR limits exist. Add explicit regression coverage for plugin counter updates/replay, challenge expiry/reuse and wrong origin/RP. Read-only get-session is intentionally exempt from the auth-attempt limiter. |

Global platform identities, memberships and auth tables are deliberately not
tenant-owned application tables. Do not add `tenant_id` mechanically to every
table: first define its security boundary. Cross-tenant platform operations must
be operator-authorized, narrowly scoped and audited.

### Performance and cost

| Requirement | Status | Evidence and remaining work |
| --- | --- | --- |
| Pagination, indexes, pooling | Partial | Complaints, maintenance, accounts and meeting history implement paging/cursors. Migration 036 adds tenant and relationship indexes; persistence uses one shared application pool (max 10), platform pool (max 10); auth has its own configurable pool. Some lists are capped rather than paginated, e.g. resident complaint query `LIMIT 200` in [complaints](../apps/api/src/complaints.ts). No complete FK-index or query-plan audit was performed. Size total pools across replicas and jobs, not per process alone. |
| Safe caching / CDN assets | Partial | API/proxy responses use no-store. Next supplies fingerprinted build assets, but no verified Cloudflare deployment/cache policy or consistent tenant-aware server cache was found. Add caching only with explicit authorization boundaries and invalidation; private responses are not CDN assets. |
| Client image compression | Implemented for complaint photos | Browser limits input to 5 MiB/20 MP and encodes WebP to at most 1600 px per side and 1 MiB. Server independently validates/re-encodes. See [photo storage](private-image-storage.md). |
| Background work | Open for scheduler/notifications | [Worker](../apps/worker/src/index.ts) explicitly reports `jobProcessors: false`. Terraform queue snippets are examples, not running processors. Photo validation is bounded but runs in request handlers. Implement cron/queue work only when needed, through ports with bounded retries, idempotency and failure visibility; do not add a processor merely to satisfy this table. |
| Idempotent writes | Partial | Maintenance, updates, photo intents, complaint creation and financial workflows use request keys/constraints and transactions. There is no proven universal contract for all writes. Each new retryable mutation must define duplicate and changed-payload behavior. UI button disabling alone is insufficient. |

### Reliability and operations

| Requirement | Status | Evidence and remaining work |
| --- | --- | --- |
| Compose and GitHub Actions | Partial | [Compose](../compose.yaml), [development override](../compose.dev.yaml) and CI typecheck/lint/Postgres tests/build exist. No active production deploy workflow is present under `.github/workflows`. Terraform's deploy example is not the production release pipeline. |
| Automated encrypted backups and tested restore | Script implemented; operational gate open | `scripts/backup-databases.sh` encrypts both database dumps and role definitions before rclone upload. A schedule, destination, recovery credentials, media recovery and an isolated timed full restore remain required; see [pilot gates](pilot-release-gates.md). |
| Versioned migrations | Implemented | [Runner](../scripts/run-migrations.sh) records checksums and serializes migrations. Never change applied SQL; use a new numbered migration. Schema compatibility must be checked before rollback/deployment. |
| Health / uptime / errors / logs | Partial | API health/readiness, worker health/readiness and auth health/readiness exist. API returns X-Request-Id and structured errors. Proxies do not consistently preserve request IDs. No Sentry integration or verified external uptime/alert delivery was found. A health endpoint alone is not a monitor. |
| AWS credit/budget alerts | Template exists; activation unverified | [Budget module](../terraform/aws-terraform/modules/budgets/main.tf) defines gross usage excluding credits, net spend including credits and optional anomaly notifications. Verify applied resources, recipient subscription and actual alert delivery. A budget notification is not a spending cap. |
| Build, health-check, switch, rollback | Open | Compose health checks help local readiness but do not provide traffic switching or zero downtime. The [example deploy](../terraform/aws-terraform/examples/github-deploy.yml) runs pull/up and prune; it does not implement a verified candidate-health traffic switch and rollback. Keep a prior immutable image and prove compatible rollback before production. |

### PWA

| Requirement | Status | Evidence and remaining work |
| --- | --- | --- |
| Never cache authenticated data | Implemented conservative policy | [Resident worker](../apps/resident-web/public/sw.js) and [admin worker](../apps/admin-web/public/sw.js) use network-only navigation with a generic offline response; no Cache API storage or offline write queue. API requests are not intercepted for caching. App-shell precaching is not currently implemented and is optional. |
| Worker updates / versioning | Partial | [PWA controls](../packages/ui/src/pwa-controls.tsx) handle waiting workers, updatefound and deliberate activation while guarding forms. Browser byte-change updates exist; no explicit build version/cache namespace exists. Deploy sw.js with revalidation rather than immutable caching. If caches are introduced, use build-versioned names and remove old caches without caching private pages. |
| Push only when needed | Implemented opt-in delivery foundation | Resident Web Push uses VAPID, endpoint validation, a table-limited dispatcher role and transactional outboxes. Verify VAPID secrets, provider delivery, role provisioning, retention and operational metrics before production; see [architecture](architecture.md#resident-web-push). |

## Required rules for future changes

1. Authenticate first; resolve membership and lifecycle on the server. Validate a
   requested tenant against those memberships. Authorize role, entity ownership
   and operation before reading, writing, signing a URL or scheduling work.
2. All tenant SQL uses `getTenantPool(serverAuthorizedTenantId)`, parameterized
   values and the existing transaction interface. Keep explicit tenant predicates
   where appropriate. Never expose the raw pool or set session-scoped tenant
   state. New tenant tables need non-null ownership, composite tenant FKs,
   forced RLS with USING/WITH CHECK, restricted grants and cross-tenant tests.
3. Validate new/changed external boundaries with server-side Zod schemas:
   body, query, path, pagination, identifiers, enums, dates, sizes and lengths.
   Validate at the owning service even when the proxy validates too. Preserve
   business invariants and authorization after parsing. Add the dependency
   deliberately where missing; existing handwritten validation remains a
   documented gap, not a reason to skip validation or rewrite unrelated code.
4. Cookie-authenticated mutations require an exact configured Origin match at
   the browser-facing route; reject missing/untrusted origins. Never mutate via
   GET. Server Actions still require authentication and authorization. Protect
   non-browser integrations using their own authenticated protocol. CORS is not
   CSRF protection. Trust forwarded headers only from an ingress that overwrites them.
5. Production uses HTTPS, HttpOnly/Secure/Lax session cookies and bounded
   lifetimes. Credential replacement/re-link requires fresh identity proof,
   session invalidation and audit. Admin and resident use isolated Better Auth services; operator remains on Auth0.
   Preserve their documented provider/session boundaries and never invent an OTP issuer.
6. Establish shared CSP (including frame-ancestors), nosniff and Referrer-Policy
   across applications and errors. Introduce CSP with tested script/connect/image
   allowlists; do not solve failures with unrestricted sources. Enable HSTS at
   the HTTPS edge only after validating affected domains. Test actual responses.
7. New file flows use the storage port, private buckets, independent entity/role
   checks, server-generated keys, bounded signed capabilities, type/size/content
   validation and retention cleanup. Keep media off the app origin and omit
   signed URLs from logs, analytics and persistent client state.
8. Audit sensitive credential, membership, role, lifecycle and export actions
   with actor, authorized tenant/target, action, outcome, timestamp and request
   ID as appropriate. Never record OTPs, cookies, tokens or exported payloads.
   Enforce append-only access with grants/DB protection; separate retention and
   privileged purge from product credentials. Cross-database changes need a
   durable recovery/reconciliation design rather than assumed atomicity.
9. Bound lists, uploads, request bodies, timeouts and expensive work. Index
   actual tenant/filter/sort access paths; inspect query plans for expensive
   queries. Every retryable create/post/publish operation needs a scoped request
   key, durable uniqueness, same-result replay and changed-payload conflict.
10. Cache public fingerprinted assets aggressively. Keep authenticated API,
    documents and private media no-store by default. Any approved private cache
    must include tenant, applicable user/role and resource/version in its key,
    and define invalidation for edits, logout and membership/lifecycle changes.
    Do not put private HTML or API responses in service-worker caches.
11. Background work must retain server-authorized context, recheck access where
    relevant, use ports, bounded concurrency/retries and visible failures. Keep
    the worker's health-only status truthful until real processors are tested.
12. Keep secrets server-side and out of git/build arguments/client bundles.
    Run `pnpm audit --prod` with network access and triage findings; add pinned
    gitleaks pre-commit and CI scanning before considering the scanning gate
    closed. Dependabot does not replace vulnerability or secret scanning.
13. Each production release needs successful CI, immutable images, compatible
    migrations, tested readiness, a health-checked traffic switch and rollback
    owner/procedure. Verify backups and monitoring before onboarding customers.
    Use existing low-cost infrastructure first; paid fallback needs approval.

## Prioritized follow-up and acceptance evidence

Origin checks, web headers, audit immutability and CI scans now have implementations.
The table retains their production acceptance criteria; use the pilot runbook to
distinguish code completion from verified deployment.

| Priority | Work | Evidence needed to close |
| --- | --- | --- |
| P1 before production | Add Origin enforcement to admin/operator mutation proxies, bounded operator bodies and upstream timeouts | Tests reject missing/foreign/same-site sibling origins; valid configured-origin mutations succeed; oversized bodies/timeouts fail predictably. |
| P1 before production | Shared browser security headers and TLS edge policy | Response checks for every app, errors and downloads; CSP tested with Auth0/passkeys and private media; production cookies and HSTS verified over HTTPS. |
| P1 before production | Restrict platform audit mutation permissions | New numbered SQL/provisioning changes, no edits to applied migrations; runtime UPDATE/DELETE denied while authorized audit inserts succeed; all sensitive flows covered. |
| P1 before production | Current-topology encrypted backup/restore and deployment rollback | Automated backup of both databases and required metadata, protected recovery keys, retention/failure alerts, isolated full restore with measured RPO/RTO; candidate health gate and rollback drill. |
| P1 before production | Secret/dependency scanning and external alerts | CI scan results, triaged dependency report, no exposed secrets, verified uptime/error/backup/budget notification delivery. |
| P2 during feature work | Zod adoption and route authorization coverage | Schemas on each changed boundary; malformed input, cross-tenant and same-tenant wrong-owner tests. Add auth integration suites to CI with their dedicated disposable `_auth_test` database; current test runner does not configure that URL. |
| P2 during feature work | Pagination, idempotency, request IDs and WebAuthn coverage | No silently truncated required lists; concurrent/replayed mutation tests; request IDs trace proxy to service; wrong-origin/RP/replayed challenge tests. |
| P3 when justified | Tenant-safe caching, cron/queue and explicit PWA build version | Measured performance/cost need, defined invalidation/retry behavior and tests proving private responses never enter shared/browser caches. |

Assign an owner and target date to each production gate in the release tracker.
This document creates requirements; it does not implement these follow-ups.

## Verification and review limits

Documentation-only changes need working local links and `git diff --check`.
Application changes require `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
plus `bash scripts/test-database.sh` for database isolation/recovery and relevant
provider tests against a dedicated disposable auth database. Rebuild/restart API
after route/schema changes. Never point destructive integration tests at app data.

Earlier session validation passed the ten resident-provider unit tests and lint;
65 consecutive session reads through the local proxy returned HTTP 200. That is
not a full security regression result. The earlier full run had missing local
resident-auth dependencies, a sandbox listen error and test timeouts; local
typecheck/build were blocked, although changed service images compiled in Docker.
This documentation review did not rerun or certify the full application suite.

Related: [security gates](security-and-ops.md), [database operations](shared-database-operations.md),
[resident authentication](resident-authentication.md), [private media](private-image-storage.md).
The distinction between Server Actions and Route Handlers follows the
[Next.js security guidance](https://nextjs.org/docs/15/app/guides/data-security).
Tenant isolation must also cover caches, storage and background work, as described
in the [OWASP multi-tenant guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html).
