# Copy-ready prompts for ChatGPT Product Design

Use the Product Design plugin in its supported Work environment. Attach PRODUCT-AND-SCREEN-BRIEF.md, RELEASE-ADDITIONS.md and RESPONSIVE-PWA-REQUIREMENTS.md to the same conversation. The prompts below request design work, not modification of the current application. Do not paste source code containing secrets or real resident data.

## Master prompt: explore before designing all screens

```text
Use Product Design to explore and design two related responsive progressive web apps for an Indian apartment community product: Resident and Apartment Admin.

Read all three attached specifications before proposing screens:
1. PRODUCT-AND-SCREEN-BRIEF.md: current implementation, screen IDs and business rules.
2. RELEASE-ADDITIONS.md: requested new complaints, ledgers, accounts and maintenance features.
3. RESPONSIVE-PWA-REQUIREMENTS.md: adaptive layouts, installation, connection states, accessibility and localization.

The existing configured name is MyApartment by Block5. Final branding will come later. Please suggest the visual identity; do not lock yourself to existing colors. Keep logo, name, accent colors and typography replaceable through tokens.

Audience: residents with mixed digital confidence, primarily on Android/iPhone, and apartment administrators doing operational and financial work on both phones and desktops. Initial release is a browser/home-screen PWA; a later native app should retain familiar navigation and component patterns. English and Telugu are provisional launch languages.

Scope: preserve every implemented feature in the product brief. Add private complaint management, admin resident ledgers, opening balances, income/expenses, manual cash/bank reconciliation, and a practical maintenance queue as proposed release modules. Distinguish existing functionality from new requirements in handoff annotations. Do not invent online checkout, full accounting/statutory compliance, visitor management, amenity booking, automatic notifications, or offline financial writes.

First, summarize the product, main jobs and scope assumptions briefly. Ask only questions that block a faithful design; use the attached defaults for other decisions. Then generate exactly THREE distinct visual directions using the same representative scenarios: resident Home on a phone, admin Overview on desktop, and a complaint detail or resident ledger view. Make the directions meaningfully different in typography, composition, density, color and interaction emphasis. Explain their practical tradeoffs briefly. Show visual options and wait for me to select a direction before building a full prototype.

After selection, build one shared design system and connected responsive designs in batches. Keep the provided screen IDs on frames and preserve a coverage checklist. Each batch must include success plus important empty, loading, error and recovery states. Use 390px phone, 768px tablet and 1440px desktop reference widths, with reflow checks at 320/360px. Do not just shrink desktop tables onto phones.

Financial rules are critical: a reported offline payment is pending until admin confirmation; it does not transfer money. Pending reports are excluded from confirmed collections and ledger credits. Clearly separate invoice charges, outstanding balance, pending reports and available amount. The same example record must agree in both apps. Ledger corrections need traceable reversal/replacement, not silent edits.

Privacy rules are critical: residents see only their own complaints/accounts. Internal complaint notes are admin-only. Anonymous polls show totals without identities. Named polls explicitly disclose who can see choices. Workspace changes must replace all prior community context.

PWA requirements: optional platform-aware Add to Home Screen guidance, distinguishable Resident/Admin icons, browser and standalone layouts, offline/reconnect shell, session expiry, unknown submission outcome and update states. Do not claim offline data or push delivery exists. Design iOS installation instructions separately from eligible browser install prompts.

Deliver reusable components/tokens, a screen map, connected journeys for both apps, responsive transformation notes, realistic consistent fictional data, clear microcopy, English/Telugu stress examples and an implementation handoff. Start with the three visual directions only.
```

## After choosing a direction

```text
Proceed with visual direction [chosen name]. Preserve its visual system throughout all batches. First define semantic tokens, reusable components and navigation. Use Home / Payments / Updates / Complaints / Profile as the resident phone tabs, with clearly visible History under Payments. Admin phone navigation is Overview / Flats / Billing / Collections / More; More exposes Accounts, Complaints & Maintenance, and all other existing destinations. Desktop may expose more destinations directly.

Before rendering each batch, state the included screen IDs and any proposed behavior. After rendering it, update the coverage checklist and identify missing states. Use the attached specifications as the source of truth. Keep future-only features out of launch screens. Do not ask me to reapprove details already chosen.
```

## Batch 1: entry and resident essentials

```text
Design S01–S08 and R01–R05, R10–R11. Connect invitation → OTP → acceptance → workspace → home → invoice/report → pending history → profile edit. Include wrong account, expired invitation, future start date, missing membership, session expiry and uncertain submission outcome.

Use the canonical ₹3,000 October example across resident/admin designs. Label the financial action Report offline payment. The current UI submits the calculated amount; do not add arbitrary amount entry, proof upload or payment references to this existing workflow without a separate proposed-change annotation. Older invoice itemization and downloadable receipts are unavailable.

Show all phone screens, representative desktop counterparts and tablet layout rules. Include partial-pending and all-paid states and a mobile keyboard/fixed-action example.
```

## Batch 2: admin setup and occupancy

```text
Design A01–A11 and A30. Connect first admin access → first block details → add/edit draft flats → review and create → flat list → invite resident → invitation status. Then demonstrate move-out and replacement, including former-resident dues settlement.

Include block/flat allowance limits, duplicate flat number, vacant/occupied/scheduled states, resend/revoke, start date after move-out and pending-payment conflicts. Show recovery when move-out succeeds but invitation fails. Keep created-flat edit/delete unavailable. Use full-screen task forms on phones and appropriate review panels/dialogs on desktop.
```

## Batch 3: billing and collections

```text
Design A12–A21, A28–A29 and J03/J04. Include all three billing templates, conditional field sets, one-time flat areas, metered readings, extra charges/reasons, exclusions, monthly preview, exceptions, stale preview recovery, publish success, runs/invoices, collection filters and confirmation, and latest-invoice overdue review.

Publish success must state residents were not notified. No automatic late fee, reminder campaign, report export, online checkout or unsupported invoice edit/void. Demonstrate payment pending in the resident view, admin confirmation and the refreshed resident balance. Design dense desktop entry and fully usable phone entry, including error correction and totals review.
```

## Batch 4: communication and polls

```text
Design R06–R09 and A22–A27. Connect creating/scheduling an announcement to resident banner/read detail, and creating a poll to resident vote/edit/results and admin totals/responses. Include early-end confirmation, 2–10 unique options, anonymous versus named disclosures, hidden/live results, legacy vote locked, deadline crossed while submitting, 7/30/90-day result retention and retained admin history.

For named polls, explain before submission that individual choices may be visible to other residents when results are visible. Never show individual responses for an anonymous poll. Include a Telugu layout stress sample.
```

## Batch 5: complaints and maintenance

```text
Design C01–C07 and J09/J11 as new release modules. Connect resident complaint create → optional photos → ticket detail → admin queue/triage → reply → resolve → resident accepts or reopens. Show public replies versus internal notes clearly. Include priority, existing-admin assignment, shared-area location, planned maintenance due date and task completion.

Include upload failure, private access, no tickets, no match, stale status and failed reply. Keep vendor/technician apps, guaranteed SLAs and offline uploads out of scope. A task completed is not an expense paid; link to the separate expense workflow without automatically recording money.
```

## Batch 6: ledgers and accounts

```text
Design L01–L10 and J10–J12 as new release modules. Show resident running-balance ledgers, explicit opening-balance cutover/review, income/expense register and entry, supporting proof, source transaction detail, traceable correction/reversal, manual cash/bank reconciliation and monthly funds summary.

Use a consistent example: opening cash/bank funds ₹50,000 + confirmed collections ₹3,000 − paid repair expense ₹1,200 = closing funds ₹51,800. A pending resident payment report must not enter the receipts total. The resident invoice ₹3,000 and its confirmed collection must appear once each in the resident ledger; a multi-invoice allocation must not duplicate a cash receipt.

Separate resident dues from cash/bank funds. Show former-resident debt separately from a new occupant. Demonstrate draft versus posted, missing cutover data, unmatched entries, discrepancies, negative/credit balance wording and correction history. Do not present this as full accounting software or add unsupported tax/statutory reports. Provide phone transaction cards and desktop register/reconciliation views.
```

## Batch 7: PWA and final coverage

```text
Design P01–P11 for both apps in browser and installed modes. Cover eligible Android/desktop install, iOS home-screen instructions, already-installed/unavailable states, offline launch, lost connection, reconnect, update available, expired session, and unknown save result. Installation is optional; financial mutations require connectivity and verification.

Audit every supplied screen ID and journey for coverage. Produce a table of screen/frame, phone/tablet/desktop coverage, implemented versus proposed, states covered and gaps. Verify keyboard/focus, contrast, large text, Telugu overflow, safe areas and keyboard interaction. Return a linked screen map, prototype navigation, token/component reference and concise implementation handoff. Clearly identify any interactions that are simulated and anything still undecided.
```
