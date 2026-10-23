# Resident/admin prototype implementation

Goal remains active. This checklist records remaining work, not release acceptance.
Target: `docs/design/nivasa-screen-designs`, all 77 IDs and all 12 journeys in
`src/screens.js`. Use the current source tokens (indigo/mauve at implementation
start), which differ from the older blue–teal handoff prose. Preserve production
product naming from application configuration. Do not modify the design pack.

## Implemented foundation, pending runtime and visual acceptance

- Shared production semantic tokens and responsive control/type foundations.
- Resident destinations: Home, Payments, Updates, Complaints, Profile. History is
  reachable under Payments and from recent payments.
- Admin phone destinations: Overview, Flats, Billing, Collections, More. More
  exposes the extended admin modules and account/workspace controls.
- Complaints C01–C05: scoped lists, creation, search/status filters, private
  conversation, public/admin-only internal notes, priority, assign to authorized community
  admins/unassigned, optimistic version checks, request-key retry protection,
  public resolution note, resident acceptance and reopen reason. Closed is final.
- Maintenance C06–C07: create/list/detail, due date, optional authorized-admin owner,
  notes and completion note, persisted completion with version/retry protection.
  Completion never automatically posts an expense.
- PWA registration for both apps, real supported-browser install prompt, manual
  iOS/browser instructions, network status, update availability with form-aware
  deferral, network-only private data and static offline navigation fallback.
- Fresh-init SQL includes migrations 017–028: complaints, maintenance, grouped
  payment reports, immutable account entries, expense/source workflow columns and
  audited manual reconciliation, opening cutover/source batches and non-cash
  credit allocations with database-enforced period/cutover controls.
- One report identity across invoice allocations, request-key replay protection,
  report-level Cash/Bank/reference confirmation, one posted receipt, and explicit
  former-resident receipt recording. Move-out itself cannot mark money received.
- Accounts L01–L03/L05–L07/L09–L10 foundations: period Cash/Bank balances,
  resident debits/credits/running balances, source register, draft save/edit/review/
  post, transaction detail, atomic reversal/replacement for expenses/other income,
  source links and monthly summaries. Maintenance can create a linked expense draft.
- Private resident/admin dashboard state remounts on workspace or identity change.

These items are source implementation only until exercised against PostgreSQL
and authenticated apps. Unit tests do not establish complete journey coverage.

## Remaining backend and flow work

- [x] L04 core: first-of-month cutover, verified source note, separate Cash/Bank
  starting funds, resident due/credit inputs, expiring server review, replay-safe
  posting, stale-source rejection, duplicate-debt prevention and opening history.
  Unused balances and an unused cutover date support reviewed corrections with
  preserved originals and reversing/replacement entries. Fund-only corrections
  do not rewrite already collected resident openings.
- [x] Resident opening dues are identifiable, collectible invoices. Explicit
  reviewed credit application allocates oldest available charges without creating
  cash receipts. Pending reports remain reserved. Ordinary postings and new
  billing cannot predate the imported cutover; bank overdrafts remain distinct
  from physical cash counts.
- [x] L05 register server pagination replaces the latest-500 cap. Inclusive date
  range (month bounds by default), Cash/Bank, entry type, draft/posted/reversed
  and literal search filters cover all authorized entries. Reversed selects the
  original corrected entry; Posted excludes reversed originals. Monthly fund
  totals remain full-month figures, clearly separate from filtered activity.
  Counts, activity and fund totals share one repeatable-read snapshot. Filters,
  page and scroll are retained around transaction detail/back; titles and heading
  focus update. Authenticated tests cover 521 entries, all pages, literal wildcard
  input, date validation, correction status and community/role scope. Browser
  keyboard, responsive and visual acceptance remain pending.
- [x] L02/L03 period/filter core: full 20-resident server pages, literal search,
  authoritative block names, current/former/suspended filters and inclusive date
  bounds. Opening + net charges − confirmed credits = period closing; current
  balance, pending reports and available imported credit are separately labeled.
  Ledger activity pages preserve full-history running balances before filtering;
  empty periods still carry opening balances. Corrections offset their original
  debit/credit category and imported credit allocation never creates another
  credit or cash receipt. Counts/rows/balances share a repeatable-read snapshot.
  List filters/page/scroll survive detail/back. Authenticated tests exercise
  27 residents, 26 activity records, period carry, pending exclusion and scope.
- [x] L03 source core: ledger invoice/collection/opening/correction links open
  separately authorized details, retain filters/page and restore the ledger on
  return. Invoice items distinguish carried dues from new ledger charges. One
  collection appears once with all invoice allocations, account, confirmation
  actor/time and posted receipt identity. Imported dues/credits preserve source
  notes; corrections retain reason/original history. Opening source DTOs exclude
  the whole multi-resident import payload. Browser/visual acceptance remains.
- [x] L01/L10 summary core: complete posted monthly expense/other-income
  categories split by Cash/Bank, including signed correction effects and source
  entry counts. Cross-month reversals affect their posting month; drafts and
  unrelated communities are excluded. Opening/receipts/income/expenses/closing
  reconcile independently of register filters. Current published-invoice outstanding,
  overdue and pending reports are labeled separately from period funds; applied
  non-cash credits reduce dues without becoming cash or income. Links open
  resident ledgers, Collections and all posted month sources (including reversed
  originals). All aggregates share the same repeatable-read snapshot. Browser
  comparison and accessibility acceptance remain pending.
- [ ] L06/L07 optional expense/other-income proof upload, private storage,
  authorized source viewing and attachment failure/retry states. Complaint photo
  storage does not yet serve financial proofs.
- [ ] Finish L01–L10 source navigation, remaining additions and visual QA.
  A used resident opening remains locked; correcting its amount requires a
  separate reviewed resident adjustment workflow, preserving the original and
  excluding fictitious cash receipts.
- [x] L08 backend and responsive UI: explicit account/month, manual statement
  totals/reference, posted entry matching, saved drafts, discrepancy checks,
  completed-month finalization, stale snapshot/version guards, retry protection,
  audited reopening, and database-enforced locks on earlier/backdated postings.
  Accounts overview shows reconciliation status and links to each account.
- [ ] L08 browser/device QA and navigation/unsaved-input restoration. The current
  monthly reconciliation batch supports up to 20,000 posted entries; larger
  communities need a paged matching workflow before using this limit.
- [x] A19–A21 collection queue core: complete server search/status/reported-month
  filters and stable ten-report pages replace the latest-500 cap. Full-community
  totals are independent of filters; monthly confirmed totals use confirmation
  date, while pending totals cover all months. Month boundaries use Asia/Kolkata.
  Current block names, one report with allocations, confirmed source details and
  invoice links, guarded confirmation, retained filters/page/scroll and retry
  states are wired. Unsupported failed/refunded states are removed from this
  offline-report UI. Authenticated tests exercise all 521 reports across 53 pages,
  literal wildcard search, date boundaries and cross-community/role denial.
  Visual, keyboard/device and unknown-outcome acceptance remain pending.
- [x] Introduce one collection/report identity across invoice allocations, one
  Cash/Bank receipt, reference, pending/confirmed separation and verified former
  receipt recording. Database tests cover replay, concurrency and carry-forward.
- [ ] Receipt correction/reassignment must reverse both account receipt and
  resident/invoice credits consistently. Current correction UI intentionally
  supports expenses and other income only; it rejects collection reversal.
- [x] Persist resident opening dues/credits without duplicating old invoice debt;
  reviewed cutover, duplicate guard and correction trail are database tested.
- [x] R04/R05 core: full server-paginated history, search/month/status filters,
  grouped report and credit records, and authorized record details with invoice
  allocations. Financial-year cash totals include all confirmed records; applied
  credits remain separate. Recent items open real details. Filters, page and
  list scroll survive detail/back navigation; detail title and focus update.
  Browser/visual acceptance remains outstanding.
- [x] R10/R11 core: real profile/details and edit screens; name and optional phone
  persist through the authorized API while email and residence stay read-only.
  Removed saved-payment/ad/support/preference placeholder actions. Language,
  actual workspace selection, installation guidance and sign-out are available.
  Save errors preserve input and receive focus; cancel checks unsaved edits.
  Home/Profile use the current block record. Browser and language review remain.
- [x] R06–R09 core: unified server-paginated announcement/poll feed, literal
  search, live/scheduled/ended and type filters, complete live unread/vote counts,
  and independently authorized details. Published/archived announcement history
  remains available; drafts are excluded. Poll results obey retention/privacy.
  Page/filter/scroll restore around detail/back; title/focus updates are wired.
  Banner endpoints remain bounded previews, separate from the full feed.
  Mark-all affects live announcements; opening scheduled/ended history records
  an individual read. Vote editing remains supported with refresh/retry states.
  Browser and accessibility acceptance remain pending.
- [x] C02/C03 photos: optional local selection/previews/removal; up to three
  JPEG/PNG/WebP inputs, 5 MiB and 20 megapixels each. The API rejects animation,
  validates/decodes and normalizes to metadata-free JPEG (1600 px / 1 MiB max),
  and stores bytes privately in the tenant database. Complaint/photos create
  atomically with payload-checked request replay. Only the owner/authorized admin
  can fetch uncached photo bytes; object URLs are revoked on view exit. Read and
  submission failures expose retries with input retained. Next/BFF/proxy limits
  support the bounded 22 MiB JSON payload. Browser/mobile picker QA remains.
- [x] C03/C07 assignment to existing authorized community admins or Unassigned.
  A scoped directory uses active membership and accepted invitations; verified
  email labels are retained on invitation acceptance. Writes revalidate access.
  Complaint replies preserve unchanged assignees, including historical revoked
  assignees, and resident responses hide admin subject IDs. Owner/checklist edits
  save atomically; stale versions and changed-payload request-key reuse fail.
  No new vendor/team/permission model is introduced. Browser acceptance remains.
- [x] Complaint category/block/priority/status/search filters run on the server,
  with complete scoped counts and stable 20-record pagination instead of a
  latest-200 cap. Both Home screens link to complaints and show authorized active
  counts (plus urgent active for admins and acceptance counts for residents).
  Filters/page and list scroll survive detail/back navigation; browser QA remains.
- [x] C06/C07 core: optional 30-item checklist, saved progress, versioned/replay-safe
  completion requiring every check and a note, and full paginated task search/
  status/overdue filters. Complaint → task → complaint and task → expense → task
  navigation is wired, with direct complaint → expense → complaint navigation too.
  Expense drafts inherit the task complaint; posted expense
  reversal/replacement preserves both source links. Completion never posts money.
  Browser/visual acceptance and global unsaved-input protection remain pending.
- [ ] Finish idempotent identities and unknown-outcome recovery for existing
  billing and other financial writes. Report creation, report confirmation,
  former receipts, account creation/posting and corrections now have protection;
  interrupted draft edits safely conflict and still need smoother recovery.
- [ ] Full unsaved-change protection, workspace/session reset of all private
  state, form errors/focus, modal focus containment and route focus/title updates.
- [ ] Restore route/query/search/filter/scroll state after details and back.
- [ ] Complete English/Telugu translations and reviewed font assets.
- [ ] PWA real-device installation/update tests, submission-aware update deferral
  beyond visible forms, session-expiry recovery and standalone launch behavior.
- [ ] Reviewed application icons for all required installed-app sizes.

## Existing screens requiring alignment and behavior audit

Existing implementation is evidence of available features, not prototype parity.
Audit each ID against source/frames and its error/loading/empty/success states:

- [ ] S01–S08: app selection, email OTP, community selection, recovery/session
  expiry, admin invitation and resident invitation. Preserve real Auth0 OTP.
- [ ] R01–R11: home, invoice/report/reported state, history/record, updates/detail,
  poll/results, profile/edit. Remove old advertising/payment-method placeholders
  and match the selected prototype's scope.
- [ ] A01–A11: setup, overview, blocks/details, draft/review flats, residents,
  invitations, move-out/replacement and former dues. Verify partial success and
  invitation-only retry; no waiver masquerading as receipt.
- [ ] A12–A18: templates/configuration, areas, one-flat mobile readings,
  exclusions/carried openings, current server preview and single publication.
- [ ] A19–A21: collection review/confirmation and overdues; integrate Cash/Bank.
- [ ] A22–A30: announcements, polls, reports, settings and More. Validate 2–10
  distinct poll options, timing, anonymity, result permissions and retention.
- [ ] C01–C07: finish missing additions above and compare actual screenshots.
- [ ] L01–L10: implement and verify all account invariants above.
- [ ] P01–P11: exercise each actual supported/unsupported/install/offline/online/
  update/session/unknown-outcome condition rather than simulated screens.

## Acceptance gates

- [ ] J01–J12 exercised end to end with separate resident/admin identities and
  at least two communities; test cross-community and cross-resident denial.
- [x] Isolated PostgreSQL initialization and template-clone integration tests
  pass through migration 028. All 36 template tables and the credit view exist, including report and
  account tables; tests create and clean up a separate database clone.
- [ ] Verify a real operator-created tenant and authenticated journey after
  deployment configuration. See `docs/fresh-install-verification.md`.
- [x] PostgreSQL tests cover complaint internal-note privacy, stale updates,
  duplicate retry, maintenance completion and expense links, grouped receipts,
  cross-community/resident denial, competing reports, draft posting, immutable
  posted records, atomic corrections, account dates and carry-forward ledgers.
- [x] PostgreSQL reconciliation tests cover matching, duplicate requests,
  stale activity, wrong account/community, opening/closing discrepancies,
  period locks, later-period reopening order and posting/finalization races.
- [x] Opening integration tests cover source reviews, replay, corrections,
  non-cash credits, duplicate debt, stale/expired reviews, closed periods,
  pre-cutover postings, unused date correction and credit/report races.
- [x] Payment-history tests cover more than one page, grouping, complete totals,
  filters, record allocations, and cross-resident/community/role denial through
  both database handlers and authenticated HTTP routes.
- [x] Signed-local-identity HTTP tests exercise admin review/post, resident home,
  offline report, admin confirmation, overview, opening-credit allocation and
  membership/role denial. These do not verify real Auth0 or browser behavior.
- [x] Complaint queue tests cover more than 200 records, all pages, combined
  filters, literal search, counts independent of filters, and resident/community
  privacy. HTTP tests verify query routing, membership and role enforcement.
- [x] Maintenance integration tests cover persisted checks, stale/concurrent/
  changed retries, completion constraints, cross-community source denial, more
  than 200 tasks, expense source propagation and corrections. HTTP tests exercise
  creation/checklists/completion, protected details and both related source reads.
- [x] Profile HTTP tests cover name/phone persistence, Telugu names, clearing a
  phone, current block identity, invalid input, immutable email/residence fields
  and role/community denial. No new SQL tables are needed for this flow.
- [x] Update HTTP tests cover all 165 records across pages, more than 100
  announcements and 50 polls, filters/counts, literal search, retained history,
  individual/read-all idempotency, draft/cross-community/role denial, independent
  poll detail, vote edits, result visibility and retention expiry.
- [x] Admin scheduled-poll cancellation preserves the planned schedule and
  records a separate immutable closure time/actor. Confirmed end actions block
  duplicate clicks. Resident retention starts at the earlier of actual closure
  and scheduled end, with no extension on retries. HTTP tests cover scheduled
  cancellation, concurrent/repeated ending, vote/close races, immutable closure/
  schedule/retention fields, expired cancellation history and role/tenant denial.
  Admin/resident details show closure separately from the scheduled times.
- [x] A23/A26 core: community timezone comes from the authorized API. Wall times
  convert independently of device timezone, rejecting missing/ambiguous clock
  changes. Forms review exact copy, schedule, banner/privacy/results policy before
  publishing. Stable request IDs make same-payload retries return one record;
  changed details conflict. Poll/options/publication metadata commit atomically.
  Publication failures retain the review; success opens an independently scoped
  detail. Ending announcements now asks for confirmation. Browser QA remains.
- [x] Publication HTTP tests cover concurrent retries, changed payload/kind,
  role/tenant denial, scoped details, storage-failure rollback and successful
  same-key retry. Scheduling tests cover India midnight boundaries and daylight
  clock changes. Migration 026 adds `communication_publications`.
- [x] A22/A25 core: complete server pagination replaces the old 200/100 caps;
  search and live/scheduled/ended filters cover all records, with an admin-only
  draft filter for announcements. Independent detail reads retain page/filter
  state and restore list scroll on back. Cached detail views expose refresh
  errors. Drafts cannot be ended into resident-visible archived history.
  HTTP tests cover all 208 announcements and 105 polls across pages, filters,
  literal search, old admin result access beyond resident retention, validation
  and resident/community denial. Browser/keyboard acceptance remains pending.
- [x] Photo tests cover real JPEG/PNG/WebP normalization, metadata removal,
  animation/pixel/byte/type/count limits, database slot/size/tenant constraints,
  concurrent retries, changed-payload conflicts, same-community resident denial,
  cross-community/admin-role denial, oversized HTTP bodies and atomic rollback.
- [ ] Receipt-correction and post-usage resident-adjustment integration tests.
- [ ] Both production builds, typechecks, lint and complete test suite.
- [ ] Screenshots compared at 320/360/390/768/1024/1440, landscape, large text,
  200% zoom, keyboard-open forms; no clipping or inaccessible actions.
- [ ] Real browser keyboard/accessibility checks and real-device PWA checks.

## Current environment and verified checkpoint

Integration project `nivasa-schema-check` uses PostgreSQL at
`127.0.0.1:55434`; migration 028 is applied to its template. Main application
databases were not changed. A separate clean-volume project
`nivasa-assignment-check` initialized the final migrations through 028 on port
55435 and contains 36 public tenant tables plus `invoice_payment_credits`.

- Complete suite: 17 files, 125 tests passed, including 32 PostgreSQL invariant
  cases and twenty-one signed-local-identity HTTP journey cases.
- Clean builds for both apps passed; emitted CSS includes complaint and resident
  history styles. Restored the resident stylesheet after finding React source in
  that file; an earlier cached build did not prove stylesheet correctness.
  Builds still emit Auth0 dependency/runtime and CSS portability warnings.
- Both app optimized production builds passed, with existing Auth0 dependency
  and missing runtime-configuration warnings. API/app typechecks and lint passed;
  `git diff --check` passed.
- Fresh initialization created 36 tables plus the credit view. SQL checks
  confirmed the final posting and billing cutover guards. The fresh-check
  container was stopped afterwards, retaining its generated volume.
- Authenticated HTTP test identities use a local signed-JWT issuer and real
  membership authorization against disposable platform/tenant databases; no real
  Auth0 account, OTP/email or existing application tenant is changed.
- Browser inventory has no connected browser. Visual comparisons, authenticated
  browser journeys and real-device PWA verification remain unperformed.

The goal is not complete. Receipt correction, the remaining
module additions, visual alignment and end-to-end acceptance remain required.
