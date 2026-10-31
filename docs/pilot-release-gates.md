# Pilot release security gates

This is a release checklist, not a declaration that the pilot has passed.
Do not onboard real resident data until every applicable gate has evidence.

## Implemented changes

- Admin/operator backend proxies reject missing/foreign Origin on mutations before
  reading sessions. Origin comes from APP_BASE_URL, not forwarded client headers.
  Request bodies are capped at 1 MiB. Upstream calls have a 15-second timeout,
  reject redirects, return private 503 errors and preserve X-Request-Id.
- All three web apps emit CSP, nosniff, no-referrer, DENY framing and restricted
  browser permissions. Service workers must revalidate. CSP currently permits
  inline Next hydration/style; it is not a nonce-based XSS policy.
- Migration platform `013` rejects audit UPDATE/DELETE/TRUNCATE and removes those
  grants from the platform product role. New database initialization also removes
  the grants after its generic grants. INSERT/SELECT remain available.
- CI scans git history with pinned gitleaks and audits production dependencies at
  high severity. Pre-commit gitleaks configuration is committed; developers must
  install `pre-commit` and run `pre-commit install` to activate it locally.
- `scripts/backup-databases.sh` encrypts platform/application custom-format dumps
  and role definitions with age, then uploads an archive with checksums using
  rclone. It refuses missing recipient/destination, propagates pipeline failures
  and never writes plaintext dump files. This script has not established a
  running backup schedule or a successful full restore drill.

## Dependency remediation and checks

The release audit identified vulnerable Next.js and test-tool peer dependencies.
Next.js is updated to 15.5.28; Vitest to 4.1.12 with Vite 6.4.4. A scoped
`next>postcss` override selects 8.5.23 because Next pins an affected older release.
Keep the override until an upstream Next dependency update removes the need;
review CSS builds when changing it. The production audit returned no known
vulnerabilities after these changes. This is a point-in-time result, not a guarantee.
The Next version addresses the [published advisory](https://github.com/advisories/GHSA-p3m5-59mp-jv5r).

## Configuration and rollout

1. Set PHOTO_STORAGE_ORIGIN to the exact public HTTPS origin used in signed image
   PUT/GET URLs (scheme and host, no trailing slash/path). It is public policy
   metadata, not a secret. Pass it through the supplied Compose build arguments
   and environment; rebuild web images when it changes. Without it the CSP denies
   external photo uploads/views. Local S3Mock port 59000 is allowed for development
   connections. If a provider uses different upload/view origins, add an explicitly
   validated allowlist before deploying; do not replace it with `https:` or `*`.
2. Verify HTTPS-only routing and trusted forwarded headers. Set WEB_HSTS=true for
   production web builds after verification. This sends one-year HSTS without
   includeSubDomains/preload; keep it false on local HTTP. Never enable preload or
   subdomain-wide policy without validating every affected host.
3. Apply `scripts/run-migrations.sh platform` as the migration administrator,
   including `013`; do not edit applied SQL. Rebuild/restart changed services.
   Audit-history deletion now fails even for ordinary owner statements; approved
   legal retention/purge would require a separate reviewed privileged procedure.
4. Run full CI and provider/isolation tests. Verify actual browser flows for
   operator Auth0 login, resident/admin Better Auth passkeys/OTP, invitations, mutation forms, private photo
   upload/view, downloads and PWA update. Inspect headers on pages and errors.
5. Pre-commit hook activation is per checkout. CI secret scanning and audit must
   remain required checks; do not ignore new findings to pass a pilot release.

## Backup and restore gate

Use a dedicated private, encrypted backup bucket/remote with retention separate
from short-lived media. Configure least-privilege workload credentials for rclone,
BACKUP_REMOTE and BACKUP_AGE_RECIPIENT outside git. Keep the age private key in
protected recovery storage and test that a second authorized operator can use it.
Schedule `bash scripts/backup-databases.sh` from the Compose host using cron/systemd
and alert on failure or backup age. Never log credentials or restored data.

Dumps of two databases are taken sequentially. A full cross-database snapshot
requires a maintenance window with product writes paused, or a documented
reconciliation strategy. Decide and record this before promising recovery fidelity.
Database dumps include migration ledgers and resident auth tables. Media bytes,
bucket lifecycle/policies, deployment configuration and application secrets need
independent recovery procedures; database dumps alone do not restore photos.

Restore drill, on a separate isolated host/environment only:

1. Download an archive, check SHA256SUMS for every encrypted file, then decrypt
   with the protected age recovery key into a directory accessible only to the
   restore operator. Remove plaintext recovery artifacts after verification.
2. Restore roles into an isolated cluster; review existing built-in roles before
   applying role SQL. Restore each custom-format dump into its corresponding
   empty platform/application database using pg_restore with errors fatal.
   Re-provision role passwords from the recovery secret manager.
3. Check migration ledgers, forced RLS, runtime grants, audit immutability and
   restricted lifecycle credentials. Run tenant A/B authorization tests, validate
   restored records and storage access using synthetic accounts, and prove
   suspended/deleted tenant and expired/replaced session access remains denied.
4. Record backup time, restored recovery point, elapsed restore time, failures,
   owner and approval. Compare measured RPO/RTO against written pilot targets.
   A tenant JSON export test does not close this full-disaster-recovery gate.

## Monitoring, cost and rollback gates

- Assign a pilot operations owner. Configure external HTTPS uptime/readiness,
  error-rate, backup-age and disk-space alerts; verify notification delivery.
  Propagate request IDs without logging cookies, OTPs or signed URLs. Sentry is
  optional; an equivalent low-cost error/alert system is acceptable.
- Apply/verify the existing AWS budget module and confirm recipients receive
  gross usage and net spend notifications. Alerts do not enforce a spending cap.
- Build an immutable image tag, start a candidate, check readiness and smoke
  flows, switch traffic at the trusted ingress, then retain the previous image.
  Test rollback with compatible schema. Single-instance Compose up alone does
  not provide health-gated switching; do not advertise zero-downtime deployment.
- Verify operator private ingress, separate production credentials, private bucket
  policy/CORS/lifecycle, approved retention and an incident contact before launch.

See [baseline](security-development-baseline.md) and [operations gates](security-and-ops.md).

## Validation recorded for this change

- Typecheck, lint and patched production builds passed.
- Standard suite: 133 tests passed; database suites intentionally skipped there.
- Disposable PostgreSQL/S3Mock run: 232 tests passed, 15 skipped (resident-auth
  integration suites require their separately configured auth test database).
- Three additional backup orchestration tests passed: missing encryption config
  and failed dumps prevent upload; successful orchestration includes both database
  dumps, roles and checksums. These stub external commands and do not prove age
  cryptography, a real remote upload, scheduling or disaster recovery.
- Audit migration tests passed; platform `013` was applied locally through the
  checksum-recording migration runner. Production still requires migration rollout.
- Gitleaks scanned 121 commits with no leaks found; production dependency audit
  returned no known vulnerabilities. CI will re-evaluate future changes.
- Live HTTPS/auth/photo browser smoke checks and full restore/rollback drills
  remain deployment gates. Web container images must be rebuilt for the patched
  dependencies and build-time header configuration to reach a running environment.
