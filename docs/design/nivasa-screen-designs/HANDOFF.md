# Frontend implementation handoff

## Foundation

Use `src/tokens.css` as the semantic starting point. Brand #087e88, dark blue #173a65, canvas #f5f7fa, ink #152337, secondary text #647185, border #e2e8f0. Use 16px body, 14px secondary copy, 24–32px page headings, tabular currency numerals, an 8px spacing rhythm, 14px surface corners, and 44–48px primary controls. Inter is preferred; the prototype currently uses installed system fallbacks. Bundle Inter and a reviewed Telugu font before production. Check contrast on the final font and color combinations.

Reference-derived logo/photos are raster reference crops. Replace the logo with licensed vector artwork and complaint photographs with authenticated upload URLs. Standard UI icons use Phosphor React.

## Reusable screen structure

`Brand`, `Head`, `Card`, `Btn`, `Pill`, `Banner`, `Field`, `Records`, `FilterBar`, `AppForm`, `Metrics`, and the complaint thread establish reusable component anatomy. Split the large demo App into route modules when implementing. Keep business calculations and authorization out of presentation components.

`src/screens.js` lists all 77 IDs. Every ID has a renderable exported frame. Shared access and PWA screens reuse consistent shells. L10 intentionally reuses the accounts metrics with a summary note. More is a destination list rather than a new business module.

## Responsive transformations

At widths above 1050px the admin uses a 236px sidebar, four metric columns and split primary/context content. At intermediate widths the sidebar narrows and metrics become two columns. At 700px and below the sidebar is replaced by five bottom tabs, tables become labeled record cards, forms become single column, and details stack. Preview presets are implemented with container queries, so 390px behaves as a phone even on a wide desktop browser.

The viewport is scrollable, never a fixed-height screenshot. Keep mobile navigation above safe-area insets and allow bottom content clearance. Validate at 320/360/390/768/1024/1440, landscape, large text, 200% zoom and keyboard-open form entry.

## Required production behaviors

- Replace local state with authenticated APIs and role/community scoped routes. Every read and write requires server authorization. Workspace change must clear previous community records and drafts; the demo has only one community.
- Bind form values to newly created records; several demo review screens intentionally reuse canonical example records. Add adjacent field errors, validation summaries, submission locking, stale-record conflicts and idempotency.
- OTP verification must precede invitation acceptance. Demo code 1234 and demo invitation buttons are simulation only.
- Payment reports preserve outstanding/pending/reportable distinctions. Confirm receipt exactly once, allocate one collection across invoices without duplicating cash, and refresh authoritative values after confirmation.
- Billing template selection needs complete conditional schemas. Monthly readings need one-flat-at-a-time mobile entry, exclusions, carried openings and validation. Publish only with a current server-issued preview; prevent publishing the same month twice.
- Resident replacement is two operations. Show partial success and retry invitation only. Former resident settlement means verified receipt, never a waiver.
- Complaints require persistent separate public replies and internal notes, upload handling/limits, admin-only assignment and priority, stale updates, resolution note, resident acceptance and reopen reason. No guaranteed emergency service is implied.
- Account entries require source data, explicit cash/bank account, opening cutover controls, persisted audit trail and balanced reversal/replacement. Reconciliation needs matched/unmatched entry selection and verified statement totals; the demo review is not real reconciliation.
- Polls require 2–10 distinct options, schedule validation, anonymity enforcement, server-enforced vote deadline/permission, named/anonymous results and retention. Never show identities for anonymous choices.
- Build install/update states using actual platform support. No fake OS prompts, offline financial writes, background sync or sensitive-record caching. Defer reload while editing/submitting. Unknown outcomes require checking the source before retry.
- Proposed unsaved-change policy: warn before leaving a dirty task or switching community, retain input after ordinary request failures, and clear private drafts on sign-out/session change. This guard needs integration into actual routing.
- Preserve search, filters and scroll position after returning from details. The design prototype resets filters on route change; production needs route/query state restoration.

## Accessibility acceptance

Semantic buttons and labels, keyboard-visible focus and live feedback are present as a foundation. Production must add modal focus containment/return, focus-to-first-error, route title/focus management, accessible loading announcements, complete localization, accessible attachment previews and real-device tests. Color is supplemented with status text. No accessibility conformance claim has been made.

## Scope boundaries

Design sources are the four parent briefs and the user-selected image. New complaints/accounts/install UX are proposed implementation requirements. The prototype has no real backend effects. No exports, online gateway, advertising, vendor accounts, bank feeds, or full general-ledger claims are added from the reference image.
