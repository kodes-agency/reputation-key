# Fix Plan — MINOR/NIT Findings (Second Review Pass)

**Source:** `docs/review-run/2026-06-21-second-pass-consolidated-report.md`
**Scope:** ~65 MINOR + ~30 NIT findings, grouped by category
**Strategy:** Batch by category — each category can be a single commit
**Rule:** Convention fixes only. No behavioral changes unless explicitly noted.

---

## A. Dead Code Cleanup (12 findings)

### A.1 Unused exports (fallow-confirmed)

- **badge.dto.ts** — 5 unused schema exports: `badgeTargetScopeSchema`, `badgeTargetTypeSchema`, `badgeCriteriaOperatorSchema`, `badgePeriodPresetSchema`, `badgeCriteriaSchema`. Drop `export` keyword → module-private.
- **goal/server/goals.ts:152** — `updateGoal` exported but unused. Either wire to a server fn or remove.
- **identity/better-auth-schemas.ts:89** — `listOrganizationsResponseSchema` unused. Remove.
- **portal/public-api.ts:10,13** — `portalDeleted`/`portalGroupDeleted` value exports. Zero consumers (all use type-only imports). Remove the value exports, keep type re-exports.
- **permissions.ts:82** — `resetPermissionLookup` unused. Remove.
- **shadcn** — unused devDependency in package.json. Remove.

### A.2 Dead use cases / code

- **team/get-team.ts** (team-06) — wired in build.ts but never called. Either expose a `getTeam` server fn or delete the use case + its StaffPublicApi dep wiring.
- **portal/delete-portal-group.ts** (PORTAL-06) — dead duplicate of `softDeletePortalGroup`. Delete file + test.
- **activity/build.ts** (ACT-005) — `insertActivityLog` use case instantiated in build.ts but never consumed (bootstrap re-instantiates). Remove from build.ts.
- **review/domain/rules.ts:41-61** (R2-005) — `transitionReply` smart-constructor has zero callers. Either wire into use cases (replacing manual spread) or delete.
- **integration/list-google-connections.ts:27** (INT-07) — dead ternary branch (always takes true branch). Simplify to `const filter = { showAll: true }`.
- **goal/ports/goal.repository.ts:50** (GOAL-07) — `findAllActive(organizationId)` port method has zero callers. Remove from port + impl.
- **notification/server/notifications.ts:215,263** — `getNotificationPreferencesFn` / `updateNotificationPreferenceFn` marked "not yet wired" (dead RPC surface). Wire or remove.

---

## B. Doc / CONTEXT.md / ADR Accuracy (15 findings)

### B.1 Activity context

- **ACT-001** — CONTEXT.md:32 + ADR 0010:23 describe payload-hash idempotency. Update to `(eventId, organizationId)`.
- **ACT-002** — ADR 0010:20 mandates dedicated `activity-log` queue; code uses shared `default`. Either amend ADR or create the queue.
- **ACT-015** — CONTEXT.md §Relationships understates StaffPublicApi as hard read-path dependency. Add note.

### B.2 Inbox context

- **INBOX-05** — CONTEXT.md says `archived→{escalated}`; code allows `archived→{read, escalated}`. Update doc to match code+test.
- **INBOX-06** — CONTEXT.md glossary "New Badge" claims per-user-accessible-properties scope; port + use case are explicitly org-level. Update doc.
- **INBOX-09** — `composition.ts:474` uses stale `unreadCounter` name (renamed to `newCounter`). Rename property.

### B.3 Team context

- **team-10** — CONTEXT.md:59-60 over-states `getTeam` ("member info") and `listTeams` ("staff count"). Update to "filtered by accessible properties" without enrichment claims.

### B.4 Portal context

- **PORTAL-11** — `list-portal-links.ts:3-4` header comment says "no permission gate" but code has `can()`. Remove or update comment.

### B.5 Integration context

- **INT-08** — CONTEXT.md:112 says gbp-import.ts checks `property.create` for all 3 fns; 2 of 3 check `integration.manage`. Correct the doc.

### B.6 Identity context

- **ID-012** — `events.ts:4-8` header says "not currently emitted" — all 6 events ARE emitted. Remove/update.

### B.7 Guest context

- **GUEST-05** — CONTEXT.md:32 claims "HttpOnly" cookie; implementation is client-set `document.cookie` (cannot be HttpOnly). Either: (a) move cookie-setting to server-side `Set-Cookie` header, or (b) update CONTEXT.md to reflect client-set cookie reality.

### B.8 Dashboard context

- **DASH-04** — `portal-analytics.ts:27-32` defines local `dashboardErrorStatus` match block instead of using shared `standardErrorStatus`. Replace with `const dashboardErrorStatus = standardErrorStatus` (matching 3 sibling fns).

---

## C. Convention Drift (8 findings)

### C.1 Error-status helper duplication

- **team-05** — `server/teams.test.ts:17-32` re-implements `teamErrorStatus` locally instead of testing the real function. Fix: re-export `teamErrorStatus` from `teams.ts`, import in test.
- **staff-07** — `staff-assignments.test.ts` re-implements `staffErrorStatus` inline. Same fix: import from `./staff-shared`.

### C.2 Bare `throw e` vs `catchUntagged(e)`

- **PORTAL-08** — `portals.ts:79,104,129,154,179` use bare `throw e` while siblings use `throw catchUntagged(e)`. Standardize.

### C.3 `as string` instead of `unbrand()`

- **team-09** — `team.repository.ts:53,80-81` use `as string` instead of `unbrand()`. Replace with `unbrand()`.
- **notification/insert-notification.ts** — Branded-type `as string` casts instead of `unbrand()`. Replace.

### C.4 Error code semantics

- **PORTAL-09** — `portalGroupCreated`/`portalGroupUpdated` throw `invalid_label` for name validation. Should be `invalid_name`.
- **review/events.ts** (R2-008) — Constructors throw `reviewError('invalid_rating', ...)` for date checks. Should use `assert(...)` per §1.4.
- **team-12** — Event constructors throw `teamError('invalid_name', ...)` for occurredAt validation. Should use `assert(...)`.

### C.5 Job name hardcoded

- **PORTAL-10** — `finalize-upload.ts:62` hardcodes `'process-image'` instead of importing `JOB_NAME` constant. Re-export the constant via a shared location accessible from application layer.

### C.6 Event constructor convention

- **GUEST-06** — Guest event constructors use `throw guestError(...)` instead of `assert(...)` per §1.4. Migrate to `assert()`.

---

## D. Test Improvements (10 findings)

### D.1 Missing server-fn executable tests

- **D17-001** — Only 2 of ~150 server fn handlers have executable invocation tests. Priority contexts: activity, badge, dashboard, leaderboard, notification (zero server test files). Add at least: forbidden-role (403) test + happy-path test for the main mutation fn in each.

### D.2 Missing forbidden-role tests

- **D17-002** — Zero 403 tests for 14 of 16 contexts. Add forbidden-role test for each context's primary mutation fn.

### D.3 Missing cross-tenant isolation tests at server-fn boundary

- **D17-003** — Cross-tenant tested at repo + partial use-case layers, never at server-fn boundary. Add second-org test for critical mutations.

### D.4 Event-emission assertion gaps

- **D17-005** — Portal/property/staff/team/review mutations lack event-emission assertions (unlike goal/guest/identity which have them). Add `expect(events.emit).toHaveBeenCalledWith(...)` assertions.

### D.5 Specific missing tests

- **team-11** — `soft-delete-team.test.ts` doesn't exercise `team_has_assignments` guard. Add case with `countByTeam > 0`.
- **GUEST-08** — `public.test.ts` exhaustive check omits `forbidden` error code. Add it.
- **GUEST-09** — No server-function integration tests for `submitRatingFn`/`submitFeedbackFn`. Add handler-level test.
- **GUEST-10** — `events.test.ts` doesn't test `guestReviewLinkClicked` constructor. Add test.
- **ID-010** — `accept-invitation.test.ts` and `cancel-invitation.test.ts` don't exist. Create them.
- **BADGE-01** — No repository test file for badge context at all. Create `badge.repository.test.ts` with at minimum the staff-grouped-portal visibility test.

### D.6 In-memory fake bug

- **INBOX-08** — `in-memory-inbox-repo.ts:22-24` — `findFilteredPaginated` uses `i.status === filters.status` which fails for `InboxStatus[]` (Unaddressed tab query returns `[]`). Fix: `Array.isArray(filters.status) ? filters.status.includes(i.status) : i.status === filters.status`.

---

## E. Schema / Migration (3 findings)

### E.1 Reply unique index

- **R2-003** — "One published reply per review" partial unique index documented in schema NOTE + CONTEXT.md §32 but never created. Create via raw SQL migration:
  ```sql
  CREATE UNIQUE INDEX replies_one_published_per_review
  ON replies (review_id, organization_id)
  WHERE status = 'published';
  ```

### E.2 Goal spawn-recurring unique index (GOAL-06)

- Create partial unique index to prevent duplicate instances:
  ```sql
  CREATE UNIQUE INDEX goals_parent_period_uniq
  ON goals (parent_goal_id, period_start)
  WHERE parent_goal_id IS NOT NULL;
  ```

### E.3 Staff assignments schema

- **STAFF-06** — `staff_assignments.id` has `defaultRandom()` despite standards §5.2 "no defaultRandom() on schema columns." Remove the default; the use case supplies the ID via `deps.idGen()`.

---

## F. Performance & Minor Logic (5 findings)

### F.1 Badge timezone re-query (BADGE-06)

- **File:** `src/contexts/badge/application/use-cases/evaluate-badge-for-target.ts:68-88`
- **Change:** Hoist `findPropertyTimezone` to the orchestrator (one call per metric event, not per definition). Thread the result into `evaluateBadgeDefinitionForTarget`.

### F.2 Badge DST-fragile streak stepping (BADGE-07)

- **File:** `src/contexts/badge/application/use-cases/evaluate-badge-for-target.ts:188-204`
- **Change:** Replace `new Date(now - offset * 24h)` with portal-local calendar-day decrement (parse `dayKeyInTimezone(now)`, subtract 1 calendar day per iteration).

### F.3 Goal spawn N+1 (GOAL-10)

- **File:** `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts:105-108`
- **Change:** Use `listInstancesBatch` (already exists at goal.repository.ts:475) instead of per-template `listInstances`.

### F.4 Activity pagination lossy for PM (ACT-010)

- **File:** `src/contexts/activity/queries/get-org-activity.ts:62-74`
- **Change:** Push property filtering into SQL (add `propertyId IN (...)` to the query) instead of in-memory filter-then-slice.

### F.5 Badge event payload excess fields (BADGE-05)

- **File:** `src/contexts/badge/application/use-cases/evaluate-badge-for-target.ts:117`
- **Change:** Replace `badgeAwarded({ occurredAt: deps.clock(), ...inserted })` with explicit field selection: `badgeAwarded({ badgeDefinitionId, criteriaVersion, targetType, targetId, organizationId, propertyId, awardedAt, occurredAt })`.

---

## G. NIT (batch, ~15 findings)

- **PORTAL-13** — `description` nullability inconsistent between create/update DTOs. Align both to `.nullable().optional()`.
- **DASH-05** — `dashboard.repository.ts:153` local function `MetricQuery` uses PascalCase. Rename to `metricQuery`.
- **GUEST-07** — `build.ts:53-65` duplicate `trackReviewLinkClick` instantiation. Reuse `useCases.trackReviewLinkClick`.
- **ACT-013** — `activity-repository.drizzle.ts:63-64` payload JSONB cast without validation. Add Zod schema check on read.
- **ACT-014** — `activity-repository.drizzle.ts:49` `as Role` cast. Use `toDomainRole` or `satisfies Role`.
- **ID-007** — Identity storage port inconsistency (org-logo uses portal's StoragePort, avatar uses local IdentityStoragePort). Extend IdentityStoragePort with `confirmUpload`.
- **ID-008** — `cancel-invitation` emits `identityInvitationRejected` for a cancel action. Either add `identity.invitation.canceled` event or document the conflation.
- **ID-009** — eventId generation inconsistency (4 use cases use crypto.randomUUID(), 2 use deps.idGen()). Moot if Phase 2.1 (auto-gen eventId) is done.
- **ID-011** — Identity event field naming deviates from §1.9 (uses `changedBy` instead of `userId`). Align.
- **team-08** — eventId caller-provided in team events. Moot if Phase 2.1 done.
- **INT-09** — GoogleOAuthPort lacks `getAuthorizationUrl`. Design note, not a defect — no action.
- **INT-10** — gbp-import.repo.ts uses `new Date()` for updatedAt. Acceptable for DB-bookkeeping fields.
- **GOAL-08** — Goal domain events.ts imports node:assert/strict. Codebase-wide pattern, batch with PORTAL-04.
- **GOAL-09** — `handleRecurringGoal` returns instance progress as template progress. Add explicit type distinction.
- **GOAL-11** — Redundant `as AggregationFunction` / `as MetricKey` casts in goals.ts. Remove.

---

## Execution Order

1. **Phase A (Dead Code)** — no risk, immediate merge. Can run while other phases are in progress.
2. **Phase B (Docs)** — no risk, batch commit. Depends on Phase decisions from MAJOR plan (e.g., INT-05 permission decision).
3. **Phase D (Tests)** — add alongside MAJOR fixes (each MAJOR fix should add its own test). D.6 (in-memory fake bug) is standalone.
4. **Phase E (Schema)** — E.1/E.2 are raw SQL migrations. E.3 is schema edit + migration.
5. **Phase C (Convention)** — batch per context. Low risk.
6. **Phase F (Perf)** — individual, can be done anytime.
7. **Phase G (NIT)** — final polish batch.

---

## Verification (all categories)

```bash
pnpm typecheck          # must be clean
pnpm test               # must be 238+ files green
pnpm exec fallow dead-code --changed-since origin/main --format json  # no new dead code
pnpm exec eslint src/ --quiet   # no boundary violations
```
