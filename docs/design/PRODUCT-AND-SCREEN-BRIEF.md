# MyApartment by Block5: product and screen brief

## Product intent

Design two related responsive PWAs for apartment communities: Resident and Apartment Admin. People can use either in a browser or save its icon to their home screen. A later native client should retain the same task structure, terminology, and reusable design tokens.

Residents need to understand their dues, report an offline payment, check confirmation, read community updates, participate in polls, and maintain their profile. Administrators need to configure blocks/flats, manage occupancy and invitations, generate monthly invoices, confirm money received, and communicate with residents.

The platform operator console is a separate internal product and is outside this screen scope. Operator-created admin invitations are an entry dependency only. The user's confirmed launch design scope also includes complaints, admin ledgers, and important accounts/maintenance features; see RELEASE-ADDITIONS.md for these proposed modules. Its scope overrides the original baseline exclusions below for those features.

## Scope labels

- **Existing:** backed by current UI and API code, without implying production verification.
- **Proposed launch UX:** a design improvement or PWA state that still needs implementation.
- **Future:** outside the baseline launch; show only in an explicitly separate concept section.

| Capability | Baseline |
| --- | --- |
| Shared role entry, email OTP, invitations, workspace selection | Existing |
| Resident dues, current invoice breakdown, offline payment reports and status | Existing |
| Resident history, announcements/read state, polls/vote changes, name/phone edit | Existing |
| Admin blocks/flats, invitations, move-out/replacement, former-resident settlement | Existing |
| Billing templates, areas, monthly inputs, preview, publishing, runs/invoices | Existing |
| Collections confirmation, latest-invoice overdue queue, summary reports | Existing |
| Scheduled announcements and polls, end actions, poll results/responses | Existing |
| Guided installation, update/reconnect states, offline shell, durable screen links | Proposed launch UX |
| Online checkout, saved cards, payment proof upload, automated billing reminders | Future |
| PDF receipts/download exports, aging reports, organization/team editing | Future |
| Complaints, ledgers, core accounts and maintenance queue | Proposed release modules; see RELEASE-ADDITIONS.md |
| Visitors, amenities, chat, marketplace, advertising preferences | Future |
| Push delivery, offline writes, background sync, native biometrics/passkeys | Future unless separately scoped |

Do not turn domain types, disabled controls, or profile placeholder rows into live features. Grace/late-fee configuration does not establish automatic fee charging. Publishing invoices does not notify residents today.

## Roles, context, and navigation

Every authenticated screen must make the selected apartment/community clear. Keep apartment name and Apartment ID distinguishable from block/building and flat number. Membership in one app does not automatically grant the other app's role.

Existing resident destinations: Home, Payments, History, Announcements, Profile. Recommended mobile wording is Home, Payments, History, Updates, Profile; document that Updates includes announcements and polls. If retaining Announcements, demonstrate that the label fits Telugu and narrow phones. Desktop uses a sidebar and a readable content width.

Existing admin destinations: Overview, Flats & Residents, Billing, Collections, Overdues, Announcements, Polls, Reports, Settings. Recommended phone navigation: Overview, Flats, Billing, Collections, More. More includes Overdues, Announcements, Polls, Reports, Settings and workspace/account controls. Desktop exposes all nine in a sidebar. This regrouping is proposed UX, not current routing behavior.

Existing major destinations use component state rather than individual URLs. Design stable destinations and sensible Back/Close behavior as a proposed navigation improvement. Switching apartment clears the previous apartment's records, selections, previews, and drafts before loading the next one.

## Shared entry and access screens

| ID | Screen | Content and actions | Required variants |
| --- | --- | --- | --- |
| S01 | Choose app | Product identity, Resident and Apartment Admin links | Phone single column; desktop split composition; no operator option |
| S02 | Email sign-in | Role label, email, Send OTP | Invalid email, sending, network error; invitation email locked |
| S03 | Verify email | Destination email, four-digit code, paste/autofill, verify, change email | Wrong/expired code, verifying, connection loss; resend/cooldown is proposed UX, not current control |
| S04 | Workspace selection | Authorized communities with Apartment IDs, current selection | One membership auto-selection, multiple memberships, none, failed lookup |
| S05 | Access recovery | Explain inactive/missing membership or missing resident profile | Wrong role, future access start, ended membership; relevant invitation guidance |
| S06 | Session expired | Sign in again with destination preserved where safe | Mid-task expiry, reconnect before retry; no sensitive content behind signed-out view |
| S07 | Admin invitation | Lookup, invited email, OTP, acceptance status, Open admin portal | Missing/expired/used link, wrong account, lookup failure; current acceptance is automatic after verified sign-in |
| S08 | Resident invitation | Community, flat, name/start date, locked-email OTP, Accept invitation | Wrong account, expired/revoked/used link, accepting, accepted, future start |

Do not imply public self-registration. An invitation grants access through its acceptance flow; merely signing in does not accept an admin invitation. Resident invitations currently state seven-day expiry. Do not invent admin expiry duration. Distinguish invalid links from temporary lookup failures so retry is available when appropriate.

## Resident screen inventory

| ID | Screen | Required content/actions | States and constraints |
| --- | --- | --- | --- |
| R01 | Home | Greeting, community/flat, current due and date, pending confirmation amount, Record offline payment, recent payments, announcement/poll entry | No invoice, all paid, due soon, overdue, pending-only, loading/error |
| R02 | Invoice and payment report | Current invoice breakdown, period selector, all outstanding option, available amount, submit | Maintenance, water, sinking fund, previous dues, fees, round-off when supplied; older invoice itemization is not available in current resident UI |
| R03 | Report submitted | Amount, covered periods, Awaiting admin confirmation, View history | Proposed dedicated result screen; existing UI uses feedback message; never say payment completed |
| R04 | Payment history | All/Paid/Pending filters, amount, date, period, method, status/reference where present | No payments, no filter match, awaiting confirmation, confirmed; existing data is recent payments, not guaranteed complete archive |
| R05 | Payment record detail | Selected record metadata and status explanation | Proposed detail view using available fields; no fabricated receipt number, downloadable PDF, or gateway tracking |
| R06 | Updates list | Announcement/poll cards, unread count, Mark all as read | Empty, read/unread, important, banner, scheduled/live/ended poll where supplied |
| R07 | Announcement detail | Full title/body, date, importance/banner labels, back | Opening marks read; dismissing a banner is a separate action and is currently local component state |
| R08 | Poll detail/vote | Question, privacy disclosure, deadline, options, vote/save vote | Unvoted, saving, voted, edit allowed, legacy vote locked, scheduled, ended, server rejects late vote |
| R09 | Poll results | Count and percentage per option, total, visibility deadline | Hidden while live unless enabled; no votes; anonymous versus named choices; expires from resident feed after retention |
| R10 | Profile | Name, email, phone, flat/community, language, workspace, sign out | Phone and desktop layouts; avoid a menu full of dead links |
| R11 | Edit profile | Full name, optional phone, Save/Cancel | Email and flat are read-only; validation, saving, save failure, success |

Profile rows for notification preferences, saved methods, help, privacy/data, and ads currently use placeholder behavior. For the launch design, omit unsupported product settings or give a restrained unavailable explanation. Legal/support destinations need real content before being made active.

### Resident financial truth

- Existing submission reports an offline payment. It neither transfers money nor opens a payment gateway.
- The current UI submits the calculated available balance for the selected invoice or all outstanding invoices. It does not expose a free amount, date, reference, payment-method picker, or attachment upload.
- Show **outstanding**, **awaiting confirmation**, and **available to report** as separate values. Pending money is not confirmed money.
- Example: outstanding ₹1,500; already reported ₹500; available to report ₹1,000. A new report can cover ₹1,000. Do not show a settled balance until the administrator confirms.
- For all outstanding, include only reportable amounts and show the affected periods. Fully pending months cannot be reported again.
- Proposed CTA: “Report offline payment”; proposed submit label: “Report ₹1,000”. Supporting copy: “Only report money you have already paid outside this app. Your balance updates after admin confirmation.”
- Preserve server-derived invoice totals and signed round-off values. Do not recalculate carried dues by summing invoice face values.

## Admin screen inventory

| ID | Screen | Required content/actions | States and constraints |
| --- | --- | --- | --- |
| A01 | First-use setup | Add first block, setup explanation | Other sections remain gated until the first block exists |
| A02 | Overview | Occupancy, latest billed/collected/outstanding/overdue summaries, block status, recent transactions | Empty/new community; links to relevant operational sections |
| A03 | Blocks | Cards/list with flat counts, allowance usage, Add block | Block limit reached, load failure, selected block |
| A04 | Add block: details | Name, floors, flat prefix | Floors 1–200; naming/prefix requirements depend on single/multiple-block configuration |
| A05 | Add block: edit flats | Floor groups, add flat, edit number, remove draft flat | No flats, duplicate/invalid number, flat allowance limit, unfinished edit |
| A06 | Add block: review | Final block/floor/flat summary and create confirmation | Explain that created flats cannot currently be edited/deleted in admin; creating/error/success |
| A07 | Flats & Residents | Block filter/context, search, flat rows/cards with occupancy, residents, invitations, invoice state | Vacant, occupied, scheduled, former resident, pending invitation; existing paging is 20 flats |
| A08 | Invite resident | Name, email, optional phone, block/available flat, owner/tenant, start date | Quick-add preselects flat; unavailable flats excluded; duplicate/conflict, sending, sent with expiry |
| A09 | Invitation management | Pending invitations and status, resend, revoke | Expired, accepted/scheduled, revoked, action failed; do not invent acceptance |
| A10 | Move-out and replacement | Current resident, move-out date, next start date, final water reading when needed, optional dues-paid choice, new resident fields | Next start must follow move-out; pending payments can block settlement; partial success must be recoverable |
| A11 | Former resident dues | Resident/flat identity, outstanding amount, settle confirmation | Proposed review presentation for existing settle action; pending-payment conflict, zero due, success |
| A12 | Billing workspace | Saved rules, period, setup dependencies, monthly inputs, preview, invoice runs/list | Not configured, missing areas/readings, already published month |
| A13 | Choose billing template | Standard; maintenance + metered water; per-square-foot | Explain each with simple worked examples; two-step setup |
| A14 | Configure billing | Relevant maintenance/water/sinking fund/rate fields, due day, grace/late-fee fields as applicable | Units ₹, ₹/sq ft, ₹/kL; save/cancel; explain that automatic late fees are unavailable |
| A15 | Flat area setup | Flat, area in square feet, save once | Missing values; saved values locked in current UI; confirm accuracy before save |
| A16 | Monthly readings/charges | Period, flat/resident, opening/closing readings, usage/charge, extra amount/reason, exclusion toggle | Carried opening reading, first reading, invalid closing value, save error; excluded flat clearly marked |
| A17 | Billing preview | Period/due date, eligible count, invoice count, current charges, carried dues, round-off, total, exceptions | Publishable, blocked, stale preview, publishing, publish failed |
| A18 | Published run/invoices | Success, run history, published period, invoice number/resident/flat/status/item summary | “Residents were not notified”; prevent implying email/push delivery; no unsupported invoice edit/void/download |
| A19 | Collections | Confirmed this month, pending amount/count, search, month/status filters, payment rows | Existing 10-row paging; no data/no match; pending/confirmed and other stored statuses |
| A20 | Confirm offline payment | Resident, flat, invoice/period, amount, action explanation, confirm | Proposed review step for existing confirm action; submitting, already confirmed/conflict, error, success |
| A21 | Overdues | Latest-invoice overdue accounts, buildings affected, search, building filter | No overdue/no match; no aging buckets or reminder delivery claim |
| A22 | Announcements | List of scheduled/live/ended records with importance/banner indicators | Empty, failed lookup, selected detail |
| A23 | Create announcement | Title, body, starts/ends, important flag, banner flag | Valid time range, preview proposal, submitting, error, created |
| A24 | Announcement detail | Full copy, schedule/status, important/banner flags, End announcement | Proposed explicit confirmation for ending; no unsupported edit/delete |
| A25 | Poll list | Question, schedule/status, anonymous/open flag, votes, detail, create/end | Empty, live, scheduled, ended |
| A26 | Create poll | Question, 2–10 distinct options, starts/ends, anonymity, live results, results retention | Duplicate options case-insensitive; question 3–500 chars; options ≤200 chars; 7/30/90-day retention |
| A27 | Poll detail/results | Totals, option counts/percentages, privacy, schedule, end action | Anonymous: totals only; open: option filter and named responses, existing 20-response paging |
| A28 | Reports | Latest billed, collected, outstanding, overdue | Read-only summaries; exports unavailable; no invented charts/trends |
| A29 | Settings | Organization and currency, access context, workspace/account controls | Organization/team/payment integration editing unavailable; direct billing changes to Billing |
| A30 | More/account menu | Secondary destinations, workspace, language, install/help entry, sign out | Proposed mobile grouping; all nine admin sections remain reachable |

### Important admin rules

1. Block setup is details → edit draft flats → review → confirm creation. The edit stage starts with an empty draft; do not assume a full grid is automatically generated. Flat suggestions use floor/prefix naming, and names must be unique within the block.
2. A resident invitation occupies an available slot; show scheduled occupancy separately from active occupancy. Do not add household members or simultaneous resident roles beyond supported behavior.
3. Move-out and replacement are separate server operations. If move-out succeeds and invitation fails, say “Move-out saved; invitation not sent” and allow retry without presenting the whole transition as failed or rolled back.
4. Former-resident settlement and “dues paid” change financial records. Use a review step explaining the real-world receipt of money. The settlement action is not a waiver.
5. Billing templates are standard fixed maintenance, metered water, and area-based maintenance. Show fields conditionally and include water usage units. Do not invent prorating or meter-photo upload.
6. Preview uses a server token. If rules/data change or the preview becomes invalid, require a fresh preview before publishing. Avoid showing technical tokens in the design.
7. Published monthly periods must be visibly distinct from draft preparation. Summaries use latest balances to avoid double-counting carried dues; reports are not an accounting ledger.
8. Overdues currently reflects the latest invoice per resident. Do not label this as a complete aging report.
9. Named poll choices can be visible to residents when results are visible. Anonymous poll identities must never appear in admin results. Editing a vote is available only while live and when the API says it is allowed.

## Connected journeys to prototype

| Journey | Sequence | Failure branch that must be designed |
| --- | --- | --- |
| J01 Resident onboarding | Email invitation → S08 → S02/S03 → explicit accept → accepted → S04/R01 | Wrong email, expired invitation, future access start |
| J02 Admin onboarding | Email invitation → S07 → OTP → automatic acceptance → admin portal → A01 → A04–A06 → A02 | Wrong account, failed acceptance, block creation error |
| J03 Monthly billing | A12 → A13/A14 if needed → A15 if needed → A16 → A17 → A18 → resident R01/R02 | Missing input, preview exceptions/stale state, publish conflict |
| J04 Offline payment | R01 → R02 → R03 → R04 pending → admin A19/A20 → R04 confirmed/R01 refreshed | Submit uncertain after connection loss; already confirmed by another admin |
| J05 Occupancy change | A07 → A10 → record move-out → invite replacement → S08 → future/active access | Move-out saved but invite failed; unsettled/pending money |
| J06 Announcement | A22 → A23 → scheduled/live → resident banner/R06 → R07 → read state → A24 end | Invalid schedule, stale ended notice |
| J07 Poll | A25 → A26 → live → R06/R08 vote → R09 → A27 → close → resident retention ends | Duplicate choices, vote closes during submit, privacy disclosure, edit locked |
| J08 Daily install/use | Browser R01/A02 → install guidance → platform install UI → launch installed app → sign-in if required | Unsupported install, already installed, offline launch, session expiry |

## Required example data

Use invented data only: “Lakeview Residency”, Apartment ID `APT-1042`, Block A, flat A-0201, Ananya Rao (resident), and Ravi Kumar (admin). Use `example.test` addresses. Keep amounts and state consistent across both apps.

Canonical scenario: October 2026 invoice = maintenance ₹2,500 + water ₹350 + sinking fund ₹150 = ₹3,000, due 25 October 2026. Resident reports ₹3,000; it remains outstanding with ₹3,000 pending and ₹0 available to report. Admin confirms; pending becomes ₹0 and invoice balance becomes ₹0. Label the timeline as an example, not live records.

Also provide: no invoice yet; no updates; long Telugu text; a ₹1,23,456 display; multiple outstanding periods; part of a balance already pending; an ended anonymous poll; a named poll with results hidden until close; block/flat allowance reached; and partial success in resident replacement.
