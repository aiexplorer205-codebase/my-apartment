# MyApartment — blue–teal screen designs

Selected reference: [original design](reference/selected-design.png). Created 22 October 2026. This folder is isolated from the production frontend and the earlier unfinished prototype.

## Review the designs

- [Screen library: 77 responsive HTML frames](frames/index.html). Open this file directly for static reference; each frame contains its CSS and supports window resizing.
- Interactive React studio: http://127.0.0.1:4175/ while the preview server is running.
- `#A02` opens Admin Overview, `#R01` Resident Home, `#C03` Resident Complaint.
- Use **All screens** for the full inventory; **Journeys** connects the twelve specified flows. The studio also provides role, viewport and state selectors. Reset clears simulated state.
- Phone presets: 320, 360, 390. Tablet: 768, 1024. Desktop: 1440 and responsive.

## What is included

8 access/onboarding screens, 11 resident screens, 30 admin screens, 7 complaints/maintenance screens, 10 accounts screens, and 11 PWA states. Navigation, forms, billing review, payment report/confirmation, complaint replies, polls and account reviews run on fictional in-memory data. Static exports are visual frames, so their controls are intentionally inert.

Reference styling is applied across the screen set: navy headings, pale cool canvas, blue–teal actions, fine borders, compact semantic pills, initials avatars, desktop sidebar, and five mobile destinations. The supplied logo and two complaint photos are cropped from the chosen reference. They are design-reference assets; replace with approved production brand artwork and real user uploads during implementation.

## Product choices

The image determines visual direction. The briefs determine product behavior. Therefore the prototype uses Lakeview Residency / APT-1042, Ananya Rao, Ravi Kumar, and the October ₹3,000 invoice. It does not add the image's gateway payment, advertising, export, or unsupported vendor role.

Resident tabs: Home, Payments, Updates, Complaints, Profile; history is under Payments. Admin tabs: Overview, Flats, Billing, Collections, More; desktop exposes the extended sidebar. Accounts, complaints, maintenance and PWA guidance are proposed modules/UX, not verified backend features.

Payment example: ₹3,000 due → report offline payment → ₹3,000 outstanding / ₹3,000 pending / ₹0 available → admin confirms → ₹0 outstanding / ₹0 pending. A report alone never credits the ledger or cash funds. Posted account corrections use reversal/replacement, and former resident debts remain attached to their identity.

## Developer handoff

- [Implementation guide](HANDOFF.md)
- [QA status](design-qa.md)
- `src/tokens.css`: semantic colors and typography.
- `src/styles.css`: shared components and container-query responsive transformations.
- `src/screens.js`: canonical IDs, field specifications and connected journeys.
- `src/App.jsx`: interactive screen structures and reusable components.
- `frames/`: standalone HTML reference for every screen ID.

Install with `npm install`, run with `npm run dev -- --host 127.0.0.1 --port 4175`, build with `npm run build`, regenerate frames with `npm run export:screens`. Sites packaging is preserved but nothing has been published.

## Verification and limitations

Production build and packaging checks pass. Every screen is server-rendered during frame export to catch missing render functions and render-time exceptions. This is not browser interaction, visual, accessibility, or device testing.

Visual QA remains blocked because neither the in-app browser nor any other browser is connected in this session. Do not treat this as a pixel-verified, production-ready UI. Backend services, real email/OTP, durable records, uploads, notifications, installation, service workers and reconciliation are not connected. Some administrative controls are design simulations and need final validation and backend rules during frontend implementation. Read `HANDOFF.md` before integrating.
