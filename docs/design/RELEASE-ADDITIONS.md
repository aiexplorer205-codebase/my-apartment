# Proposed launch additions: complaints, accounts, maintenance

The user explicitly requested complaints, admin ledgers, and important accounts/maintenance features for release. These are **new product specifications**, not capabilities found in the current implementation. Include them in design exploration and release planning, with clear “proposed” annotations outside user-facing screens. Exact permissions, APIs, data storage, and reconciliation rules need implementation review.

## Recommended release boundary

Include resident complaint tracking, an admin maintenance queue, resident account ledgers, opening-balance onboarding, income/expense records, and cash/bank reconciliation. These close practical operational gaps: residents need a way to ask for help; administrators need to know who owes money, what has been collected, and where funds were spent.

Treat this as an apartment operations accounts module. A full general ledger, statutory/tax reporting, payroll, procurement, inventory, automatic bank feeds, and multi-level approvals are separate scopes. Do not label a simple transactions view as audited financial statements or full accounting.

## Complaints and maintenance

Recommended launch flow: resident creates a private complaint → receives a ticket ID → admin triages → marks in progress or awaiting resident → resolves with a note → resident reviews and can reopen. Status vocabulary: Open, In progress, Awaiting resident, Resolved, Closed. Closed is a terminal state; proposed policy is resident acceptance closes a resolved ticket, with no automatic closure rule assumed.

| ID | Screen | Fields/actions | Essential states |
| --- | --- | --- | --- |
| C01 | Resident requests | My complaints, status filters, New complaint | Empty, active, resolved, no match |
| C02 | New complaint | Category, subject, description, flat/shared-area location, optional photos | Validation, upload progress/error, submit, success with ticket ID |
| C03 | Resident complaint detail | Status, ticket ID, timestamps, description/photos, public conversation, resolution | Add reply, accept resolution, reopen with reason; never expose internal notes |
| C04 | Admin maintenance queue | Search, status/category/block/priority filters, open counts, unassigned tickets | No tickets, no results, overdue target only if a target policy is configured |
| C05 | Admin ticket detail | Resident/flat, issue, visible replies, internal notes, priority, assignment, status, resolution | Assignment unavailable, reply failed, stale update conflict, resolving, reopened |
| C06 | Planned maintenance tasks | Task title, common-area/asset label, due date, admin owner, notes, status | Due soon, overdue, completed; manual task creation and completion |
| C07 | Maintenance task detail | Checklist/notes, completion note, related complaint and expense links | Unsaved changes, completion confirmation, failed save |

Suggested categories: plumbing, electrical, lift, water supply, cleaning, security, common area, other. Categories are provisional. Resident-submitted urgency can be captured as descriptive context; admin sets operational priority (Normal/Urgent). Include emergency guidance using a real community contact once supplied. Do not imply emergency response or guaranteed service time.

Assignment baseline: assign to an existing authorized admin or leave unassigned. No vendor/technician login or new staff permission system is assumed. Internal notes are admin-only; resident replies are visibly distinct. Only the resident's own tickets are available in their app. Public community complaint feeds and anonymous complaints are out of scope.

Optional photos are a proposed capability requiring upload/storage work. Design upload limits as configurable placeholders until agreed, without inventing a storage provider. Reject unsupported files, allow removal before submit, and provide upload failure/retry. No offline ticket/photo queue at launch.

Add a prominent “Report an issue” action on resident Home and a Complaints destination. Recommended revised phone tabs: Home, Payments, Updates, Complaints, Profile. Put History under Payments with a clearly visible history link; this preserves all existing functionality while limiting the tab bar to five items. Desktop can expose History separately. Prototype this navigation explicitly.

## Ledgers and account records

Design separate views for **resident account ledger** and **cash/bank activity**. An invoice affects resident dues; a payment report does not count as received cash; an admin-confirmed collection does. Expenses affect cash/bank balances but do not automatically create resident invoice charges.

| ID | Screen | Required content/actions | Essential states |
| --- | --- | --- | --- |
| L01 | Accounts overview | Period, opening funds, confirmed receipts, paid expenses, closing funds, reconciliation attention | No opening balances, empty period, unresolved discrepancies; link to source entries |
| L02 | Resident ledger list | Flat/resident, opening due/credit, charges, confirmed credits, closing due/credit | Search/block/date filters; current and former resident identities |
| L03 | Resident ledger detail | Dated opening entry, invoice debits, confirmed payment credits, adjustments, running balance, source links | Pending reports shown separately, zero due, credit balance, corrected entry |
| L04 | Opening balances | Cutover date, resident dues/credits, cash/bank starting funds, source note | Review totals, duplicate cutover guard, confirm posting, correction workflow |
| L05 | Income and expense register | Date, category, payee/payer, cash/bank account, amount, status, source/reference | Filters, draft/posted, reversed, duplicate warning, no match |
| L06 | Add expense / other income | Type, date, amount, category, party, account, description/reference, optional proof | Draft, validation, save/post review, attachment error; no negative expense trick |
| L07 | Transaction detail | Amount, account, date, party, category, source proof, creator, history | Edit draft; posted corrections use reversal/new entry with reason |
| L08 | Reconciliation | Account, period, statement opening/closing, confirmed app entries, manual match/reference, discrepancy | Matched, unmatched, duplicate, incomplete, finalized; manual baseline |
| L09 | Adjustment / reversal review | Original entry, reason, debit/credit effect, revised balance preview | Confirm/cancel, permissions, stale source, failed posting |
| L10 | Monthly accounts summary | Opening + receipts − expenses = closing, collection outstanding, categories | Clearly separate cash movement from receivables; no unsupported export or tax claims |

Suggested expense categories: repairs, common electricity, water purchase, cleaning, security, lift service, administration, other. Suggested other-income categories: interest, rental/common-area income, other. Categorization needs user confirmation and should be editable only through an agreed management scope.

### Financial invariants for designs and prototypes

- Opening balances must have an explicit cutover date and documented source. Do not duplicate old invoices and an opening amount for the same debt. Preview before posting.
- A payment report pending confirmation is informational and excluded from confirmed receipt totals and ledger credits.
- Once confirmed, the collection credits the correct resident/invoice allocation exactly once. Account selection/reference capture for financial reconciliation is proposed backend work.
- One payment covering several invoices must not become multiple cash receipts. Show one payment with allocation lines, and link every ledger item to its source.
- Former resident debt remains attached to the former resident. A new occupant does not silently inherit it. Any balance transfer requires an explicit future policy.
- Use an append-only correction trail for posted records. Present reversal and replacement, with date, actor, and reason; no silent delete or overwrite.
- A resident credit is shown as a credit, not a confusing negative “amount due”. How credits apply to later bills is an unresolved product rule.
- Keep invoice charge totals, ledger balance, collected funds, and account balance separately named. Distinguish current balances from date-range activity.
- Import/export is not part of the initial implementation baseline. If designed later, preview mappings, errors, duplicates, and totals before committing; do not add a dead Import button.
- Expense proof, cash/bank account setup, opening balances, adjustments, reconciliation, and actor history require new storage/API/permission support. They are not merely UI additions.

## Additional journeys

| Journey | Connected flow | Required recovery |
| --- | --- | --- |
| J09 Complaint resolution | Resident C01 → C02 → C03 → admin C04/C05 → resolve → resident accept/reopen | Upload failure, private/internal note distinction, concurrent status change |
| J10 Collections to ledger | Resident report → pending → admin confirmation → L03 credit → L08 reconciliation | Duplicate confirmation, wrong account, stale pending amount |
| J11 Community expense | C05/C07 maintenance work → L06 expense → review/post → L05/L01/L08 | Expense save failure; task completion does not automatically mean payment |
| J12 Accounts cutover | L04 opening entries → review → post → L02/L03/L01 | Debt duplicated by an imported/old invoice, incorrect cutover, corrected entry |

## Navigation extension

Admin desktop adds Complaints & Maintenance and Accounts. Keep Billing (charges/invoices), Collections (payment verification), and Accounts (ledger/funds/expenses) distinct. On phones retain Overview, Flats, Billing, Collections, More; make Complaints & Maintenance and Accounts prominent in More, with Home shortcuts for open requests and unconfirmed payments. Avoid eleven small bottom tabs.

## Decisions that materially affect implementation

Confirm who handles tickets, whether planned maintenance tasks belong in launch, whether photos are essential, whether cash and multiple bank accounts are used, the opening-balance cutover method, the desired accounting depth, and whether residents can view full statements. Recommended resident launch exposure is own dues/payment history only; full resident ledger visibility can be added after privacy and terminology review.

These recommendations define a reviewable design baseline, not a claim that every accounting addition is mandatory for every community. Final prioritization depends on launch operations and implementation capacity.
