# Phase 2 — resident and apartment-admin product

Read [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), Phase 1's result, and the
architecture documents before implementation. Treat
[`../../figma-prototype/src/App.tsx`](../../figma-prototype/src/App.tsx) as
the visual/workflow reference and
[`../architecture/product-and-system.md`](../architecture/product-and-system.md)
as the product contract. Prototype data, fake success states, and inert
controls are not production behavior.

## Goal

Deliver the resident and apartment-administrator journeys end to end across
the Flutter client, admin web, versioned API, tenant-scoped persistence, and
worker integrations. Preserve the prototype's information hierarchy and
responsive behavior while making each available action real and authorized.

## Resident experience

- Implement Auth0 email-OTP sign-in/sign-out and tenant-aware bootstrap. Do
  not expose demo accounts, role switching, or hard-coded production identities.
- Deliver home data from the API: current dues and due dates, itemized
  maintenance bill, recent transactions, community notices, and eligible
  sponsored cards.
- Implement bill review, allowed payment-method presentation, payment intent
  creation, pending/failed/cancelled/succeeded/refunded/reconciled states as
  supported, status refresh, and recovery from delayed callbacks. A browser or
  app callback is never proof of payment. Keep checkout disabled with a clear
  explanation until the approved provider/merchant model and credentials
  exist; never simulate success.
- Add payment history, filters, transaction references, downloadable
  receipts, and confirmation notifications based on persisted server state.
- Implement notices, unread status and mark-all-read; profile and unit
  details; notification/contact preferences; privacy/data information; help
  and support; and resident ad preferences.
- Implement sponsored recommendations only on eligible home placements.
  Label sponsored content, enforce tenant and resident preferences and
  frequency caps server-side, and suppress ads throughout bill review,
  checkout, payment processing, and receipt views.

## Apartment administrator experience

- Provide a tenant-aware overview with billed, collected, outstanding, and
  overdue totals; collection trends; unit payment status; recent transactions;
  and navigation to authorized work queues. All metrics must come from
  tenant-scoped APIs, not static prototype values.
- Manage organization/property/building/floor/unit hierarchy, unit metadata,
  occupancy and rates, resident relationships, and validated CSV import with
  row-level errors and safe retry.
- Search/filter residents and inspect unit/access/payment state. Implement
  invitation, expiry/re-send/revocation and acceptance flows according to the
  approved invitation policy; if that decision remains open, keep invitation
  activation gated and communicate why.
- Configure typed billing rules, due dates, rounding, grace periods, and
  permitted late fees. Preview invoice runs and exceptions; require explicit
  authorization and confirmation before publishing. Use idempotent worker
  jobs for bulk invoice generation and notifications.
- Provide transaction search/export, authorized offline-payment recording
  with evidence and audit history, discrepancy handling, provider-backed
  reconciliation where configured, and safe CSV exports.
- Provide aging buckets and permitted follow-up tracking. Use only approved
  channels: email and in-app notices for reminders. Never send payment
  reminders or announcements over SMS/WhatsApp.
- Deliver tenant-scoped reports for collections, reconciliation, outstanding
  dues, and follow-up; organization settings; team roles/permissions; and
  tenant communication/billing/ad preferences.

## Shared implementation requirements

- Add database models, tenant migrations, repository methods, use cases,
  validated API DTOs/OpenAPI operations, authorization, and UI integration
  for each delivered workflow.
- Persist money as integer minor units or a documented exact decimal with ISO
  currency, and calculate totals on the server. Default display to INR/en-IN
  while modeling tenant currency, locale, and timezone explicitly.
- Every screen/action must include loading, empty, validation, success,
  failure, and retry behavior as appropriate. Inaccessible features must
  state the dependency/reason rather than look functional.
- Keep visual styling and layout faithful to the prototype while adding
  accessible labels, keyboard/focus behavior, mobile responsiveness, and
  useful error feedback.
- Keep adapters behind ports: Auth0, Resend email, Firebase push, Filebase
  storage, and any approved payment provider. Do not introduce a gateway or
  operational provider on assumption.

## Required tests and phase exit criteria

- Test billing rules, rounding, invoice preview/publish permissions, offline
  payment audit, and payment-state transitions.
- Test resident/admin permission boundaries and attempts to access another
  tenant's residents, units, invoices, payments, notices, files, reports, and
  support records.
- Test bulk-job idempotency, retry/recovery, integration outages, webhook
  verification where applicable, export scoping, and ad exclusion from
  payment-related screens and APIs.
- Exercise every visible prototype action through a real API workflow or a
  clearly disabled/dependency-gated state. Verify the role-based flows in UI
  tests and the responsive screens against the prototype.
- Run relevant tests plus repository type-check, lint, and build. Report any
  provider setup or decisions still required; do not claim live payments
  without approval and a verified provider.
