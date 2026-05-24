# Review Fix Strategy

**Date:** 2026-05-23
**Scope:** 17 reviews covering PRs #61–#64 (Phases 14.5 + 15A/B/C)
**Total findings:** 135 (34 BLOCKER · 55 MAJOR · 30 MINOR · 16 NIT)

---

## Deduplication

Many findings appear in multiple reviews (same root cause, different angle). After dedup:

| Category                                         | Unique Issues | Est. Files Touched |
| ------------------------------------------------ | ------------- | ------------------ |
| Domain purity (`throw`, `crypto`, constructors)  | ~8            | 15                 |
| Auth/permissions (`can()` gaps, hardcoded roles) | ~10           | 12                 |
| Observability (trace spans, PII in logs)         | ~8            | 20                 |
| Type safety (force-casts, branded types)         | ~5            | 10                 |
| Architecture (cross-context imports, DTO leaks)  | ~6            | 10                 |
| Tests (missing coverage, structural stubs)       | ~6            | 8                  |
| Docs (CONTEXT.md, ADRs)                          | ~4            | 6                  |
| Misc MINOR/NIT                                   | ~15           | 15                 |

**Real work: ~62 unique fixes, ~96 files touched.**

---

## Proposed Work Streams

### Stream 1: Domain Purity & Architecture (HIGHEST PRIORITY)

Fixes the foundational violations that multiple other findings reference.

- Replace `throw` with `Result` returns in `progress-strategy.ts` (2 throws)
- Remove Node.js `crypto` from domain — extract to infrastructure port
- Add constructors for anemic entities (StaffAssignment, MetricReading, GbpCacheEntry)
- Remove `create-goal.ts` cross-context import of metric application layer
- Remove server imports of domain error constructors (`goalError`)
- Move `ui/` layer in goal context to standard 4-layer structure

**Reviews hit:** R1, R3, R4, R16
**Files:** ~15 | **Risk:** Medium (core domain) | **Tests:** Domain tests must pass

### Stream 2: Auth & Permissions (HIGHEST PRIORITY)

Security-critical — permission checks missing on multiple server functions.

- Add `can()` checks to all goal server functions (listGoals, getGoal, listStaffGoals)
- Add `can()` to inbox server functions (getUnreadCount, getInboxItemDetail, getInboxNotes)
- Add `can()` to dashboard, reply server functions
- Replace hardcoded role checks with `can()` calls
- Fix `getImportStatus` missing permission check
- Fix `listInvitations` wrong permission check
- Remove `owner/admin/member` hardcoded strings outside shared/auth

**Reviews hit:** R6, R9, R10, R16
**Files:** ~12 | **Risk:** High (security) | **Tests:** Must add forbidden-role tests

### Stream 3: Observability & Error Handling

Trace spans and structured logging gaps.

- Add OpenTelemetry spans to all Google API adapters (3)
- Add spans to S3 storage adapter
- Add root spans to all 9 background job handlers
- Add spans to event handlers
- Remove PII from email logs (2 locations)
- Add canonical span attributes to server functions
- Fix `IntegrationError` to use standard error shape

**Reviews hit:** R12, R13, R16
**Files:** ~20 | **Risk:** Low (non-breaking) | **Tests:** Existing tests must pass

### Stream 4: Type Safety & Branded Types

Systemic `as unknown as` pattern across codebase.

- Replace `as unknown as` force-casts with proper unbrand/brand utilities
- Add exhaustive `never` checks on discriminated union switches
- Add return type annotations to exported functions
- Fix raw `string` at application layer (portalId inputs)

**Reviews hit:** R14, R5
**Files:** ~10 | **Risk:** Medium (type system) | **Tests:** Must pass typecheck

### Stream 5: Cross-Context Boundaries

Coupling violations where contexts reach into each other's tables.

- Dashboard: replace direct Review/Metric table queries with context API calls
- Inbox: replace direct Review/Guest/Property table queries with context API calls
- Integration: replace direct Property table updates with context API calls
- Metric public API: stop exposing `metricRepo` in surface
- Event type imports: use `application/public-api` instead of `domain/events`

**Reviews hit:** R2, R1, R16
**Files:** ~10 | **Risk:** High (refactor) | **Tests:** Integration tests critical

### Stream 6: Test Coverage

Missing tests for security-critical paths.

- Add server function tests for inbox, reply, dashboard (forbidden roles)
- Add contract tests for external adapters (Google, S3)
- Fix inbox repo tests to test real tenant isolation
- Add tests for untested use cases (8 identified)

**Reviews hit:** R15, R6
**Files:** ~8 | **Risk:** Low (additive) | **Tests:** New tests must pass

### Stream 7: Documentation

CONTEXT.md and ADR gaps.

- Add Goal context CONTEXT.md
- Update root CONTEXT.md with Goal bounded context
- Update contexts/CONTEXT.md with Goal
- Index ADRs 0006, 0007 in root CONTEXT.md
- Update routes/CONTEXT.md with Goal routes
- Fix stale event name (`review.received` → `review.created`)

**Reviews hit:** R17, R16
**Files:** ~6 | **Risk:** None (docs only)

---

## Execution Approaches

### Option A: Sequential Streams (Recommended)

Work streams sequentially, each in a dedicated `delegate_task` session:

1. **Stream 1** → Domain purity (foundation)
2. **Stream 2** → Auth/permissions (security)
3. **Stream 5** → Cross-context boundaries (architecture)
4. **Stream 4** → Type safety
5. **Stream 3** → Observability
6. **Stream 6** → Tests
7. **Stream 7** → Docs

Each stream: read review → fix → run tests → commit.
**Pro:** Clean history, easy to review, low risk of merge conflicts.
**Con:** Slower (serial).

### Option B: Parallel Streams via delegate_task

Run up to 3 streams concurrently:

- Wave 1: Stream 1 + Stream 2 + Stream 7 (independent)
- Wave 2: Stream 5 + Stream 4 + Stream 3
- Wave 3: Stream 6

**Pro:** 2-3x faster.
**Con:** Merge conflicts possible, harder to review, Stream 5 depends on Stream 1.

### Option C: Cron-Based Multi-Session

Create a cron job for each stream, chained via `context_from`:

- Stream 1 runs, outputs summary
- Stream 2 picks up Stream 1's output, continues
- etc.

**Pro:** Survives interruptions, fully async.
**Con:** Overhead per session, no interactivity.

---

## Recommendation

**Option A (Sequential)** for Streams 1-2 (domain + auth = must be correct).
**Option B (Parallel)** for Streams 3-7 once foundation is solid.

Rationale: Streams 1 and 2 fix foundational issues that Streams 3-5 reference. Getting those right first prevents rework. Streams 3-7 are more independent and can run in parallel.
