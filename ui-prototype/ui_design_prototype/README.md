# Responsive PWA design pack

Prepared 22 October 2026 from the current resident/admin source and API handlers. This is a design specification, not a claim that the apps are production ready or visually tested.

## Use this pack

1. Read [the product and screen brief](PRODUCT-AND-SCREEN-BRIEF.md). It defines scope, screen IDs, business rules, and complete journeys.
2. Read [the responsive and PWA requirements](RESPONSIVE-PWA-REQUIREMENTS.md). Apply these to every screen.
3. Attach all briefs, including [the proposed release additions](RELEASE-ADDITIONS.md), to ChatGPT with Product Design in its supported Work environment. Copy [the master design prompt](AI-DESIGN-PROMPTS.md). Explore three visual directions first, then use the batch prompts after choosing a direction.

Keep the screen IDs in generated designs so implementation can be traced back to this pack. All three files are ordinary Markdown and can be uploaded or pasted into AI design tools.

## Confirmed direction and remaining assumptions

- Confirmed: launch designs cover implemented features, complaints, admin ledgers, and important accounts/maintenance workflows. New modules are specified in RELEASE-ADDITIONS.md and need implementation.
- Confirmed: use ChatGPT with Product Design; let the design tool propose visual directions.
- **MyApartment by BLOCK9** is the configured product identity. Green `#174c43` is current configuration evidence, not a locked visual direction. Internal dependency names remain unchanged and are not user-facing branding.
- English and Telugu are the initial design languages because both are configured today. Translation completeness and typography still need verification.
- Resident usage is primarily on phones; admin usage spans phones and desktop. These are design assumptions, not findings from user research.
- Separate Resident and Apartment Admin installable experiences, consistent with the existing app split.
- Launch is online-first. Offline financial actions and push notifications are not promised.

## Questions to finalize the brief

1. Final brand identity can follow later. Use replaceable wordmark, icon, and color tokens for now; do not block design exploration on branding.
2. ChatGPT Product Design is confirmed. Request three visual options, then a selected direction and connected prototype.
3. Confirm launch languages and the primary region. English/Telugu, INR, and Indian date conventions are the baseline.
4. Complaints, ledgers, and core accounts/maintenance additions are included. Confirm the recommended scope in RELEASE-ADDITIONS.md; online payments, visitors, and amenities remain outside baseline.
5. Should residents submit only the calculated available amount, as the current UI does, or also enter partial amounts, a payment date/reference, and proof? Those additions require product/API review.
6. Are named poll choices intentionally visible to other residents when results are visible? That is current behavior; the design must explain it before voting.
7. What are the intended community sizes, typical monthly billing volume, and admin comfort with spreadsheets? These affect density, paging, and mobile entry design.
8. Which minimum OS/browser versions and real devices must launch support? Which native app technology is intended later, if already decided?
9. What real support contact, privacy policy, and terms should appear? Configuration contains placeholder-like details; do not publish them as verified contacts.

Answers can refine the pack without blocking an initial design exploration. Defaults are provisional, not approvals.

## Evidence and limits

Reviewed the resident and admin feature components, authentication and invitation pages, shared login entry, manifests/layouts/service-worker registration, API route dispatch and relevant handlers, billing calculations, branding/localization configuration, shared tokens, and project documentation. This is a source-based flow inventory; no running UI screenshots, live provider checks, or end-to-end validation were performed.

Primary source map:

| Source | What it establishes |
| --- | --- |
| `apps/resident-web/src/features/home/resident-home.tsx` | Five resident destinations, payment reporting, history, announcements/polls, profile |
| `apps/admin-web/src/features/dashboard/admin-dashboard.tsx` | Nine admin destinations, setup, lifecycle, billing, collection and communication workflows |
| `apps/admin-web/src/lib/auth-ui.tsx`, `apps/resident-web/src/lib/auth-ui.tsx` | Email OTP, workspace picker, access/error states |
| `apps/admin-web/src/app/(auth)/invite/page.tsx` | Admin invitation lookup, email matching, acceptance |
| `apps/resident-web/src/app/resident-invite/page.tsx` | Resident invitation, explicit acceptance, future start date |
| `apps/api/src/index.ts`, `manual-payments.ts`, `resident-invitations.ts`, `billing-calculations.ts` | Persisted operations and server-side rules |
| `apps/{admin-web,resident-web}/src/app/manifest.ts` | Separate standalone manifests with SVG icons |
| `apps/resident-web/public/sw.js`, `src/app/pwa-registration.tsx` | Resident registration; no fetch caching/offline data |
| `packages/app-platform/config/` | Configured product name, brand green, English/Telugu |
| `packages/design-tokens/tokens.css`, both app `globals.css` files | Existing focus/control tokens and responsive treatments |

Some README statements are stale: invitations, invoice publishing, offline collection, and multi-workspace UI exist in current code. Settings also contains broad availability copy that conflicts with the working Billing section. Use current implementation evidence and the distinctions in this pack when generating screens.
