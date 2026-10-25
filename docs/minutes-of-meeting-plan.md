# Minutes of Meeting feature plan

Status: implemented in source, including tenant migration `035_minutes_of_meeting.sql`, API/contracts, admin editor and publication, and resident latest/history views. Application databases have not been migrated and application containers have not been rebuilt or restarted.

## Goal and scope

Administrators can record meeting notes, select the residents who attended using block/flat numbers, review the record, and publish it. Residents can read the latest published Minutes of Meeting (MoM) by default and fetch older records on demand.

The first version includes saved drafts, publication, attendee selection, a resident latest view, and paginated history. Attachments, notifications, scheduling, guest attendees, signatures, voting, action-item tracking, and editing or withdrawing published records are outside this version. Meeting notes can include decisions and actions as plain text.

## Product decisions

The implemented first version uses these defaults:

- Add **Minutes of Meeting** under Community in admin navigation and as a resident navigation entry. Keep announcements and polls in their existing flows.
- “Latest” means the most recent **meeting date/time**, ordered by `meeting_at DESC, published_at DESC, id DESC`. Publishing an older meeting later does not replace a more recent meeting in the default view.
- Every currently authorized resident in the apartment can read all published MoMs, including those from before their move-in. Attendance does not restrict readership.
- Attendees are existing resident profiles, including historical/inactive profiles when their residency dates cover the meeting date. Pending invitations and free-text guests are excluded. Membership/profile suspension continues to prevent app access; recording past attendance grants no access.
- Published records are immutable in this version. The review screen must make that clear before confirmation. If a correction is needed, publish a separately titled correction referencing the original; the original remains accessible.
- Allow zero attendees with an explicit “Attendance not recorded” confirmation. Do not label that state as “Nobody attended.”

## Admin experience

1. Open **Community → Minutes of Meeting**. Show drafts and published records with title, meeting date, attendee count, and status. Provide search, status filtering, and pagination (20 per page).
2. Choose **Add meeting minutes**. Enter a title, meeting date/time, optional location, and meeting notes. Interpret date/time in the apartment timezone, persist a UTC timestamp, and display the timezone in the form and review.
3. Select attendees through a searchable list grouped by block and flat. Show `Block A · Flat 001 · Resident name`; preserve leading zeros and distinguish identical flat numbers in different blocks. Selecting a flat expands its residents; it does not automatically mark every resident as present.
4. Select individuals with checkboxes, show selected chips and a count, and allow removal. Keep selections when searching or moving between picker pages. Support several attendees from one flat and prevent selecting the same person twice. Show a useful empty state for flats without eligible profiles.
5. Save a draft and return later, or continue to **Review minutes**. Review shows the exact title, meeting date/time, location, notes, and attendees that will be published. Clearly state that resident names and flats will be visible to all apartment residents.
6. Confirm **Publish minutes**. Commit the record, attendance snapshots, publication time, and actor together. Show success with a link to the published detail. Preserve entered content after validation errors or failed saves; protect against accidental loss when leaving an unsaved form.

Draft fields may be incomplete, but any supplied values must satisfy type and size limits. Publication requires a trimmed title (1–160 characters), meeting date/time no later than server time, trimmed notes (1–20,000 characters), optional location (up to 200 characters), and valid unique attendee identifiers or the explicit attendance-not-recorded confirmation. Repeat validation on the API; browser validation alone is insufficient.

When changing the meeting date, revalidate selected attendees. If a resident no longer matches the residency dates or their flat/profile changed since review, return a conflict and require a refreshed review. Do not silently substitute a person or flat.

## Resident experience

- Opening **Minutes of Meeting** fetches and displays the complete latest published record: title, meeting date/time, location if present, notes, publication time, and an expandable attendee list of names and block/flat labels.
- Show **Older meetings** beneath the latest record. Fetch history only when requested, in pages of 20 summaries. Selecting a summary fetches its full notes and attendance. Do not load every meeting body on entry.
- Use the same ordering for latest and history. Exclude the displayed latest record from the older list. Back navigation restores the loaded history position and selection; provide **Back to latest**.
- If a newer MoM appears during browsing, preserve the selected older record. Refreshing or returning to the default view fetches the latest again.
- Show explicit loading, retry, empty, and end-of-history states. With no published records, show “No meeting minutes published yet.” Drafts must never appear, including through a guessed detail URL.
- Residents cannot edit notes, change attendance, or publish. Do not expose resident contact details, Auth0 subjects, or internal publisher identity in these responses.

## Tenant data model

Tenant SQL migration: `035_minutes_of_meeting.sql`, after `034`. All objects belong to `block9_tenant`; no platform database tables are needed.

| Object | Fields and constraints |
| --- | --- |
| `meeting_minutes` | UUID `id`, `tenant_id`, title, `meeting_at` (`TIMESTAMPTZ`), optional location, plain-text notes, `status` (`draft`/`published`), `attendance_not_recorded`, integer `version`, created/updated timestamps and actor subjects, nullable `published_at` and `published_by` |
| `meeting_minutes_attendees` | Parent meeting UUID, resident UUID, unit UUID; resident name, block name, and flat number snapshots; unique `(meeting_id, resident_id)` |
| `communication_publications` extension | Extend the existing allowed `kind` values with `meeting_minutes` for publication and `meeting_minutes_draft` for durable draft creation; keep existing announcement/poll behavior |

Drafts retain selected resident/unit references. Resolve and validate them server-side when saving and publishing; freeze the display snapshots at publication. Never accept client-supplied names or flat labels as authoritative. A later move-out, rename, or flat change must not rewrite historical minutes. Retain references with restrictive foreign keys rather than cascade-deleting meeting history.

Validate that every selected resident belongs to a unit of the resolved tenant and that their residency start/move-out dates inclusively cover the meeting date in the apartment timezone. A resident selected for a past meeting may now be inactive; current app authorization and historical attendance are separate checks.

Add a tenant/status/meeting-date index for resident latest/history queries and an admin listing index. Enforce published field completeness, consistent publication metadata, and unique attendance in the database where possible. Publication must lock/check the draft version and prohibit subsequent content or attendee mutation.

Review property setup deletion dependencies for the new unit/resident references. Reviews and confirmation must report linked attendance as a blocker and preserve history. Verify this explicitly rather than assuming the existing foreign-key discovery handles the new tables.

## API contract

These paths are implemented. Use the existing authenticated web proxy and server-derived `TenantContext`.

| Method and path | Purpose |
| --- | --- |
| `GET /v1/admin/meeting-minutes?page=1&status=All&search=...` | Admin list; `All`, `draft`, or `published`; literal search up to 160 characters; response `{items,total,page,pageSize}` |
| `GET /v1/admin/meeting-minutes/attendees?meetingAt=...&search=...&page=1` | Paginated eligible people searched by name/block/flat; return only person/unit identifiers and display labels needed by the picker |
| `POST /v1/admin/meeting-minutes` | Create draft with a UUID request key so retries cannot duplicate it |
| `GET /v1/admin/meeting-minutes/{id}` | Admin draft or published detail, including version |
| `PATCH /v1/admin/meeting-minutes/{id}` | Replace draft fields/attendance with an expected version; stale or published records conflict |
| `POST /v1/admin/meeting-minutes/{id}/publish` | Publish reviewed draft using expected version, UUID request key, and review fingerprint |
| `GET /v1/tenant/meeting-minutes/latest` | Latest published detail or `{item:null}` when none exists |
| `GET /v1/tenant/meeting-minutes?cursor=...&excludeId=...` | Published history summaries; fixed page size 20; return `{items,nextCursor}`; exclude the currently displayed latest UUID |
| `GET /v1/tenant/meeting-minutes/{id}` | Published detail independent of list paging |

Register static `latest` and `attendees` routes before UUID detail matching. History cursors encode the last `(meeting_at,published_at,id)` tuple; validate their structure and use bound parameters. Apply tenant/status predicates on every page and validate `excludeId` as a UUID; it is only a display filter, never authorization.

Use the existing communication publication pattern for publication idempotency: the same actor/key and canonical payload returns the original result; a reused key with different details conflicts. The payload must include meeting ID, expected version, and review fingerprint. Check prior success before rejecting a retry because the draft is already published. Draft creation uses the same durable request-key table with the distinct `meeting_minutes_draft` kind, committed with creation, preserving cross-kind conflict checks.

The review fingerprint covers the draft version/content and resolved attendance labels so changed roster information cannot silently publish. Draft updates use an atomic version check/increment. Publish locks the draft and relevant roster rows while validating and writing snapshots in one transaction. Concurrent updates/publications must produce one published record or a clear conflict, never partial attendance.

Reject malformed fields, UUIDs, pages, and cursors with `400`; reject unauthorized roles/inactive resident access with `403`; return `404` for cross-tenant, unknown, or resident-inaccessible draft IDs; use `409` for stale reviews, stale versions, conflicting request keys, or mutation of a published record. Apply existing tenant membership and suspension guards first.

## Security and privacy

- Resolve tenant from validated Auth0 subject and platform membership. Never accept a tenant selector as authorization, including on attendee lookup and history endpoints.
- Require admin role on every admin route and an authorized active resident profile on every resident route. Selecting someone as an attendee grants no app access.
- Use parameterized SQL on the bound tenant connection. Roster joins and meeting-detail lookups must enforce tenant ownership.
- Store/render notes as plain text with preserved line breaks. Do not introduce raw HTML rendering. Apply request body and field limits; cap the attendee array at 10,000 people and the route body at 1 MiB.
- Resident DTOs expose only publication content and attendee display names/block/flat labels; omit resident/unit IDs unless needed for an authorized operation, contact details, and actor subjects. Do not log meeting bodies or attendee rosters.
- Return authenticated content with private/no-store caching and retain the existing network-only resident service worker behavior. Clear feature state on logout or workspace change.

## Implementation reference

1. **Schema and persistence:** add the tenant migration, indexes, constraints, request-key tracking, and publication-kind extension. Implement tenant-scoped draft, attendance, and publication operations in a focused API module following adjacent modules. Cover setup deletion blockers.
2. **API and contracts:** wire routes in `apps/api/src/index.ts`; update runtime OpenAPI, `packages/contracts`, and API-client types/helpers where used. Add role, validation, version, fingerprint, and idempotency checks.
3. **Admin UI:** add `apps/admin-web/src/features/communications/meeting-minutes.tsx` and wire it from the dashboard navigation. Reuse existing form, breadcrumb, load/error, and publication-review patterns where appropriate; keep feature logic out of the dashboard component.
4. **Resident UI:** add `apps/resident-web/src/features/meeting-minutes/` and wire navigation in `resident-home.tsx`. Implement latest detail, lazy history, direct detail loading, and return-position preservation.
5. **Copy and accessibility:** add matching English/Telugu keys in `packages/app-platform/locales/{en,te}/`. Use labeled fields and checkboxes, keyboard-operable attendee selection, announced errors/success, and focus restoration between form, review, and detail views.
6. **Verification and documentation:** complete the checks below; only then describe MoM as shipped in architecture docs. Update migration instructions and initialization/provisioning paths consistently so new templates and existing tenants receive the migration once.

## Acceptance and verification

- Admin saves an incomplete draft, resumes it, records notes and multiple people from one flat, reviews, and publishes. A draft never appears in resident list/latest/detail responses.
- Flat labels retain leading zeros and block identity; duplicate selection is rejected. Historical attendance eligibility and meeting-date changes are validated, including residency date boundaries.
- A publish retry after a lost response returns the original record. Different payload/key reuse, stale drafts, roster changes after review, and concurrent update/publish attempts produce the specified conflicts without partial writes.
- A resident opens the section and sees only the latest meeting by meeting date. A backdated publication does not displace it. Equal meeting/publication timestamps have deterministic ordering.
- Older summaries load on demand across more than 20 records, with no duplicate latest record, stable cursor traversal, full detail access, and preserved return position. New publications do not reset an open historical detail.
- Empty, failed, and expired-session states are recoverable. Published names/flat labels remain unchanged after resident lifecycle or property label changes. Linked attendance blocks unsafe setup deletion.
- Test admin/resident role boundaries, inactive/suspended access, ambiguous membership, cross-tenant meeting and attendee UUIDs, guessed draft IDs, malformed cursors, plain-text script-like input, and absence of private fields in resident responses.

During implementation, add focused unit/HTTP tests and Postgres integration coverage for publication transactions, ordering/pagination, tenant isolation, and deletion dependencies. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm platform:validate` as applicable; Postgres specs require `MYAPARTMENT_DATABASE_TESTS=1` and the documented database test environment.

Implementation validation: typechecking, lint, local pnpm builds, locale/config validation, and the 12 focused MoM unit/Postgres/HTTP tests passed. Database tests apply migrations to disposable databases; the HTTP test uses local signed JWTs and a test JWKS endpoint, not a live Auth0 integration. The full non-database suite has two pre-existing `navigation.overview` translation expectation failures (English/Telugu expect Overview while the product copy is Dashboard). Older Postgres fixtures depend on a populated tenant template; the new MoM suites create their own fresh databases and apply the SQL files in order.

No Docker images were built. An isolated PostgreSQL test service was used; application databases remain unchanged. Before enabling this feature locally, apply `035_minutes_of_meeting.sql` once to the template and existing tenants using the migration runner (apply earlier missing migrations first), then rebuild/restart the API and web services when ready. See [local-setup.md](./local-setup.md).
