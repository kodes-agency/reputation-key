# Fix Plan — MAJOR Findings (Second Review Pass)

**Source:** `docs/review-run/2026-06-21-second-pass-consolidated-report.md`
**Scope:** ~33 MAJOR findings across 6 phases
**Branch strategy:** One branch per phase, stack or merge independently
**Rule:** Fix at the source. Migrate every caller. No shims.

---

## Phase 1 — PM/Staff Property-Access Scoping (10 findings)

**Root cause:** The B1 fix from the first review added `isPropertyAccessible` to portal/review/goal MUTATIONS only. Read paths, team/staff contexts, dashboard, and inbox counts remain unscoped.

**Shared helper:** `src/shared/domain/property-access.ts` — `isPropertyAccessible(staffApi, ctx, propertyId)`. AccountAdmin bypasses (returns null = all-accessible). PM/Staff scoped via `getAccessiblePropertyIds`.

### 1.1 Team mutations (team-01, downgraded B→M)

- **Files:** `src/contexts/team/application/use-cases/create-team.ts`, `update-team.ts`, `soft-delete-team.ts`
- **Change:** Add `StaffPublicApi` to deps. After `can()` check, call `isPropertyAccessible(deps.staffApi, ctx, input.propertyId)` (create) or `isPropertyAccessible(deps.staffApi, ctx, existing.propertyId)` (update/delete). Wire `staffApi` in `build.ts`.
- **Test:** Add cross-property rejection test (PM assigned to property A tries to create team in property B → 403).

### 1.2 Staff self-assignment property scoping (D6-001)

- **File:** `src/contexts/staff/application/use-cases/create-staff-assignment.ts:35`
- **Change:** After `can(ctx.role, 'staff_assignment.create')`, call `isPropertyAccessible(deps.staffApi, ctx, input.propertyId)`. Same for `update-staff-portals.ts:40`.
- **Also fix:** STAFF-01 self-assignment inconsistency — `createStaffAssignment` bypasses guard for PM, `updateStaffPortals` enforces. Unify: always enforce for PM, skip for AccountAdmin only.

### 1.3 Dashboard server fn IDOR (DASH-02)

- **Files:** `src/contexts/dashboard/server/dashboard.ts:37-42`, `attention-signals.ts:44-49`, `portal-analytics.ts:42-47`
- **Change:** After `can(ctx.role, 'dashboard.read')`, if `ctx.role !== 'AccountAdmin'` and `data.propertyId` is provided, verify assignment via `staffApi.getAccessiblePropertyIds(ctx)` contains `data.propertyId`.
- **Acceptance:** Staff/PM passing an unassigned propertyId via RPC gets 403.

### 1.4 Property read path (PROPERTY-001)

- **File:** `src/contexts/property/application/use-cases/get-property.ts`
- **Change:** After `can(input.role, 'property.read')`, call `isPropertyAccessible(...)`. Contrast with `update-property.ts` which already does this.

### 1.5 Goal read path (GOAL-05)

- **Files:** `src/contexts/goal/application/use-cases/get-goal.ts:44`, `list-goals.ts:49`
- **Change:** After `can(input.role, 'goal.read')`, call `isPropertyAccessible(...)` for each property context.

### 1.6 Portal read paths (PORTAL-05)

- **Files:** `src/contexts/portal/application/use-cases/list-portals.ts:19`, `get-portal.ts:20`, `list-portal-links.ts:22`, `list-portal-groups.ts:16`, `get-portal-group.ts:16`, `get-portal-qr-url.ts:19`
- **Change:** For non-AccountAdmin roles, filter by accessible property IDs. Can use `assertPropertyAccess` for single-property reads.

### 1.7 Inbox count queries (INBOX-01)

- **Files:** `src/contexts/inbox/application/use-cases/get-folder-counts.ts:37`, `get-new-count.ts:45`
- **Change:** Port `countByStatus` to accept optional `propertyIds: PropertyId[]`. For roles without `inbox.manage`, resolve `getAccessiblePropertyIds` and pass the list. The schema already has `inbox_items_org_property_status_idx` for this query.
- **Also fix:** INBOX-04 — `assign-inbox-item.ts:60` should validate the ASSIGNEE's property access (not just the caller's).

### 1.8 Identity self-service mutations (D6-002/003/004)

- **File:** `src/contexts/identity/server/auth-settings.ts:14,59,93`
- **Change:** Add `can()` gates. Options: (a) add self-service permission strings (`identity.password.change`, `identity.profile.update`, `identity.avatar.set`) to permissions.ts, grant to all 3 roles; or (b) document self-service mutations as exempt from ADR 0001 in the ADR itself. Option (b) is lower-risk and arguably correct (session-scoped, no cross-user effect). Recommend: document the exemption + add a comment at each site citing the exemption.

### 1.9 Inbox on-review-expired missing event (INBOX-03)

- **File:** `src/contexts/inbox/infrastructure/event-handlers/on-review-expired.ts:36-42`
- **Change:** After `repo.updateStatus(...)`, emit `inboxItemStatusChanged(...)` — symmetric with `on-reply-published.ts:51-82`.

### 1.10 Acceptance

- `pnpm typecheck` clean
- New tests: cross-property rejection for each newly-scoped path
- `pnpm test` — all green

---

## Phase 2 — Event System (3 systemic + 2 individual findings)

### 2.1 eventId auto-generation in constructors (D2-F1 systemic, ~12 contexts)

- **Files:** Event constructors in: `review/domain/events.ts`, `integration/domain/events.ts`, `staff/domain/events.ts`, `guest/domain/events.ts`, `inbox/domain/events.ts`, `identity/domain/events.ts`, `team/domain/events.ts`, `activity/domain/events.ts` (if any)
- **Change:** In each constructor, change `Omit<Type, '_tag' | 'correlationId'>` to `Omit<Type, '_tag' | 'eventId' | 'correlationId'>` and add `eventId: crypto.randomUUID()` inside the constructor body. Remove `eventId: crypto.randomUUID()` from all call sites.
- **Pattern:** Already done correctly in badge, goal, portal, leaderboard, metric — copy their shape.
- **Verification:** grep for `eventId: crypto.randomUUID()` in use-case files → should be 0 after fix (all in constructors).
- **Acceptance:** typecheck clean; all event tests updated (remove `eventId` from constructor call args).

### 2.2 review.reply.published not emitted on import path (R2-001)

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts:242-263`
- **Change:** After `mirrorReply` creates a NEW published reply (the `if (!existing)` branch), emit `reviewReplyPublished({ source: 'import', authorId: null, ... })`. This mirrors the web path's `markReplyPublished` at `reply-operations.ts:426-437`.
- **Impact:** Fixes inbox auto-transition to "addressed" for Google-mirrored replies. Fixes activity audit log gap.
- **Test:** Add test asserting `reviewReplyPublished` fires when `mirrorReply` creates a new published reply.

### 2.3 property_import.completed never emitted (INT-01)

- **File:** `src/contexts/integration/application/use-cases/import-property.ts:186-221`
- **Change:** After `deps.importRepo.updateStatus(orgId, jobId, finalStatus)` when status is terminal (`completed` / `completed_with_skips` / `completed_with_failures` / `failed`), emit `integrationPropertyImportCompleted({...})`.
- **Also:** Fix CONTEXT.md:93 which contradicts CONTEXT.md:40 (one says "emitted", other says "deferred").

### 2.4 Events with zero subscribers — triage (team-03, STAFF-02, INT-02, ID-001, PORTAL-02, GOAL-04, LB-03)

- **Decision required per event:** (a) add a handler (e.g., activity audit subscription for team/staff/identity events), or (b) prune the event (remove constructor + emit sites + CONTEXT.md entry).
- **Recommendation:**
  - team/staff/identity events → add activity audit subscriptions (they're user-management mutations that SHOULD be audited)
  - integration connected/disconnected/visibility_changed → add activity audit subscriptions
  - portal.\* CRUD events → add activity audit subscriptions OR prune (low value)
  - goal.progress_updated → prune (notification CONTEXT.md explicitly decided not to subscribe — it's deliberate dead traffic)
  - leaderboard.snapshot.refreshed → prune (admitted dead in CONTEXT.md)
- **Acceptance:** Every emitted event has ≥1 subscriber OR is explicitly documented as "fire-and-forget" with rationale.

---

## Phase 3 — Data Integrity & Coherence (8 findings)

### 3.1 Duplicate feedback returns 500 (GUEST-01)

- **File:** `src/contexts/guest/application/use-cases/submit-feedback.ts:54`
- **Change:** Option A: add pre-check (like `hasRated` in `submit-rating.ts:30`). Option B: catch 23505 in the repo and throw `guestError('duplicate_feedback', ...)`. Add `duplicate_feedback` to `GuestErrorCode`. Recommend Option B (pre-check has TOCTOU, see GUEST-03).
- **Also fix:** GUEST-03 (concurrent rating race) — same fix: catch 23505 in `insertRating` / `insertFeedback` and throw domain error.

### 3.2 Recurring goal creation non-atomic (GOAL-02)

- **File:** `src/contexts/goal/application/use-cases/create-goal.ts:180-248`
- **Change:** Wrap template insert + instance `createGoalAndProgress` in a single `db.transaction`. Either: (a) add a port method `createRecurringGoalWithInstance(template, instance, progress)` that does all 3 inserts in one tx, or (b) expose transaction at the use-case level.
- **Also fix:** GOAL-03 (recurring cancellation non-atomic) — wrap `cancelByParent + update` in one tx.
- **Also fix:** GOAL-06 (spawn-recurring TOCTOU) — add DB partial unique index `CREATE UNIQUE INDEX goals_parent_period_uniq ON goals (parent_goal_id, period_start) WHERE parent_goal_id IS NOT NULL`.

### 3.3 Activity idempotency TOCTOU (ACT-006)

- **File:** `src/shared/db/schema/activity.schema.ts:18`
- **Change:** Add unique constraint: `unique('activity_log_event_id_org_uniq').on(t.eventId, t.organizationId)`. In the repo insert, catch 23505 and treat as successful idempotent no-op (return existing or skip).
- **Migration:** `scripts/migrations/add-activity-event-id-unique.sql`

### 3.4 Portal link/category update silently drops fields (PORTAL-01)

- **File:** `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts:88-100,130-144`
- **Change:** Change `setValues: Record<string, unknown>` to `Partial<typeof portalLinks.$inferInsert>`. Fix snake_case keys: `sort_key` → `sortKey`, `updated_at` → `updatedAt`, `icon_key` → `iconKey`.
- **Test:** Add test exercising `iconKey` and `updatedAt` on update.

### 3.5 Badge staff query broken for grouped portals (BADGE-01)

- **File:** `src/contexts/badge/infrastructure/repositories/badge.repository.ts:338-345`
- **Change:** Change `and(...conditions)` where conditions includes both portalIds IN and groupIds IN — to `and(org, property, or(inArray(portalId, portalIds), inArray(portalGroupId, groupIds)))`. The portal and group filters should be OR'd (a badge is EITHER portal-scoped OR group-scoped), not AND'd.

### 3.6 Goal template receives spurious progress (GOAL-01)

- **File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:72`
- **Change:** Add guard at top of loop: `if (goal.goalType === 'recurring' && goal.parentGoalId === null) continue` (skip templates). OR add filter to `findActiveGoalsByMetric`: `and(sql\`${goals.parentGoalId} IS NOT NULL\`)` for recurring goals.
- **Also:** Clean up any spurious `goal_progress` rows for templates in dev DB.

### 3.7 Portal cross-property authz gap (PORTAL-03)

- **File:** `src/contexts/portal/application/use-cases/add-portal-to-group.ts:35-50`
- **Change:** After loading the group and verifying group property access, load the portal via `portalRepo.findById` and verify `portal.propertyId === group.propertyId`. Same for `create-portal-group.ts:88-114` initial-portals list.

### 3.8 Metric duplicated keys (METRIC-01)

- **File:** `src/contexts/metric/domain/constructors.ts`
- **Change:** Replace hardcoded `VALID_METRIC_KEYS` with import from `src/shared/domain/metric-keys.ts` `METRIC_KEYS`. Fix error code from `invalid_metric_key` to `unknown_metric_key` (matching documented invariant).

---

## Phase 4 — Permission & Authz Gaps (4 findings)

### 4.1 Integration permission mismatch (INT-05)

- **Files:** `src/contexts/integration/server/gbp-import.ts:27,97`; `src/contexts/integration/application/use-cases/list-gbp-locations.ts:38`, `get-import-status.ts:21`
- **Change:** Align both layers on the SAME permission. Recommended: use `integration.manage` in both server fn AND use case (the import flow is integration-management, not property creation).
- **Also:** Fix CONTEXT.md:112 inaccuracy.

### 4.2 Activity PM data exposure (ACT-004)

- **Files:** `src/contexts/activity/queries/get-org-activity.ts:51` vs `get-activity-timeline.ts:38`
- **Change:** Align both to use `organization.update` (AccountAdmin-only for org-wide view), matching the F120 comment. OR change both to `inbox.manage`. Pick one, update CONTEXT.md.
- **Recommended:** Use `organization.update` (AccountAdmin-only org-wide; PM/Staff scoped to accessible properties).

### 4.3 Notification permission coupling (NOT-003)

- **Files:** `src/contexts/notification/server/notifications.ts:112,150,182,271`
- **Change:** Add `notification.read` and `notification.update` to `permissions.ts` statement, grant to all 3 roles. Replace `inbox.read` calls in notification server fns with `notification.read`/`notification.update`.

### 4.4 Notification badge audience excludes Staff (NOT-002)

- **File:** `src/contexts/notification/infrastructure/adapters/` — `findAssignedManagers`
- **Change:** Root CONTEXT.md says "property managers AND staff". Either: (a) include `member` role in the query (matching doc), or (b) update CONTEXT.md to say "managers only" (matching code). Recommend (a) — Staff should receive badge notifications.

---

## Phase 5 — Domain Purity & Type Safety (5 findings)

### 5.1 neverthrow barrel imports (D11-001..004)

- **Files:** `src/contexts/dashboard/domain/types.ts:4`, `src/contexts/goal/domain/constructors.ts:20`, `src/contexts/goal/domain/progress-strategy.ts:9`, `src/contexts/portal/domain/constructors.ts:6`
- **Change:** Replace `import { Result, ok, err } from 'neverthrow'` with `import { Result, ok, err } from '#/shared/domain/result'` (or wherever the barrel re-exports them). Verify the barrel exists and re-exports these.

### 5.2 Portal domain events purity (PORTAL-04)

- **File:** `src/contexts/portal/domain/events.ts:5`
- **Change:** Replace `import assert from 'node:assert/strict'` with a pure assertion utility (e.g., `#/shared/domain/assert`). The `crypto.randomUUID()` is acceptable (Web Crypto global). This is a codebase-wide pattern (badge/goal/leaderboard/portal all use node:assert) — fix all at once.
- **Note:** This is borderline MAJOR/MINOR — neverthrow is pure, node:assert is Node-only. The fix is mechanical.

### 5.3 Team updateTeam branded cast (team-02)

- **File:** `src/contexts/team/application/use-cases/update-team.ts:66-69`
- **Change:** Replace `(input.teamLeadId as Team['teamLeadId'])` with `toUserId(input.teamLeadId)` (matching create-team.ts:58 pattern).

### 5.4 Team updateTeam discards trimmed name (team-04)

- **File:** `src/contexts/team/application/use-cases/update-team.ts:40-78`
- **Change:** Inside the `if (input.name && input.name !== existing.name)` block, assign `newName = nameResult.value` (the trimmed result from `validateTeamName`).

### 5.5 Team softDelete uses new Date() not clock (team-07)

- **File:** `src/contexts/team/infrastructure/repositories/team.repository.ts:90-98`
- **Change:** Add `clock: Clock` param to the repo factory. Use `clock()` instead of `new Date()` in `softDelete`. Wire in `build.ts`.

---

## Phase 6 — Doc/ADR Accuracy (3 findings)

### 6.1 Activity ADR 0010 + CONTEXT.md stale (ACT-001, ACT-002)

- **Files:** `docs/adr/0010-activity-bullmq-delivery.md:23,20`; `src/contexts/activity/CONTEXT.md:32`
- **Change:** Update ADR 0010 §Decision to describe `(eventId, organizationId)` idempotency (not payload-hash). Update ADR 0010 to either document shared-`default`-queue decision OR create the dedicated `activity-log` queue. Update CONTEXT.md §Invariants to match.

### 6.2 Dashboard SQL now() (DASH-01)

- **File:** `src/contexts/dashboard/infrastructure/adapters/attention-signals.adapter.ts:96,99`
- **Change:** Replace `now()` SQL function with a bound parameter from `clock()`. Pass `clock()` value as SQL parameter: `sql\`${goals.periodEnd} > ${clockValue}\``.

### 6.3 Identity events header comment stale (ID-012)

- **File:** `src/contexts/identity/domain/events.ts:4-8`
- **Change:** Remove or update the "NOTE: not currently emitted" comment (all 6 events ARE emitted).

### 6.4 Identity propertyIds not carried on accept event (ID-004)

- **Files:** `src/contexts/identity/domain/events.ts:63-71`, `src/contexts/identity/application/use-cases/accept-invitation.ts:50-58`, `src/contexts/identity/application/ports/identity.port.ts:21-30`
- **Change:** Add `propertyIds: PropertyId[]` to `IdentityInvitationAccepted` event type + constructor. Map propertyIds in the adapter's `listInvitations`. Pass in the accept-invitation use case.

### 6.5 Identity listUserInvitations bypasses port (ID-005)

- **File:** `src/contexts/identity/server/organizations.registration.ts:166-193`
- **Change:** Replace direct `auth.api.listUserInvitations` call with `identityPort.listUserInvitations(headers)`.

### 6.6 Identity updateOrganization bypasses validation (ID-003)

- **File:** `src/contexts/identity/application/use-cases/update-organization.ts:38-63`
- **Change:** Call `validateSlug(input.slug)` and `validateOrganizationName(input.name)` before building updateData (matching property/portal update patterns).

### 6.7 Identity events have zero subscribers (ID-001)

- **File:** Activity context event-handlers (`src/contexts/activity/infrastructure/event-handlers/index.ts`)
- **Change:** Subscribe to `identity.member.invited`, `identity.invitation.accepted`, `identity.member.removed`, `identity.member.role_changed` → create activity audit entries. (Covered in Phase 2.4.)

---

## Verification (all phases)

```bash
pnpm typecheck          # must be clean
pnpm test               # must be 238+ files green
pnpm exec fallow dead-code --changed-since origin/main --format json  # no new dead code
```

---

## Finding → Phase cross-reference

| Finding                                                | Phase   | Severity                                                |
| ------------------------------------------------------ | ------- | ------------------------------------------------------- |
| team-01 (PM write-path scoping)                        | 1.1     | MAJOR (was B→M)                                         |
| D6-001 (staff self-assignment)                         | 1.2     | MAJOR                                                   |
| DASH-02 (dashboard IDOR)                               | 1.3     | MAJOR                                                   |
| PROPERTY-001 (read IDOR)                               | 1.4     | MAJOR                                                   |
| GOAL-05 (read IDOR)                                    | 1.5     | MAJOR                                                   |
| PORTAL-05 (read IDOR)                                  | 1.6     | MAJOR                                                   |
| INBOX-01/04 (count/assign scope)                       | 1.7     | MAJOR                                                   |
| D6-002/003/004 (identity self-service)                 | 1.8     | MAJOR                                                   |
| INBOX-03 (missing event emit)                          | 1.9     | MAJOR                                                   |
| D2-F1 (eventId systemic)                               | 2.1     | MAJOR                                                   |
| R2-001 (reply.published import)                        | 2.2     | MAJOR                                                   |
| INT-01 (property_import.completed)                     | 2.3     | MAJOR                                                   |
| team-03/STAFF-02/INT-02/ID-001/PORTAL-02/GOAL-04/LB-03 | 2.4     | MAJOR                                                   |
| GUEST-01/03 (duplicate feedback/rating)                | 3.1     | MAJOR                                                   |
| GOAL-02/03/06 (recurring atomicity/TOCTOU)             | 3.2     | MAJOR                                                   |
| ACT-006 (idempotency TOCTOU)                           | 3.3     | MAJOR                                                   |
| PORTAL-01 (field drop on update)                       | 3.4     | MAJOR                                                   |
| BADGE-01 (staff query logic bug)                       | 3.5     | MAJOR                                                   |
| GOAL-01 (template spurious progress)                   | 3.6     | MAJOR (was B→M)                                         |
| PORTAL-03 (cross-property authz)                       | 3.7     | MAJOR                                                   |
| METRIC-01 (duplicated keys)                            | 3.8     | MAJOR                                                   |
| INT-05 (permission mismatch)                           | 4.1     | MAJOR                                                   |
| ACT-004 (PM data exposure)                             | 4.2     | MAJOR                                                   |
| NOT-003 (permission coupling)                          | 4.3     | MAJOR                                                   |
| NOT-002 (badge audience)                               | 4.4     | MAJOR                                                   |
| D11-001..004 (neverthrow barrel)                       | 5.1     | MAJOR                                                   |
| PORTAL-04 (domain purity)                              | 5.2     | MAJOR                                                   |
| team-02 (branded cast)                                 | 5.3     | MAJOR                                                   |
| team-04 (trimmed name discarded)                       | 5.4     | MAJOR                                                   |
| team-07 (new Date not clock)                           | 5.5     | MAJOR                                                   |
| ACT-001/002 (ADR 0010 stale)                           | 6.1     | MAJOR                                                   |
| DASH-01 (SQL now())                                    | 6.2     | MAJOR                                                   |
| ID-003/004/005 (identity gaps)                         | 6.3-6.6 | MAJOR                                                   |
| team-05 (test tests local copy)                        | —       | MAJOR (fix: re-export teamErrorStatus, test imports it) |
| team-06 (getTeam dead code)                            | —       | MAJOR (fix: wire to a server fn or delete)              |
| review-001/D8 (staff-recent-activity orchestration)    | —       | MAJOR (fix: extract to review-side use case)            |
| notification-001/D8 (ownership check inlined)          | —       | MAJOR (fix: add userId to markRead/dismiss signatures)  |
