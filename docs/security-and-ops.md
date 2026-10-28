# Security and operations

This is a testable local product, not a production-supported release. Do not deploy until the gates below are owned and verified.

## Invariants (do not weaken)

- Never commit secrets, `.env`, tokens, database locators, or real resident data.
- Parameterized SQL only. Tenant repositories use the scoped shared-database interface bound to server-side `TenantContext`, with transaction-local RLS. Runtime roles cannot own tables or bypass RLS.
- UI visibility is not authorization. Enforce role and membership on every API read/write.
- Operator access fails closed unless `OPERATOR_IDS` lists the exact Auth0 `sub`.
- Auth0 OTP is the identity proof. Do not accept a second OTP issuer or skip invitation acceptance.
- Do not fake payment success, checkout, or worker job completion.
- Invitation links are single-use and expire after seven days; delivery is email only.
- Minutes of Meeting drafts are admin-only. Published notes/attendance snapshots are immutable; resident responses include attendee names and block/flat labels but no contact details, internal attendee IDs, or publisher subjects. Attendance never grants access.
- Complaint/maintenance UUIDs stay the API identifiers; `CMP-`/`MNT-` are display references.
- Production origins use HTTPS. Auth0 callback, logout, and web-origin lists must match those origins exactly.
- Operator production access needs an approved private ingress (or equivalent) in addition to Auth0. Local loopback publish is not that control. `OPERATOR_WEB_PRIVATE_INGRESS` in Compose is not production ingress.

## Reporting

See [SECURITY.md](../SECURITY.md). Do not file public issues with exploit details, credentials, or resident data.

## Production gates (open)

| Gate | Current | Required before production |
| --- | --- | --- |
| Payment provider and settlement | Checkout disabled; `PaymentPort` unused | Owner-approved provider, merchant model, webhooks, refunds |
| SMS / WhatsApp OTP | Disabled | Auth0-compatible adapter, consent, abuse controls |
| Operator private access | Method not chosen | Identity-aware or private network path |
| Backups / RPO / RTO / retention | None committed | Encrypted backups, restore evidence, legal hold |
| Custom domains | Not supported | Host routing policy |
| Campaigns / ads | Operator UI stub | Policy and implementation |
| Report exports | Admin reports placeholder | Tenant-scoped export |
| Support access to tenant data | Default deny; no elevation tool | Time-limited audited access if ever allowed |
| Worker / queues | Health only | Processors only behind ports, with retries and poison handling |
| Object storage / push | Filebase / FCM env unused | Per-environment resources behind ports |
| CI/CD production | Foundation CI for PRs | Named approver, rollback owner, secret manager |
| Paid cloud fallback | Not permitted without explicit approval | Written approval |

Secrets belong in the deployment secret manager, not image build args. Staging and production Auth0 tenants, keys, and databases stay separate.

## Local operations notes

- Accounts in the product are cash/bank books and resident subledgers, not a balanced general ledger. Invoice adjustments do not rewrite published invoice lines.
- Completing a maintenance task does not post a resident charge. Vendor expenses are separate.
- Resident PWA: network-only service worker; do not cache authenticated tenant data for offline access.
- Nginx in this repo routes HTTP inside Compose. It does not issue TLS certificates.

## Shared application database

Tenant SQL through `036` installs forced RLS, tenant-aware relationships, and
restricted runtime/lifecycle roles. This is an empty-data reset boundary. Follow
[shared-database-operations.md](./shared-database-operations.md); the architecture
change alone does not close the other production gates above.

Encrypted backups must include BOTH platform and application databases, role
configuration, and the migration ledger. A tenant JSON export is a maintenance
artifact, not a complete disaster-recovery backup. Do not log its contents.
