# Phase 6: CONTEXT.md Documentation Accuracy

**Phase:** 6 of N
**Priority:** P2 — documentation correctness; no production behavior changes
**Scope:** All D12 findings (#21, #26–#45, #131–#145, #201–#206)
**Total findings:** 32
**Estimated effort:** 2-3 developer-days
**Dimensions:** D12 (CONTEXT.md accuracy), with overlaps in D4 (build shape), D2 (event docs)

---

## Work Streams

Four parallel work streams. No shared files across streams. Each fix is a CONTEXT.md edit only (no code changes in this phase).

| Stream | Focus                                       | Findings                                                               | Files               | Complexity |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------- | ------------------- | ---------- |
| A      | Architecture layer listings — missing files | #26, #27, #28, #29, #30, #31, #32, #33, #34, #131, #132, #133          | 11 CONTEXT.md files | S each     |
| B      | Event documentation drift                   | #21, #35, #36, #37, #38, #39, #134, #201                               | 6 CONTEXT.md files  | S each     |
| C      | Use case / permission / input table drift   | #40, #41, #42, #43, #44, #45, #135, #136, #137, #202                   | 8 CONTEXT.md files  | S each     |
| D      | Glossary / Public API / misc accuracy       | #138, #139, #140, #141, #142, #143, #144, #145, #203, #204, #205, #206 | 9 CONTEXT.md files  | S each     |

---

## Stream A: Architecture Layer Listings — Missing Files

These are the simplest, most mechanical fixes. Every CONTEXT.md architecture section must list every file in the directory. Files were split but documentation was not updated.

### Fix A1: Integration CONTEXT.md — missing google-auth-url.ts and constants.ts

**Finding:** #26
**File:** `src/contexts/integration/CONTEXT.md`
**Section:** Architecture layers (server/ and application/)
**Change:**

- Add `google-auth-url.ts` to `server/` line
- Add `constants.ts` to `application/` line
- Add `event-handlers/ (empty — no consumers)` note
- Remove "handle webhook" from `google-connections.ts` description in server functions section
  **Complexity:** S

---

### Fix A2: Portal CONTEXT.md — missing 3 split server files

**Finding:** #27
**File:** `src/contexts/portal/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update line 84 from:

```
server/              portals.ts, portal-links.ts, portal-groups.ts
```

to:

```
server/              portals.ts, portal-links.ts, portal-link-categories.ts,
                     portal-groups.ts, portal-uploads.ts, portal-read.ts
```

**Complexity:** S

---

### Fix A3: Review CONTEXT.md — missing reply-draft.ts, reply-read.ts, internal-ports.ts

**Finding:** #28
**File:** `src/contexts/review/CONTEXT.md`
**Section:** Architecture layers
**Change:**

- `server/` line: update from `reply.ts, staff-recent-activity.ts` to `reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts`
- `application/` section: add `internal-ports.ts` with description "internal-only port re-exports"
  **Complexity:** S

---

### Fix A4: Inbox CONTEXT.md — missing 5 server files + build-use-cases.ts

**Finding:** #29
**File:** `src/contexts/inbox/CONTEXT.md`
**Section:** Architecture layers
**Change:**

- `server/` line: update from `inbox.ts` to `inbox.ts, inbox-shared.ts, inbox-status.ts, inbox-item-actions.ts, inbox-item-queries.ts, inbox-queries.ts`
- Add `build-use-cases.ts` at root level alongside `build.ts`
- `event-handlers/` line: add `on-reply-submitted.ts`
  **Complexity:** S

---

### Fix A5: Identity CONTEXT.md — missing many split server files

**Finding:** #30
**File:** `src/contexts/identity/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update from `organizations.ts, auth-settings.ts` to:

```
server/              organizations.ts, organizations.query.ts,
                     organizations.update.ts, organizations.members.ts,
                     organizations.invitations.ts, organizations.registration.ts,
                     organizations.upload.ts, organizations.shared.ts,
                     auth-settings.ts, auth-settings.org.ts, auth-settings.helpers.ts
```

**Complexity:** S

---

### Fix A6: Staff CONTEXT.md — missing staff-portals-update.ts

**Finding:** #31
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update from `staff-assignments.ts, staff-portals.ts` to `staff-assignments.ts, staff-portals.ts, staff-portals-update.ts`
**Complexity:** S

---

### Fix A7: Property CONTEXT.md — missing property-read.ts

**Finding:** #32
**File:** `src/contexts/property/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update from `properties.ts` to `properties.ts, property-read.ts`
**Complexity:** S

---

### Fix A8: Guest CONTEXT.md — missing guest-scans.ts

**Finding:** #33
**File:** `src/contexts/guest/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update from `public.ts` to `public.ts, guest-scans.ts`
**Complexity:** S

---

### Fix A9: Dashboard CONTEXT.md — missing application/utils.ts

**Finding:** #34
**File:** `src/contexts/dashboard/CONTEXT.md`
**Section:** Architecture layers → `application/`
**Change:** Add `utils.ts` to the `application/` listing between `dto/` and `use-cases/`
**Complexity:** S

---

### Fix A10: Property CONTEXT.md — missing application/use-cases/ directory

**Finding:** #131
**File:** `src/contexts/property/CONTEXT.md`
**Section:** Architecture layers → `application/`
**Change:** Add line:

```
use-cases/         create-property.ts, update-property.ts, get-property.ts,
                   list-properties.ts, soft-delete-property.ts
```

**Complexity:** S

---

### Fix A11: Activity CONTEXT.md — missing inbox-item-lookup.port.ts and db-inbox-item-lookup.adapter.ts

**Finding:** #132
**File:** `src/contexts/activity/CONTEXT.md`
**Section:** Architecture layers
**Change:**

- `ports/` line: add `inbox-item-lookup.port.ts`
- `infrastructure/adapters/` line: add `db-inbox-item-lookup.adapter.ts`
  **Complexity:** S

---

### Fix A12: Team CONTEXT.md — missing assignment-check.port.ts

**Finding:** #133
**File:** `src/contexts/team/CONTEXT.md`
**Section:** Architecture layers → `application/ports/`
**Change:** Update from `team.repository.ts` to `team.repository.ts, assignment-check.port.ts`
**Complexity:** S

---

### Fix A13: Goal CONTEXT.md — update server/ listing to reflect split files or remove dead code note

**Finding:** #26 (convergence round-2 cross-ref)
**File:** `src/contexts/goal/CONTEXT.md`
**Section:** Architecture layers → `server/`
**Change:** Update from `goals.ts, staff-goals.ts` to `goals.ts, staff-goals.ts` with a note that split files (`create-goal.ts`, `update-goal.ts`, `cancel-goal.ts`, `goal-queries.ts`, `goal-shared.ts`) exist but are dead code pending removal. Alternatively, remove the dead files first (tracked in Phase 3 dead-code cleanup) and leave the listing as-is.
**Complexity:** S

---

## Stream B: Event Documentation Drift

### Fix B1: Integration CONTEXT.md — wrong GbpImportJobStatus lifecycle

**Finding:** #21
**File:** `src/contexts/integration/CONTEXT.md`
**Section:** §Domain overview (lifecycle diagram)
**Change:** Replace:

```
Status: pending → processing → completed (or failed)
```

with:

```
Status: 'queued' → 'in_progress' → 'completed' | 'completed_with_skips' | 'completed_with_failures' | 'failed'
```

**Complexity:** S

---

### Fix B2: Integration CONTEXT.md — "disconnect nulls out property FKs" is false

**Finding:** #35
**File:** `src/contexts/integration/CONTEXT.md`
**Section:** §Use cases — `disconnectGoogleAccount` description
**Change:** Replace "Revoke tokens, clear caches, null out property FKs" with "Revoke tokens, clear caches, set connection status to 'disconnected'". Note that FK nulling does NOT happen on disconnect — only on delete.
**Complexity:** S

---

### Fix B3: Integration CONTEXT.md — integration.property_import.completed event defined but never emitted

**Finding:** #36
**File:** `src/contexts/integration/CONTEXT.md`
**Section:** §Events produced
**Change:** Add a note next to `integration.property_import.completed`: "(Defined in events.ts but not yet emitted — deferred, tracked in code as TODO)". If the event should be emitted, this is a code fix (tracked separately in Phase 2).
**Complexity:** S

---

### Fix B4: Review CONTEXT.md — missing review.reply.publish_failed event

**Finding:** #37
**File:** `src/contexts/review/CONTEXT.md`
**Section:** §Events produced
**Change:** Add:

```
- **review.reply.publish_failed** — replyId, reviewId, propertyId, organizationId, authorId, occurredAt. Emitted when reply publishing fails after retry.
```

**Complexity:** S

---

### Fix B5: Review CONTEXT.md — reply events missing authorId and source fields

**Finding:** #38
**File:** `src/contexts/review/CONTEXT.md`
**Section:** §Events produced (reply events)
**Change:**

- `review.reply.published`: add `authorId` (original reply author), remove `?` from `userId`
- `review.reply.submitted`: add `source`
- `review.reply.approved`: add `authorId`, `source`
- `review.reply.rejected`: add `authorId`, `source`
- Add glossary note: "`authorId` = original reply author (distinct from `userId` who performed the action). `source` = 'web' | 'import'."
  **Complexity:** S

---

### Fix B6: Review CONTEXT.md — missing ReviewReplyPublishFailed from Public API section

**Finding:** #39
**File:** `src/contexts/review/CONTEXT.md`
**Section:** §Public API
**Change:**

- Event types list: add `ReviewReplyPublishFailed`
- Event constructors list: add `reviewReplyPublishFailed`
  **Complexity:** S

---

### Fix B7: Review CONTEXT.md — userId? vs userId in review.reply.published

**Finding:** #134
**File:** `src/contexts/review/CONTEXT.md`
**Section:** §Events produced → `review.reply.published`
**Change:** The documentation says `userId?` but the type declares `userId: UserId` (required). Remove the `?` from `userId` in the event description. If userId should be optional, that's a code change (not this phase).
**Complexity:** S

---

### Fix B8: Staff CONTEXT.md — events missing envelope fields in payload column

**Finding:** #201
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** §Events produced (events table)
**Change:** Add a note: "All events include envelope fields: `eventId`, `occurredAt`, `correlationId` (may be null)." Alternatively, include `eventId` and `correlationId` in the payload column for each event.
**Complexity:** S

---

### Fix B9: Identity CONTEXT.md — events table has misaligned columns

**Finding:** #202
**File:** `src/contexts/identity/CONTEXT.md`
**Section:** §Events produced table
**Change:** The table header has 4 columns (Name, Tag, Payload, When) but rows have 3 columns where the first data column is the tag, not the name. Fix markdown table alignment — either add a "Name" column or remove the empty first column header.
**Complexity:** S

---

## Stream C: Use Case / Permission / Input Table Drift

### Fix C1: Integration CONTEXT.md — startPropertyImport permission mismatch

**Finding:** #40
**File:** `src/contexts/integration/CONTEXT.md`
**Section:** §Server functions / §Permissions
**Change:** The code checks `integration.manage` but CONTEXT.md §Permissions says `property.create`. Decide which is correct and update the documentation to match the code's actual permission check (`integration.manage`). If the code is wrong, that's a separate Phase 1 fix.
**Complexity:** S

---

### Fix C2: Staff CONTEXT.md — updateStaffPortals input column mismatch

**Finding:** #41
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** §Use cases table
**Change:** Update the Input column for `updateStaffPortals` to clarify that `organizationId` and `role` come from `AuthContext`, not request input. Add a note: "organizationId and role sourced from AuthContext."
**Complexity:** S

---

### Fix C3: Staff CONTEXT.md — Input column conflates request input with auth context

**Finding:** #42
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** §Use cases table (all rows)
**Change:** Add a footnote or column header clarifying: "organizationId and role are derived from AuthContext, not request body/query params." Rename column from "Input" to "Parameters (Input + Auth)" or split into two sub-columns.
**Complexity:** S

---

### Fix C4: Staff CONTEXT.md — updateStaffPortals misattributed to staff-portals.ts

**Finding:** #43
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** §Server functions
**Change:** Split:

```
- **staff-portals.ts** — listStaffPortals server function.
- **staff-portals-update.ts** — updateStaffPortals server function.
```

Note re-export chain: `staff-assignments.ts` re-exports `updateStaffPortals` from `staff-portals-update.ts`.
**Complexity:** S

---

### Fix C5: Identity CONTEXT.md — upload use case input/output/permission mismatch

**Finding:** #44
**File:** `src/contexts/identity/CONTEXT.md`
**Section:** §Use cases table
**Change:**

- `requestOrgLogoUpload`: change Input from `organizationId, contentType` to `contentType, fileSize`. Change Output from `{ uploadUrl, key }` to `{ uploadUrl, key }` (keep). Change Permission from `org:manage` to `identity.logo_upload`.
- `finalizeOrgLogoUpload`: change Input from `organizationId, key` to `key`. Change Output from `Organization` to `{ logoUrl }`. Change Permission from `org:manage` to `identity.logo_upload`.
- `requestAvatarUpload`: change Input from `userId, contentType` to `contentType, fileSize`. Change Output from `{ uploadUrl, key }` (keep). Change Permission from `authenticated` to `identity.avatar_upload`.
- `finalizeAvatarUpload`: change Input from `userId, key` to `key`. Change Output from `User` to `{ avatarUrl }`. Change Permission from `authenticated` to `identity.avatar_upload`.
  **Complexity:** S

---

### Fix C6: Identity CONTEXT.md — permission name inconsistency (org:manage vs granular)

**Finding:** #45
**File:** `src/contexts/identity/CONTEXT.md`
**Section:** §Server functions table + §Permissions section
**Change:** Reconcile the server functions table to use actual `can()` permission strings from code: `invitation.create`, `member.delete`, `organization.update`, `member.update`, `identity.logo_upload`, `identity.avatar_upload`. Remove higher-level aliases `org:manage` and `org:manage_members` from the server functions table.
**Complexity:** S

---

### Fix C7: Goal CONTEXT.md — use case table says orgId but code uses organizationId

**Finding:** #135
**File:** `src/contexts/goal/CONTEXT.md`
**Section:** §Use cases table (Input column)
**Change:** Replace all `orgId` references in the Input column with `organizationId` to match the actual TypeScript type names.
**Complexity:** S

---

### Fix C8: Goal CONTEXT.md — permission matrix says Staff has goal.create but server rejects Staff

**Finding:** #136
**File:** `src/contexts/goal/CONTEXT.md`
**Section:** §Permissions matrix
**Change:** Either update the permission matrix to show Staff = — for `goal.create` (matching server behavior which restricts to AccountAdmin/PropertyManager), or note the discrepancy if it should be fixed in code.
**Complexity:** S

---

### Fix C9: Inbox CONTEXT.md — CreateInboxItemInput missing sourceDate and platform

**Finding:** #137
**File:** `src/contexts/inbox/CONTEXT.md`
**Section:** §Use cases table → `createInboxItem`
**Change:** Add `sourceDate` and `platform` to the Input column.
**Complexity:** S

---

### Fix C10: Team CONTEXT.md — team.read labeled "reserved for future use" but is actively enforced

**Finding:** #203
**File:** `src/contexts/team/CONTEXT.md`
**Section:** §Permissions
**Change:** Replace "reserved for future use — currently gated at use-case level" with "actively enforced in getTeam and listTeams use cases via can(ctx.role, 'team.read')."
**Complexity:** S

---

### Fix C11: Activity CONTEXT.md — "no server functions" claim is misleading

**Finding:** #204
**File:** `src/contexts/activity/CONTEXT.md`
**Section:** §Overview (line 7)
**Change:** Rephrase "no server functions that mutate state" to "no mutating server functions" — the context has 2 GET read endpoints documented in the Server Functions section.
**Complexity:** S

---

### Fix C12: Guest CONTEXT.md — permissions listed but no permission enforcement exists

**Finding:** #205
**File:** `src/contexts/guest/CONTEXT.md`
**Section:** §Permissions
**Change:** Either remove the permission list entirely or add a note: "These are logical operation identifiers for tracing/auditing only. All guest endpoints are unauthenticated (public by design). No `can()` enforcement exists because guest context has no auth middleware."
**Complexity:** S

---

### Fix C13: Property CONTEXT.md — softDeleteProperty name vs deleteProperty export

**Finding:** #206
**File:** `src/contexts/property/CONTEXT.md`
**Section:** §Use cases
**Change:** Update `softDeleteProperty` to `deleteProperty` to match the actual exported function name. Add a note: "The use case performs a hard delete (cascades to reviews, replies, inbox items via FK), despite the file name `soft-delete-property.ts`. See ADR for hard-delete rationale."
**Complexity:** S

---

## Stream D: Glossary / Public API / Misc Accuracy

### Fix D1: Goal CONTEXT.md — event payload table says orgId but code uses organizationId

**Finding:** #138
**File:** `src/contexts/goal/CONTEXT.md`
**Section:** §Events produced → event payload table
**Change:** Replace `orgId` with `organizationId` in the `goal.progress_updated` event payload column.
**Complexity:** S

---

### Fix D2: Goal CONTEXT.md — Public API section missing StaffGoalEntry

**Finding:** #139
**File:** `src/contexts/goal/CONTEXT.md`
**Section:** §Public API → Types
**Change:** Add `StaffGoalEntry` to the Types list, or remove from `public-api.ts` if unused externally.
**Complexity:** S

---

### Fix D3: Portal CONTEXT.md — errors test claims 15 codes but errors.ts defines 19

**Finding:** #140
**File:** `src/contexts/portal/domain/errors.test.ts` (code fix, but noted here for completeness)
**Section:** N/A — this is a test fix, not a CONTEXT.md fix
**Change:** Update the test array and `toHaveLength(19)` to include the 4 missing codes: `group_not_found`, `group_name_taken`, `portal_already_grouped`, `portal_not_in_group`. Update CONTEXT.md §Errors glossary if these codes are not documented.
**Complexity:** S

---

### Fix D4: Portal CONTEXT.md — use case name softDeletePortalGroup vs deletePortalGroup

**Finding:** #141
**File:** `src/contexts/portal/CONTEXT.md`
**Section:** §Use cases → `softDeletePortalGroup`
**Change:** Note that the file is `delete-portal-group.ts` exporting `deletePortalGroup`, but the composition key is `softDeletePortalGroup`. Document both names or rename the file to match.
**Complexity:** S

---

### Fix D5: Property CONTEXT.md — invariant claims soft-delete but code does hard-delete

**Finding:** #142
**File:** `src/contexts/property/CONTEXT.md`
**Section:** §Invariants
**Change:** Replace "Properties are soft-deleted (`deletedAt`), never hard-deleted" with "Properties are hard-deleted (cascade to reviews, replies, inbox items via FK). The file is named `soft-delete-property.ts` for historical reasons."
**Complexity:** S

---

### Fix D6: Dashboard CONTEXT.md — StaffDashboardData claimed but not exported

**Finding:** #143
**File:** `src/contexts/dashboard/CONTEXT.md`
**Section:** §Public API → Types
**Change:** Either add `StaffDashboardData` to `public-api.ts` exports, or remove it from the CONTEXT.md Types list. Check if any external consumer imports it.
**Complexity:** S

---

### Fix D7: Dashboard CONTEXT.md — use-case table misaligned columns + portalIds? → portalId?

**Finding:** #144
**File:** `src/contexts/dashboard/CONTEXT.md`
**Section:** §Use cases table (rows 2-3)
**Change:**

- Fix column alignment so `getPortalAnalytics` and `getStaffDashboardData` names are in the Use case column
- Change `portalIds?` to `portalId?` to match actual `GetStaffDashboardDataInput` type
  **Complexity:** S

---

### Fix D8: Metric CONTEXT.md — review.created value is event.rating not 1

**Finding:** #145
**File:** `src/contexts/metric/CONTEXT.md`
**Section:** §Events consumed → `review.created` description
**Change:** Replace "Records a `property.review` metric (value = 1)" with "Records a `property.review` metric (value = event.rating, the star rating value)."
**Complexity:** S

---

### Fix D9: Metric CONTEXT.md — field name recordedAt vs occurredAt

**Finding:** (from metric-infra-server review)
**File:** `src/contexts/metric/CONTEXT.md`
**Section:** §Glossary → MetricReading
**Change:** Replace `recordedAt` with `occurredAt` to match the actual domain type.
**Complexity:** S

---

### Fix D10: Root CONTEXT.md — missing Notification and Activity from bounded contexts table

**Finding:** (convergence round-2 BLOCKER)
**File:** `CONTEXT.md` (root)
**Section:** §Architecture → bounded contexts table
**Change:**

- Update "Twelve bounded contexts" to "Fourteen bounded contexts"
- Add row: `|     | Notification   | User-facing in-app/email notifications | — |`
- Add row: `|     | Activity       | Immutable audit log | — |`
  **Complexity:** S

---

### Fix D11: Root CONTEXT.md — Key ADRs table omits ADRs 0008–0013

**Finding:** (from adr-compliance review)
**File:** `CONTEXT.md` (root)
**Section:** §Key ADRs table
**Change:** Add rows for ADRs 0008 through 0013:

- 0008: Cross-Context Boundaries
- 0009: Permission Model
- 0010: Activity BullMQ Delivery
- 0011: Notification BullMQ Delivery
- 0012: Nitro Dev-Mode Exclusion
- 0013: Portal Groups Replace Team/Staff Scope
  **Complexity:** S

---

### Fix D12: Guest CONTEXT.md — mentions StaffPublicApi dependency that doesn't exist

**Finding:** (from guest-domain-app review)
**File:** `src/contexts/guest/CONTEXT.md`
**Section:** §Overview / §Dependencies
**Change:** Verify `StaffPublicApi` dependency. If not consumed in `build.ts`, remove the claim that guest depends on `StaffPublicApi`. If planned, mark as "(planned, not yet implemented)".
**Complexity:** S

---

### Fix D13: Inbox CONTEXT.md — missing getInboxFolderCountsFn from server functions table

**Finding:** (from inbox-infra-server review)
**File:** `src/contexts/inbox/CONTEXT.md`
**Section:** §Server functions table
**Change:** Add `getInboxFolderCountsFn` (GET, `inbox.read`) row.
**Complexity:** S

---

### Fix D14: Staff CONTEXT.md — Ports section documents only 1 of 9 methods

**Finding:** (from staff-domain-app + staff-infra-server reviews)
**File:** `src/contexts/staff/CONTEXT.md`
**Section:** §Ports → StaffAssignmentRepository
**Change:** Either list all 9 methods (`findById`, `listByUser`, `listByProperty`, `listByTeam`, `listByUserAndProperty`, `assignmentExists`, `insert`, `softDelete`, `getAccessiblePropertyIds`) with one-line descriptions, or add: "See `application/ports/staff-assignment.repository.ts` for full interface."
**Complexity:** S

---

### Fix D15: Team CONTEXT.md — team.updated event omits propertyId in description (incorrectly listed as present)

**Finding:** (from team-domain-app review)
**File:** `src/contexts/team/CONTEXT.md`
**Section:** §Events produced
**Change:** Verify whether `team.updated` includes `propertyId` in the actual type. If yes, keep. If no, remove from description. Add envelope fields note (eventId, correlationId).
**Complexity:** S

---

## Verification

After all fixes:

1. **Spot-check:** For each CONTEXT.md, run `ls` on the actual directory and compare against the architecture layers section
2. **Grep validation:**
   ```bash
   # Verify no CONTEXT.md still references files that don't exist
   for ctx in src/contexts/*/; do
     echo "=== $(basename $ctx) ==="
     # Extract server/ files listed in CONTEXT.md vs actual files
     diff <(grep -A5 'server/' "$ctx/CONTEXT.md" | grep '\.ts' | tr -d '`' | sed 's/,/\n/g' | sed 's/^ *//' | sort -u) \
          <(ls "$ctx/server/"*.ts 2>/dev/null | xargs -n1 basename | sort -u) || true
   done
   ```
3. **Typecheck:** `tsc --noEmit` — no type changes in this phase, so this should pass trivially
4. **Manual review:** Read each modified CONTEXT.md end-to-end to catch any introduced formatting errors

---

## Dependency Notes

- Fix D3 (portal errors test) touches code, not CONTEXT.md — but is grouped here because the root cause is a documentation claim about error codes
- Fix D10 (root CONTEXT.md) and Fix D11 (ADR table) are the only changes outside `src/contexts/`
- No fix in this phase blocks or is blocked by any other phase — all are documentation-only

---

**Totals:** 32 findings, 30 fix items, ~20 CONTEXT.md files + 1 root CONTEXT.md, all S complexity.
