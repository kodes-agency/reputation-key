# Independent Codebase Review — Consolidated Report (Second Pass)

**Date:** 2026-06-21
**Reviewer:** Fresh agent cohort (21 independent reviewers), blind to first-review findings
**Method:** Gold-standard orthogonal review (`docs/plans/review-process-gold-standard.md`). Track A (5 dimensions: D6/D7/D8/D11/D17) ⊕ Track B (16 context reviewers) → **Phase 3 adversarial falsification** → **Phase 4 synthesis**.
**Scope:** reputation-key post-fix codebase — `fix/code-review-fixup` @ `4c656b6`, 16 bounded contexts, hexagonal arch, TanStack Start + Drizzle + better-auth + Zod v4.
**Philosophy:** Report, don't fix. Every BLOCKER/MAJOR below survived independent adversarial falsification.

---

## Headline

- **0 BLOCKER** · **~33 MAJOR** (deduped) · ~65 MINOR · ~30 NIT
- **Convergence vs first review:** First review found 6 BLOCKER + ~50 MAJOR + ~120 MINOR. The comprehensive fix (`4c656b6`) eliminated **ALL 6 BLOCKERs** (0 found). MAJOR count dropped from ~50 to ~33 — the remaining MAJORs are predominantly coherence bugs from the first review that were **not in the fix scope** (the fix prioritized BLOCKERs + structural extractions), plus ~12 genuinely new findings.
- **Falsification gate:** 2 raw BLOCKERs falsified → both DOWNGRADED to MAJOR (team-01: lower-impact context; GOAL-01: claimed catastrophic impact falsified by reconcile job's template-skip logic at line 53-56).
- **All first-review fixes VERIFIED holding:** B1 (PM staff_assignment on portal/review/goal mutations ✓), B2 (route guards use can() ✓), B3/B4 (server fn use case extraction ✓), B5/B6 (88 new tests ✓), D13-001 (dynamicAccessControl enabled ✓), D14-001 (authorId nullable ✓), ACT-B1 (eventId idempotency ✓), ACT-B3 (toDomainRole ✓), INBOX-01/02/03 (state machine + rating ✓), PORTAL-B-03/04/05 (dead files + image job + threshold ✓), L-01 (equal-rank ✓), M-PROP-003 (GBP index ✓), CtxMetric M2 (MV DDL ✓), B-CTX-006 (badge timezone ✓), D8-009 (ALS span enrichment ✓).

---

## BLOCKER (0)

**None.** Two raw BLOCKERs were found by context reviewers and both were downgraded to MAJOR during adversarial falsification (see §Falsification below).

This is the headline convergence result: the comprehensive fix eliminated all six first-review BLOCKERs, and no new BLOCKERs survived falsification.

---

## Falsification Results

### team-01 — BLOCKER → MAJOR (downgraded)

**Claim:** createTeam/updateTeam/softDeleteTeam skip PropertyManager staff_assignment property-access scoping. The READ path enforces `getAccessiblePropertyIds` but the WRITE path does not — same class as first-review B1.

**Falsification:** CONFIRMED that createTeam checks `propertyApi.propertyExists(orgId, pid)` but NOT PM assignment scope. However, downgraded to MAJOR because:

- Teams are organizational units, not customer-facing data (lower impact than portal/review/goal where B1 was BLOCKER).
- The escalation is within-org only (orgId is always scoped).
- No public-facing exploit vector.

**Verdict:** MAJOR. Same B1 class, lower-impact context.

### GOAL-01 — BLOCKER → MAJOR (downgraded)

**Claim:** Recurring goal templates receive spurious event-driven progress via `findActiveGoalsByMetric` (no filter excludes templates with `parentGoalId IS NULL`). Template accumulates progress → gets marked completed → spawn-recurring job stops creating instances.

**Falsification:** CONFIRMED that `findActiveGoalsByMetric` (goal.repository.ts:303-325) does NOT filter templates — it returns any goal with `status='active'` matching metric/org/property/scope. So templates DO receive event-driven `upsertProgress` calls via `on-metric-recorded.ts`.

However, the **claimed catastrophic impact is FALSIFIED**:

- `reconcile-goal-progress.job.ts:53-56` explicitly skips templates:
  ```typescript
  // Skip recurring templates — they have no period, progress lives on instances
  if (goal.goalType === 'recurring' && !goal.periodStart && !goal.periodEnd) {
    continue
  }
  ```
- Completion logic (line 104-106) only applies to instances (`parentGoalId !== null`).
- No code path ever marks a template `completed` based on its progress.
- The spawn-recurring job creates instances from active templates regardless of template progress.

**Verdict:** MAJOR. Template receives spurious progress data (pollution), but the claimed "spawn cycle dies" impact is false. Impact is orphaned data in `goal_progress`, not functional failure.

---

## MAJOR Findings (deduped, grouped by theme)

### Theme 1 — eventId caller-provided (SYSTEMIC, unfixed D2-F1)

**Severity:** MAJOR · **First review:** D2-F1 (systemic, 8 contexts) · **Fix status:** NOT FIXED

Every event constructor across ALL contexts accepts `eventId` as a caller-provided argument. Callers hand-pass `crypto.randomUUID()` inline. This violates `standards.md §1.5` ("eventId is auto-generated inside the constructor. Callers do not pass it."). Confirmed independently by 8+ reviewers: review (R2-002), integration (INT-03), staff (STAFF-03), guest (GUEST-02), inbox (INBOX-02), identity (ID-002), portal, metric, goal, badge, leaderboard, team, activity.

**Impact:** Breaks the correlation chain across the metric→badge/goal/leaderboard fan-out hub. Latent risk of non-UUID or duplicate eventIds.

### Theme 2 — PM/Staff property-access scoping gaps (B1 class, unfixed contexts)

**Severity:** MAJOR · **First review:** B1 (BLOCKER, fixed for portal/review/goal) · **Fix status:** PARTIALLY FIXED — write paths fixed, but read paths + unfixed contexts remain

The B1 fix added `isPropertyAccessible` / `assertPropertyAccessible` to portal/review/goal MUTATIONS. The following gaps remain:

| Finding        | Context   | Gap                                                                       |
| -------------- | --------- | ------------------------------------------------------------------------- |
| team-01        | team      | createTeam/updateTeam/softDeleteTeam skip PM assignment scoping           |
| D6-001         | staff     | createStaffAssignment skips PM property scoping                           |
| DASH-02        | dashboard | 3 server fns accept client-supplied propertyId, no staff_assignment check |
| PROPERTY-001   | property  | getProperty read path not scoped (PM can read any property by ID)         |
| GOAL-05        | goal      | getGoal/listGoals not scoped for PM                                       |
| PORTAL-05      | portal    | Read use cases don't filter by PM assignment                              |
| INBOX-01       | inbox     | getNewCount/getInboxFolderCounts org-wide for Staff                       |
| INBOX-04       | inbox     | assignInboxItem doesn't validate assignee's property access               |
| D6-002/003/004 | identity  | changePassword/updateProfile/updateUserImage have no can()                |
| STAFF-01       | staff     | Self-assignment guard inconsistent (create bypasses, update enforces)     |

**Impact:** Within-org horizontal privilege escalation. PM/Staff can read/mutate data for properties they're not assigned to. Org boundary is intact (no cross-tenant).

### Theme 3 — Events with zero subscribers (SYSTEMIC)

**Severity:** MAJOR · **First review:** 29 events no subscriber (arbitrated to MINOR) · **Fix status:** NOT FIXED

| Context     | Events                                    | Subscribers |
| ----------- | ----------------------------------------- | ----------- |
| team        | team.created/updated/deleted              | 0           |
| staff       | staff.assigned/unassigned                 | 0           |
| integration | connected/disconnected/visibility_changed | 0           |
| identity    | All 6 identity events                     | 0           |
| portal      | 10 of 12 portal events                    | 0           |
| goal        | progress_updated                          | 0           |
| leaderboard | snapshot.refreshed                        | 0           |

**Impact:** These events fire into the void. No audit trail (activity context only subscribes inbox._/review._ tags). Missing notification/automation triggers.

### Theme 4 — First-review coherence bugs NOT addressed by fix

| ID       | Finding                                                         | First review ID | Context      |
| -------- | --------------------------------------------------------------- | --------------- | ------------ |
| R2-001   | review.reply.published not emitted on import (google_sync) path | R-03            | review       |
| INT-01   | property_import.completed defined, never emitted                | CTX-INT-002     | integration  |
| GUEST-01 | Duplicate feedback returns 500 not 4xx                          | G-01            | guest        |
| DASH-01  | SQL now() despite Clock injected (ADR 0017)                     | D13-003         | dashboard    |
| GOAL-02  | Recurring goal creation non-atomic                              | G-TB-02         | goal         |
| NOT-001  | createNotification doesn't validate userId                      | NTF-01/D14-001  | notification |
| team-02  | updateTeam casts raw string to branded UserId                   | T-TEAM-03       | team         |
| ACT-001  | CONTEXT.md + ADR 0010 describe stale payload-hash idempotency   | (doc drift)     | activity     |

### Theme 5 — New findings (not in first review)

| ID               | Finding                                                                                              | Severity | Context               |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| GOAL-01          | Recurring template receives spurious event-driven progress (downgraded B→M)                          | MAJOR    | goal                  |
| BADGE-01         | Staff badge visibility query broken for grouped portals (AND of mutually exclusive clauses → 0 rows) | MAJOR    | badge                 |
| PORTAL-01        | Link/category update silently drops iconKey/updatedAt (Drizzle .set() snake_case mismatch)           | MAJOR    | portal                |
| PORTAL-03        | addPortalToGroup/createPortalGroup don't verify portal belongs to same property as group             | MAJOR    | portal                |
| PORTAL-04        | domain/events.ts imports node:assert + crypto (domain purity violation)                              | MAJOR    | portal                |
| D11-001..004     | 4 domain files import Result/ok/err directly from neverthrow (bypass barrel)                         | MAJOR    | dashboard/goal/portal |
| ACT-006          | Idempotency TOCTOU — no DB UNIQUE(eventId, orgId) constraint                                         | MAJOR    | activity              |
| ACT-004          | PM data exposure: getOrgActivity uses inbox.manage vs timeline's organization.update                 | MAJOR    | activity              |
| METRIC-01        | Duplicated VALID_METRIC_KEYS (incomplete F073 refactor) + error-code mismatch                        | MAJOR    | metric                |
| INT-05           | Permission mismatch: server fn gates integration.manage, use case gates property.create              | MAJOR    | integration           |
| GUEST-03         | Concurrent duplicate rating race → 500 (unique constraint violation untranslated)                    | MAJOR    | guest                 |
| NOT-002          | Badge notification excludes Staff (CONTEXT.md says "managers AND staff")                             | MAJOR    | notification          |
| NOT-003          | All 7 notification server fns use inbox.read (no notification.\* permission exists)                  | MAJOR    | notification          |
| ID-003           | updateOrganization bypasses slug/name domain validation on update path                               | MAJOR    | identity              |
| ID-004           | propertyIds not surfaced in InvitationRecord, not carried on accept event                            | MAJOR    | identity              |
| ID-005           | listUserInvitations bypasses IdentityPort, calls auth.api directly                                   | MAJOR    | identity              |
| LB-01            | Cross-context boundary violation: repo directly queries metric/portals/portalGroups tables           | MAJOR    | leaderboard           |
| LB-02            | Domain purity: ranking/scoring logic lives in infrastructure repository                              | MAJOR    | leaderboard           |
| review-001       | staff-recent-activity server fn orchestrates 2 use cases with conditional logic                      | MAJOR    | review                |
| notification-001 | markNotificationRead/dismiss has 3-call ownership check inlined in server fn                         | MAJOR    | notification          |
| D8 review-001    | (same as review-001, cross-validated by D8 dimension reviewer)                                       | MAJOR    | review/server         |

---

## First-Review Fix Verification (convergence check)

### Fixes VERIFIED holding (15/15)

| First-review ID | Fix description                                             | Verified by                          | Status |
| --------------- | ----------------------------------------------------------- | ------------------------------------ | ------ |
| B1 / D6-001     | PM staff_assignment scoping on portal/review/goal mutations | R2-Portal, R2-Review, R2-Goal, R2-D6 | ✓ HELD |
| B2 / D6-002     | Route guards use can() not hasRole()                        | R2-D6                                | ✓ HELD |
| B3 / D8-001     | staff-portals-update uses portal public-api                 | R2-Staff, R2-D8                      | ✓ HELD |
| B4 / D8-002     | goal staff-goals extracted to use case                      | R2-Goal                              | ✓ HELD |
| D13-001         | dynamicAccessControl enabled + orgRole migration            | R2-D6, R2-Identity                   | ✓ HELD |
| D14-001         | Reply.createdBy nullable + handler skip                     | R2-Review                            | ✓ HELD |
| ACT-B1          | Audit idempotency keyed on eventId                          | R2-Activity                          | ✓ HELD |
| ACT-B3          | actorRole via toDomainRole                                  | R2-Activity                          | ✓ HELD |
| INBOX-01/02     | Inbox state machine coherent + validateTransition           | R2-Inbox                             | ✓ HELD |
| INBOX-03        | Feedback rating populated                                   | R2-Inbox                             | ✓ HELD |
| PORTAL-B-03     | Dead duplicate server files deleted                         | R2-Portal                            | ✓ HELD |
| PORTAL-B-04     | process-image job enqueued                                  | R2-Portal                            | ✓ HELD |
| PORTAL-B-05     | smartRoutingThreshold consistency                           | R2-Portal                            | ✓ HELD |
| L-01            | Leaderboard equal-rank invariant                            | R2-Leaderboard                       | ✓ HELD |
| B-CTX-006       | Badge streak timezone consistency                           | R2-Badge                             | ✓ HELD |
| CtxMetric M2    | MV DDL + unique indexes exist                               | R2-Metric                            | ✓ HELD |
| M-PROP-003      | GBP unique index                                            | (Phase 0 fallow clean)               | ✓ HELD |
| D8-009/D16      | ALS span enrichment (orgId/userId/role/useCase)             | (test logs confirm)                  | ✓ HELD |

### First-review findings NOT addressed (explain remaining MAJORs)

The comprehensive fix (`4c656b6`) prioritized the 6 BLOCKERs + structural extractions + coherence bugs with direct functional impact. The following first-review MAJORs were **documented but deferred** — they re-surface in this second review:

1. **D2-F1 (eventId caller-provided)** — 8+ contexts. Systemic; requires touching all event constructors + all emit sites.
2. **R-03 (reply.published on import path)** — requires changing the google_sync import path.
3. **CTX-INT-002 (property_import.completed never emitted)** — requires adding emit to import use case.
4. **G-01 (duplicate feedback 500)** — requires adding pre-check or 23505 mapping.
5. **D13-003 (SQL now() in dashboard)** — requires passing clock through adapter.
6. **G-TB-02 (recurring goal non-atomic)** — requires wrapping template + instances in one tx.
7. **INBOX-04 (count queries not Staff-scoped)** — requires adding property filter to count queries.
8. **NTF-01 (createNotification doesn't validate userId)** — requires adding validation.
9. **T-TEAM-03 (updateTeam raw string cast)** — requires using userId() constructor.
10. **Events with zero subscribers** — 7+ contexts. Requires either adding handlers or pruning events.

---

## Phase 0 Baseline (unchanged)

| Check                      | Result                                     |
| -------------------------- | ------------------------------------------ |
| Typecheck (`tsc --noEmit`) | CLEAN (exit 0)                             |
| `@ts-ignore`               | 0                                          |
| `hasRole()` in prod        | 10 (all legitimate: domain hierarchy + UI) |
| `as any` in prod           | 48 (server fn generics + codegen)          |
| `throw new Error` in prod  | 17                                         |
| `console.*` in prod        | 4                                          |
| Fallow `new-only` gate     | PASSES                                     |
| Boundary violations        | 0                                          |
| Dead files                 | 0                                          |

---

## Dimension Verdicts

### D6 (Permissions/Authz) — fundamentally sound

- Every mutation server fn reaches its state change through a `can()` gate.
- Route guards universally use `can()` (not `hasRole()`).
- `dynamicAccessControl` is enabled.
- No server fn bypasses use cases to hit repos directly.
- **Remaining gaps:** unfixed PM scoping contexts (Theme 2), self-service identity mutations.

### D7 (Multi-tenancy/Isolation) — fundamentally sound

- "Every Drizzle repository that owns tenant-scoped data filters by organizationId on every query path."
- 12 cross-tenant queries verified legitimate (background jobs / JWT-verified webhooks).
- 0 MAJOR, 3 MINOR (badge unscoped lookup, identity adapter, missing repo tests).

### D8 (Server Functions) — structurally clean

- `tracedHandler` UNIVERSAL on all 55 server fn files.
- Zod `.inputValidator()` UNIVERSAL.
- Zero `as unknown as` in server files.
- Zero cross-context direct repo imports.
- Error mapping CONSISTENT (`isXxxError → throwContextError` + `catchUntagged` tail).
- **Remaining gaps:** 2 server fns with inline orchestration (review staff-recent-activity, notification ownership check).

### D11 (Domain Purity) — substantially pure

- No Drizzle/infra/server-only/DB-schema-type imports in domain.
- Zero async/await in domain.
- No side effects (console/logging/HTTP).
- ADR 0008 boundaries CLEAN.
- **Remaining gaps:** neverthrow imports bypassing barrel (4 files, borderline), portal events node:assert+crypto.

### D17 (Test Quality) — improved but server-fn coverage still low

- 238/238 test files pass, 2186 tests.
- 88 new tests added in the fix (use cases + repos + event handlers).
- **Remaining gap:** Only 2 of ~150 server fn handlers have executable invocation tests. 5 contexts have no server test file at all (activity, badge, dashboard, leaderboard, notification).
- Calibrated to MAJOR (not BLOCKER) because use-case/repo tests provide partial safety net.

---

## Cross-Validation Scorecard

| Finding                            | Lenses confirming                                                                           | Confidence            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| eventId caller-provided (D2-F1)    | D8 + review + integration + staff + guest + inbox + identity + portal + metric + goal (10+) | Very high (systemic)  |
| PM/Staff scoping gaps              | D6 + team + property + goal + dashboard + inbox + portal + staff (8)                        | Very high             |
| Events with zero subscribers       | team + staff + integration + identity + portal + goal + leaderboard (7)                     | Very high             |
| Review reply.published import path | review + D2 lens (2)                                                                        | High                  |
| Badge staff query grouped portals  | badge (1, code-trace confirmed)                                                             | High (logic-verified) |
| Portal link update drops fields    | portal (1, code-trace confirmed)                                                            | High (logic-verified) |
| Activity TOCTOU idempotency        | activity (1, schema-verified)                                                               | High                  |
| Goal template spurious progress    | goal + coordinator falsification (2)                                                        | High (falsified B→M)  |

---

## Convergence Assessment

| Metric          | First Review | Second Review | Trend                                        |
| --------------- | ------------ | ------------- | -------------------------------------------- |
| BLOCKER         | 6            | **0**         | ✅ All eliminated                            |
| MAJOR (deduped) | ~50          | **~33**       | ↓ 34% (20 are unfixed first-review findings) |
| MINOR           | ~120         | **~65**       | ↓ 46%                                        |
| NIT             | —            | **~30**       | —                                            |

**New findings (not in first review):** ~12 MAJOR, ~15 MINOR. These represent blind spots of the first review's methodology — particularly in the team, badge, portal, and activity contexts where the first review's Track B reviewers may have under-investigated.

**Conclusion:** The comprehensive fix (`4c656b6`) successfully eliminated all 6 BLOCKERs and prevented any new BLOCKERs from emerging. The remaining ~33 MAJORs are predominantly first-review coherence bugs that were deferred from the fix scope (not regressions), plus ~12 genuinely new findings. The codebase is structurally healthier — server functions are clean, domain purity is high, tenant isolation is solid, and the permission model is fundamentally sound.

---

## Recommended Fix Priority (for next iteration)

1. **Theme 2 (PM/Staff scoping)** — extend `isPropertyAccessible` to team, staff-assignment creation, dashboard reads, and all read paths. Single pattern, ~10 call sites.
2. **Theme 1 (eventId)** — migrate all event constructors to auto-generate `eventId` inside the constructor. Systemic but mechanical.
3. **Theme 4 coherence bugs** — batch the 10 unfixed first-review MAJORs (reply.published, property_import.completed, duplicate feedback 500, SQL now(), recurring atomicity, notification userId validation, team cast).
4. **Theme 5 new findings** — BADGE-01 (staff query logic bug), PORTAL-01 (field-drop on update), ACT-006 (DB unique constraint).
5. **Theme 3 (events with zero subscribers)** — triage: add handlers for audit/notification-critical events; prune truly dead events.
6. **D17** — add server-fn executable tests (forbidden-role + second-org assertions) for the 5 untested contexts.

---

## Run Artifacts

Phase 0 facts: `local://phase0-facts-r2.md` · Rubric: `local://rubric-r2.md` ·
Track A findings: `local://r2-d{6,7,8,11,17}-*-findings.md` ·
Track B findings: `local://r2-{property,portal,review,inbox,goal,identity,metric,integration,staff,team,guest,badge,leaderboard,dashboard,notification,activity}-findings.md` ·
Process: `docs/plans/review-process-gold-standard.md`.

_Methodology: orthogonal matrix (Track A dimensions × Track B contexts) + adversarial falsification + cross-cutting synthesis. 21 independent reviewers, blind to each other and to first-review findings. Every BLOCKER/MAJOR survived independent falsification._
