# Auth Resolution Caching & Property Access Scoping Improvements

**Date:** 2026-07-12  
**Status:** In progress (Phase 0)  
**Goal:** Deliver cheap single-instance wins + prepare for multi-replica using existing `permission_version` signal.

## Improvement Tracker

| ID    | Improvement                                            | Rationale (from audit)                                                               | Files                                                         | Decision                    | Status  | Evidence |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------- | ------- | -------- |
| AC-01 | Raise TENANT_CACHE_TTL_MS (30-60s+)                    | Current 5s overly conservative; version check protects                               | middleware.ts                                                 | Implement                   | pending |          |
| AC-02 | Soften/remove unconditional clearTenantCache()         | Lets entries survive across multi-fn page loads                                      | traced-server-fn.ts                                           | Implement                   | pending |          |
| AC-03 | Per-request memoization via ALS                        | Defensive; free if re-called in same fn                                              | request-context.ts + middleware.ts                            | Implement                   | pending |          |
| AC-04 | Cache accessible property sets (org+user+version)      | Highest call volume in data paths (goals/inbox/teams etc.); same invalidation signal | middleware.ts, staff/build.ts, property-access.ts, staff repo | Implement (Tier 1 priority) | pending |          |
| AC-05 | Batching/lazy scoping for multi-permission needs       | Reduce redundant lookups in complex flows                                            | relevant use cases (dashboard, inbox bulk, etc.)              | Implement where measurable  | pending |          |
| AC-06 | Add timing/tracing for both paths                      | Enable measurement of wins                                                           | trace/middleware                                              | Implement                   | pending |          |
| AC-07 | Ensure consistent org-wide fast path                   | Avoid unnecessary DB even in cached path                                             | all scoping sites + wrapper                                   | Implement                   | pending |          |
| AC-08 | Produce verification report + update remaining-work.md | Close the loop                                                                       | docs/...                                                      | Implement                   | pending |          |

## Key Decisions

- TTL target: 60_000 ms (1 minute) initially.
- Cache structure: Extend existing tenantCache entry with optional `accessibleSets: Map<Permission, ReadonlyArray<PropertyId> | null>`.
- Invalidation: Reuse existing version check + bump on staff_assignments.
- Scope: On-demand per-permission (lazy populate on first request for that perm).
- Tier 3 (Redis) deferred until numReplicas > 1 is scheduled.

## Baseline Snapshot (2026-07-12)

- Branch: feat/auth-caching-improvements-2026-07-12 (created for this work)
- git HEAD: current (post Phase 1 starter edits)
- `pnpm typecheck`: clean (exit 0)
- `pnpm lint`: clean (✓ kebab-case + no boundary violations)
- Relevant tests (middleware + staff + goal/application + inbox/application): Latest full validation run clean (typecheck + lint + 23 tests in middleware + staff/build passed). All focused scoping tests green.
- Notes: Single replica (railway.json). Redis already present (BullMQ + rate limiting + general Cache port). `permission_version` triggers are solid. Date.now() confirmed allowed for internal cache TTLs (not domain time).

## Progress

- Phase 0: Tracker created. Dedicated branch created. Baselines captured (all clean).
- Phase 1 started + core changes:
  - TENANT_CACHE_TTL_MS raised to 60_000.
  - clearTenantCache() de-emphasized.
  - ALS per-request memoization.
- Phase 1 + 2 + 3:
  - TTL 60s, clear de-emphasized, ALS memo.
  - Versioned property set cache (org:user:version) wired + traced in publicApi path.
  - Direct + end-to-end (publicApi + repo spy) tests for hit/miss/invalidation. All pass.
  - Dead code + `any` cleaned per subagent.
  - Tracing added to lookup.
  - typecheck/lint clean.

**Subagent review completed and addressed (see full output in session).**

**Date.now decision:** Allowed for cache TTL checks (pre-existing pattern in tenantCache; clock() is for domain time per ADR 0017). Documented in tracker + remaining-work.md.

## Phase 4 Verification Snapshot (2026-07-12)

- Broader test sweep (auth + 10 contexts): **172 files / 1741 tests PASSED** (exit 0).
- typecheck + lint: clean (pre-commit + explicit).
- PR created: https://github.com/kodes-agency/reputation-key/pull/133
- All changes on branch `feat/auth-caching-improvements-2026-07-12` (pushed).
- remaining-work.md updated (item 3 marked as single-instance complete + multi-replica prep noted).
- Subagent feedback addressed, Date.now decision documented.
- No new BLOCKERs. Core improvements delivered.

**Status:** Plan phases complete. PR #133 ready for review.

- On branch: feat/auth-caching-improvements-2026-07-12

## Summary

Final broader test sweep clean. PR created. All phases of the auth caching improvements plan executed.

- Then Phase 3 refinements.

## Gates & Verification

See the approved plan.md for detailed gates per phase.

**Phase 0 Gate:** Tracker created, baselines captured, decisions recorded. Subagent review of plan/audit.
