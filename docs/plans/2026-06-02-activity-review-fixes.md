# Activity Context — Comprehensive Review Fixes

**Review scope:** Every new file in `src/contexts/activity/` + all modified files.
**Baseline:** `src/contexts/CONTEXT.md`, `CONTEXT.md`, inbox `CONTEXT.md`
**Standard:** Must match established patterns with zero deviation.

---

## 🔴 Critical Pattern Violations (Must Fix)

### Fix 1: `createActivityLog` must return `Result`, never throw

**Violation:** Constructor throws `activityError` on invalid action. Pattern says "Domain Returns `Result<T, DomainError>`. Never throws." (contexts/CONTEXT.md:133)

**Fix:**

- Change return type from `ActivityLog` to `Result<ActivityLog, ActivityError>`
- Import `ok`, `err`, `Result` from `neverthrow`
- Return `err(activityError(...))` instead of `throw`
- Update all callers: `event-handlers/index.ts` must unwrap the Result
- Update tests: `constructors.test.ts` to expect Result not throw

**Files:** `domain/constructors.ts`, `infrastructure/event-handlers/index.ts`, `domain/constructors.test.ts`

### Fix 2: Event delivery should use queue, not inline

**Violation:** Activity writes execute inline via `eventBus.on()`. Pattern says "Durable work → enqueue BullMQ job, don't do inline." And inbox CONTEXT.md explicitly says "BullMQ-backed... jobQueue.add('log-activity', event)".

**Fix:** Two options:

- **A:** Wire BullMQ queue (heavy — needs queue definition, job handler, worker registration)
- **B:** Keep in-process but document the trade-off (faster, simpler, acceptable since event bus runs handlers in try/catch — if process crashes during handling, the event is lost from the bus but the original use case already committed. The risk is the handler crashing mid-write with partial data.)

**Recommendation:** **B for now** — the in-process pattern matches the metric context (same subscriber pattern). The documentation should be updated to reflect reality. The event bus already catches handler errors and logs them. If durability becomes required later, migrate to BullMQ per the documented intent.

**Files:** `src/contexts/inbox/CONTEXT.md` (update Q12, Q16), `src/contexts/activity/CONTEXT.md` (new — document the trade-off)

### Fix 3: Add idempotency to event handler

**Violation:** Handler doesn't check for duplicate events. At-least-once semantics mean events can fire multiple times.

**Fix:** Before inserting, check if an activity entry with the same `(resourceType, resourceId, action, createdAt)` already exists. If so, skip.

**Implementation:** Query repo for existing entry with same fields. If found, log and return. Add `findByFields` to repository port.

**Files:** `ports/activity-repository.port.ts`, `infrastructure/activity-repository.drizzle.ts`, `infrastructure/event-handlers/index.ts`

### Fix 4: Create `src/contexts/activity/CONTEXT.md`

Must document:

- Glossary: Activity Log, Activity Action, Action Grammar, Activity Timeline
- Architecture: Pure subscriber context, no use cases, event-driven writes, query-driven reads
- Permission model (Q11)
- Event delivery (Q12)
- Schema (Q13)
- Event mapping (Q14)
- Context location (Q15)
- Directory structure (Q16)
- Dependency rules
- Testing strategy

### Fix 5: Move `event-to-activity.test.ts` to `application/`

**Violation:** Test is in `domain/` but source is in `application/`. Colocation rule says test lives next to source.

**Fix:** `mv src/contexts/activity/domain/event-to-activity.test.ts src/contexts/activity/application/event-to-activity.test.ts`

---

## 🟡 Documentation Gaps (Must Fix)

### Fix 6: Update root `CONTEXT.md` bounded contexts table

Add row: `Activity | Activity log and audit trail | ActivityLog`

### Fix 7: Update `src/contexts/CONTEXT.md` bounded contexts table

Add row: `Activity | Activity log and audit trail | ActivityLog | Thin (subscriber)`

### Fix 8: Update inbox `CONTEXT.md` event names

Q14: Replace `reply.sent` with `reply.submitted`, `reply.approved`, `reply.rejected`, `reply.published`

---

## 🟢 Minor Improvements (Should Fix)

### Fix 9: Eliminate `ALLOWED_ACTIONS` duplication

The `ActivityAction` union type already defines valid actions. The constructor shouldn't duplicate this.

**Fix:** Remove `ALLOWED_ACTIONS` set. Instead, validate that the action is a known member of the union. Since TypeScript unions are compile-time only, use an array derived from the type manifest.

Simpler approach: keep the validation but add a comment that the set must stay in sync with the `ActivityAction` type. Add a test that asserts all `ActivityAction` values are in `ALLOWED_ACTIONS`.

### Fix 10: Add explicit idempotency key

The activity log is append-only with no unique constraint beyond primary key. Add a uniqueness check.

---

## Execution Order

```
Fix 1 (Result type) → Fix 3 (idempotency) → Fix 5 (test location) → Fix 2/8 (docs)
                                                                          ↓
Fix 4 (activity CONTEXT.md) ← Fix 6 (root CONTEXT.md) ← Fix 7 (contexts/CONTEXT.md)
                                                                          ↓
                                                                     Fix 9-10 (cleanup)
```

After all fixes: run full test suite, tsc --noEmit, eslint, then verify every file against CONTEXT.md patterns one more time.
