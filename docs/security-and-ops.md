# Security and operations

This is a testable local product, not a production-supported release. Do not deploy until the gates below are owned and verified.

## Invariants (do not weaken)

- Never commit secrets, `.env`, tokens, database locators, or real resident data.
- Parameterized SQL only. Tenant repositories use the connection bound to server-side `TenantContext`.
- UI visibility is not authorization. Enforce role and membership on every API read/write.
- Operator access fails closed unless `OPERATOR_IDS` lists the exact Auth0 `sub`.
- Auth0 verifies resident email OTP and passkeys. Every resident email must be verified; passkeys are optional. Do not accept a second OTP issuer or skip invitation acceptance.
- Do not fake payment success, checkout, or worker job completion.
- Invitation capabilities are single-use and expire after seven days, delivered by private flat signup QR or email. A QR authorizes enrollment for its saved flat; client block/flat labels never authorize access.
- Minutes of Meeting drafts are admin-only. Published notes/attendance snapshots are immutable; resident responses include attendee names and block/flat labels but no contact details, internal attendee IDs, or publisher subjects. Attendance never grants access.
- Complaint/maintenance UUIDs stay the API identifiers; `CMP-`/`MNT-` are display references.
- Production origins use HTTPS. Auth0 callback, logout, and web-origin lists must match those origins exactly.
- Operator production access needs an approved private ingress (or equivalent) in addition to Auth0. Local loopback publish is not that control. `OPERATOR_WEB_PRIVATE_INGRESS` in Compose is not production ingress.

Resident passkey replacement requires a fresh Auth0 email OTP in the resident app. Previous passkeys remain until Auth0 confirms a new credential; completion removes the snapshotted previous passkeys, sends a security email, and records a platform cutoff for previous application sessions. The API checks the original Auth0 authentication time, not token issue time, so refreshing a previous token does not bypass the cutoff. The supplied Auth0 Action is mandatory. This invalidates access to MyApartment APIs; it does not delete cloud-synced credentials from devices or terminate unrelated Auth0 applications. There is no admin credential deletion or cooling period. See [setup and verification](./resident-authentication.md).

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
