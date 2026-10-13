# Open decisions and approval gates

Do not silently convert these items into implementation assumptions.

The approved decision backlog is tracked in [ADR-0001: Production readiness decision backlog](./ADR-0001-production-readiness-open-decisions.md). Use the ADR as the canonical record for open owner decisions and their approval status.

| Decision | Current baseline | Required before |
| --- | --- | --- |
| Payment provider and merchant/settlement model | Provider-neutral `PaymentPort`; Razorpay in prototype is not an approval | Live checkout, gateway credentials, settlement reporting |
| SMS/WhatsApp login delivery provider and eligibility | Twilio messaging is the preferred adapter candidate for login OTP only; disabled pending Auth0-compatible validation and human approval | Enabling either channel in production |
| Operator private access mechanism | Private ingress required; method not chosen | Production operator-console exposure |
| Production availability/SLA | OCI cost-constrained profile; no HA or SLA promise | Customer-facing availability commitments |
| RPO, RTO, backup retention, and legal hold | Must be set by data owner; no numeric targets assumed | Production operations and customer contracts |
| Tenant domain / host routing policy | Resolve tenant from verified host or membership-backed selection; custom-domain policy TBD | Custom domains or tenant vanity URLs |
| User membership invitation policy | Admin invitations are in prototype; identity verification and invitation expiry need a product/security decision | Production invitations |
| Currency and locale rollout | India/INR default; model locale/currency per tenant | Any launch outside the India/INR baseline |
| Support access to tenant data | Default deny; any elevation must be approved, scoped, time-limited, and audited | Tenant-scoped operator support tools |
| Data retention/deletion and export | Implement tenant-scoped export and audited deletion workflow; retention duration TBD | Customer contracts and production deletion |
| Paid OCI fallback | Not permitted without explicit human approval | Any deployment requiring paid resources |
| CI/CD production approver and rollback owner | GitHub Actions approval gate required; names/ownership TBD | First production release |

Each decision should be recorded in an ADR or this table with owner, date,
consequences, and rollout/migration plan. Provider credentials belong only in
the approved secret manager.
