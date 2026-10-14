# ADR-0001: Production readiness decision backlog

- Status: Proposed / awaiting owner decisions
- Date: 2026-10-11

## Context

The project has an approved production baseline for architecture and deployment controls, but several operational, commercial, and support decisions remain unresolved. These decisions are intentionally left open so they can be answered by the product owner or accountable human before the system is treated as production-ready.

This ADR tracks the open decisions listed in the architecture baseline and records the owner, questions, and consequences needed for a go-live decision.

## Decision summary

| Decision | Question to answer | Current baseline | Status |
| --- | --- | --- | --- |
| Launch scope / commercialization | What production launch shape is approved? | Prototype and architecture assume a SaaS model for apartment communities, but actual launch scope is not approved | Approved: broader multi-tenant SaaS rollout |
| Payment provider and settlement model | Which provider and settlement model are approved? | Provider-neutral `PaymentPort`; Razorpay is a prototype visual label only | Payment remains disabled until a provider and settlement model are approved |
| SMS/WhatsApp login delivery | Are SMS/WhatsApp login channels approved for production? | Prefer Twilio behind an Auth0-compatible adapter; not enabled by default | Keep both channels disabled for launch until full approval and abuse controls are complete |
| Operator private access | What private access mechanism is approved for the operator console? | Private ingress required, method unselected | Interim decision: keep the operator console public for the next release; final private-access approval is deferred to a later production gate |
| Production availability and SLA | What availability/SLA commitment is approved? | OCI cost-constrained profile with no HA/SLA guarantee | No formal SLA for the next release; treat the deployment as a pilot/release candidate until a formal service target is approved |
| Recovery targets | What are approved RPO/RTO, retention, and legal-hold targets? | Must be set by the data owner | No formal RPO/RTO or backup commitment is approved for the next release; recovery targets remain pilot-only until the data owner sets them |
| Tenant domain and host routing | Which domain and host routing policy is approved for tenant URLs and custom domains? | Host or membership-backed tenant resolution; custom-domain policy TBD | No custom domains are approved for the next release; use standard platform hostnames only |
| Membership invitation policy | What invitation workflow and expiry policy is approved? | Admin/resident invitations require identity verification and expiry | Single-use invitations expire after 7 days and require verified Email OTP for the invited address; email delivery only. SMS/WhatsApp invitation delivery remains disabled. |
| Currency and locale rollout | What currencies/locales are approved for launch and future rollouts? | India/INR default; model locale/currency per tenant | INR and India locale are approved for launch; other currencies/locales remain deferred |
| Support access to tenant data | What support access model is approved? | Default deny with scoped, audited elevation requirements | Deferred to a later release; no support-access tooling is approved for the MVP launch |
| Data retention, deletion, and export | What retention and deletion policy is approved? | Need tenant-scoped export and audited deletion workflow with retention duration TBD | Deferred to a later release; data retention/deletion policy is tracked as a post-MVP TODO |
| Paid OCI fallback | Are paid OCI resources allowed if needed? | Not permitted without explicit human approval | No paid OCI fallback is approved without explicit human approval |
| CI/CD production approver and rollback owner | Who approves production releases and owns rollback decisions? | GitHub Actions approval gate required; names/ownership TBD | TBD; production release approver and rollback owner have not yet been assigned |

## Questions for the approving human

The answers below are required before any production release recommendation or deployment approval.

1. What is the authorized production launch model: single-property pilot, multiple property associations, or broader multi-tenant SaaS rollout?
2. Which payment provider and settlement model are approved for live checkout?
3. Is SMS/WhatsApp OTP allowed in production, and if so, under which consent and abuse controls?
4. What private-access technology is approved for operator access, and who is allowed to use it?
5. What availability/SLA commitment is approved for customer-facing services?
6. What are the required RPO, RTO, backup retention, and legal-hold values?
7. What host/domain routing policy is approved for tenant URLs and custom domains?
8. Are any changes required to the approved seven-day invitation expiry, verified Email OTP acceptance, or email-only delivery policy?
9. What are the approved default currency and locale settings for launch and future expansion?
10. What tenant-data support access policy is approved, including audit and time limits?
11. What retention, export, and deletion policy is approved for each tenant and region?
12. Are any paid OCI fallback resources permitted, and under which approval path?
13. Who is the named production approver and rollback owner for release approval?

## Consequences

- Without explicit answers, production deployment remains blocked by the architecture and release gates.
- Any assumption beyond the current baseline is treated as an unapproved risk and must be revisited.
- Credentials and private access settings must remain in the approved secret manager and private network path only.

## Status and next step

This ADR is intentionally left open until product and operational owners answer each question. Once approved, the final ADR will replace this pending backlog with the agreed production decisions and their rollout/migration plan.
