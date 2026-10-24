# Responsive and PWA design requirements

Apply to existing workflows and the proposed additions in RELEASE-ADDITIONS.md. Everything below is a design requirement/proposal unless explicitly identified as current implementation.

## Visual exploration and system

The user wants the design AI to suggest the visual direction. Explore exactly three coherent alternatives on the same representative screens: resident Home, admin Overview, and one complaint or ledger screen. Suggested exploration territories are warm community, precise professional, and friendly minimal; the tool may propose better names/directions. Vary typography, density, color, shape and hierarchy, not just accent color. Compare readability, financial clarity, phone usability, and admin productivity before choosing.

Use the product name MyApartment and company name BLOCK9. Current configured green `#174c43` is an option, not a constraint. Keep wordmark/icon/color/font tokens replaceable. Avoid stock apartment photographs dominating operational screens, excessive gradients, low-contrast glass panels, or decorative charts without data.

After selection deliver semantic color tokens (brand, canvas, surface, text, border, focus, success, warning, danger, info), typography, spacing, radius, elevation, icons and interaction states. Suggested starting sizes: 16px body, 14px secondary text, 24–32px page headings, 4/8px spacing rhythm, 44–48px primary controls. Final choices must pass contrast checks. Use tabular numerals for money and aligned decimal/currency formatting.

Components: app shell, workspace selector, role badge, desktop sidebar/mobile navigation, cards, metric cards, filters/search, tables and mobile record cards, invoice breakdown, status pills, disclosure rows, field/help/error groups, OTP input, modal/full-screen task sheet, stepper, confirmation, banners, toast/live status, empty states, skeletons, poll options/results, complaint timeline, file upload, ledger running-balance row, date/account filters, pagination and reconciliation status.

Light theme is required. Dark theme is optional exploration, not a launch blocker. Do not produce multiple visual systems for different roles.

## Responsive composition

| Viewport | Resident | Admin |
| --- | --- | --- |
| 320–430px phone | Single column, five readable tabs, primary task above fold | Five-item navigation, stacked records, task-specific full-screen forms |
| 768–1024px tablet | Single or two-column content according to available width; rail/sidebar when usable | Collapsible sidebar, compact tables or master/detail, touch-friendly entry |
| 1280–1440px desktop | Sidebar, constrained reading width, contextual secondary column | Persistent sidebar, metric grid, tables, split detail/review panels |

Reference artboards: 390×844, 360×800, 768×1024 and 1440×1024. Verify reflow at 320px as well as intermediate widths and landscape. These are test widths, not device restrictions or fixed page heights.

- Desktop is a deliberate composition, not a stretched phone frame. Phone screens preserve complete workflows, including billing setup and complaints/accounts work.
- On phones convert collections, flats, ledger and expense rows into labeled cards with amount/status and primary action visible. Complex readings can use one-flat-at-a-time entry. Comparison tables may use an explicitly labeled local horizontal scroll region; the full page must not scroll sideways.
- Preserve searches, filters, and scroll position on detail/back. State a proposed unsaved-changes policy for task forms and workspace switches.
- Long forms use section labels, progressive disclosure and review steps. Keep field errors adjacent and move focus to the first error. Do not compress a desktop modal into a tiny phone overlay.
- Sticky actions sit above bottom navigation and device safe areas. Include space below content and account for on-screen keyboards. An amount, submit button, and error must remain reachable when the keyboard opens.
- Provide normal button/keyboard refresh in addition to optional pull-to-refresh; gestures are never the only action. Use visible Back/Close within standalone app screens.

## PWA state inventory

| ID | State | Required design behavior |
| --- | --- | --- |
| P01 | Install invitation | Nonblocking explanation of home-screen access, Install/Add to Home Screen, Not now |
| P02 | Android/eligible desktop install | Invoke available browser installation UI; handle dismissal; do not draw a fake OS permission dialog |
| P03 | iPhone/iPad guidance | Safari Share → Add to Home Screen, with version-appropriate illustrations; explain opening in Safari when needed |
| P04 | Installed launch | Distinct Resident/Admin icon label and launch shell, session check, correct landing destination |
| P05 | Install unavailable/already installed | Hide redundant CTA, offer browser use/help, no forced installation gate |
| P06 | Offline start | Branded generic shell, “Connect to load your account”, Retry; no invented balances or cached personal records |
| P07 | Connection lost during use | Persistent connection status, preserve only current in-memory context if appropriate, no mutation available while disconnected |
| P08 | Reconnected | Refresh authoritative records, show refresh failure separately, enable actions after reconciliation |
| P09 | Update available | Nonblocking Reload/Not now; defer reload during a form or financial submission |
| P10 | Session expired/account changed | Reauthenticate and reload role/workspace context; never reveal another user's records |
| P11 | Request outcome unknown | “We couldn’t verify whether this was saved. Refresh to check before trying again.” with source-record/status check |

Install copy must say quick home-screen access, not “works fully offline”. Show the install nudge after a useful first experience or in account/help; never interrupt OTP entry, payment review, or publishing. Installation is optional and does not itself enroll a person or keep a session permanently signed in.

Current implementation: both manifests set standalone display and use the same configured product short name with SVG logo icons. The resident registers a service worker whose fetch handler performs no caching. No admin service worker was found in the reviewed app tree. Guided install, offline shell, update controls, distinct app labels, raster/maskable icons and Apple touch icon assets need implementation/verification. Design role-distinct icons using the same brand family and propose labels such as “MyApartment” and “Apartment Admin”; validate truncation after final branding.

Design assets to supply: regular app icon at 192/512px, maskable icon artwork with safe inset, Apple touch icon, wordmark, favicon, launch background and install guidance illustrations. Final platform behavior depends on manifest/assets, HTTPS, browser support and device testing; a manifest alone is not acceptance evidence.

Installation UI varies by browser/platform. Feature-detect browser install support; do not assume a custom Install button can trigger an iOS prompt. See [MDN installability guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) and [Apple's iPad home-screen instructions](https://support.apple.com/en-mide/guide/ipad/ipad8f1f7a29/ipados). Sources checked 22 October 2026; verify actual browser menus on the release device matrix.

Push is a separate proposed future capability. iOS/iPadOS home-screen web apps can support Web Push on supported versions, and permission must follow a user interaction. Do not equate an in-app unread indicator with OS notification delivery. See [WebKit's Web Push guidance](https://webkit.org/blog/13878/) and [Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## Accessibility and localization

- Target WCAG 2.2 AA: keyboard operation, visible focus, accessible names, meaningful headings/landmarks, dialog focus containment/return, status announcements and errors linked to fields. Never encode payment/complaint status only by color.
- Use at least 4.5:1 contrast for normal text, 3:1 for large text, and appropriate non-text contrast for controls. Use 44–48px touch targets as a product comfort target; WCAG 2.2 AA's minimum target criterion is 24px subject to its exceptions, not a blanket 44px requirement. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [W3C target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum/).
- Demonstrate 200% zoom, large text, narrow reflow, reduced motion, long names/emails, no hover dependency and accessible data alternatives for any chart.
- English and Telugu are configured. Include a Telugu font with complete glyph coverage, longer labels and appropriate line height; preserve names/numbers. Have translations reviewed rather than treating generated Telugu as approved copy.
- Label amounts as INR/₹ consistently, use Indian grouping, distinguish month-period from transaction date, and name units (sq ft, kL). Use community timezone for scheduled announcements/polls and display a timezone hint in admin scheduling. UI text must not expose API identifiers or “minor units”.

## Future native handoff

Deliver platform-neutral tokens and component states, clear navigation hierarchy, entry/deep-link maps, safe-area rules, and OS-owned interactions as explicit handoff notes. Native rendering and navigation will still need platform implementation; this design pack does not imply automatic conversion from Next.js to a native app.

## Design acceptance

The design is ready for implementation planning when every screen ID has a frame or documented reuse, both roles have connected journeys, phone/desktop/tablet transformations are shown, proposed features are annotated, and empty/loading/error/offline/session/permission states are covered. Verify the canonical payment scenario across apps, private complaints, anonymous poll results, ledger totals, and correction trails. A prototype must identify simulated data/actions; it must not claim real delivery or production completion.
