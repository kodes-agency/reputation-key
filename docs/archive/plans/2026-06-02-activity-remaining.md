# Activity Context Remaining Work — Implementation Plan

**Hermes:** Use TDD where applicable. Frontend tasks skip TDD (visual verification).

---

## Task A: Wire `staffPublicApi` into activity queries

**Goal:** Enforce permission filtering on activity queries (Q11).

**Approach:** The inbox route already enforces access — activity queries add defense-in-depth.

### A.1 Update `getActivityTimeline`

- Add `staffPublicApi: StaffPublicApi` to `GetTimelineDeps`
- After fetching results, filter by accessible property IDs for non-admin roles
- Admin (`inbox.manage`) skips filtering; PM/Staff only see their properties
- Update `build.ts` to pass `staffPublicApi`
- Update `composition.ts` to pass `staff.publicApi`

**Files:** `queries/get-activity-timeline.ts`, `build.ts`, `composition.ts`

**TDD:** Add test file `queries/get-activity-timeline.test.ts` — test Admin sees all, Staff only sees accessible.

### A.2 Update `getOrgActivity`

- Same pattern — add `staffPublicApi`, filter by accessible properties
- Test: Admin vs PM vs Staff scoping

### A.3 Update `ActivityPublicApi` type

- Ensure signatures include `staffPublicApi` or auth context

---

## Task B: Wire actual `UserLookupPort`

**Goal:** Replace `defaultUserLookup` (always returns 'System') with real identity lookup.

**Approach:** Create adapter that wraps identity port's `getMember`.

### B.1 Create `IdentityUserLookupAdapter`

- `src/contexts/activity/infrastructure/adapters/identity-user-lookup.adapter.ts`
- Implements `UserLookupPort` using `IdentityPort.getMember`
- Needs `AuthContext` — get from `headersFromContext()` pattern

### B.2 Wire in `composition.ts`

- Pass `identityPort` to `buildActivityContext`
- Build function accepts `identityPort` + `authContext` factory
- Adapter resolves user name/avatar/role from identity context

### B.3 Create fallback adapter factory

- If identity lookup fails, fall back to 'System'
- Never crash on lookup failure

**TDD:** Test adapter with mock identity port.

---

## Task C: Generate + run DB migration

### C.1 Run drizzle-kit generate

```bash
pnpm drizzle-kit generate
```

Creates `drizzle/` migration file for `activity_log` table.

### C.2 Apply migration

```bash
pnpm drizzle-kit push
```

Or if using migrate:

```bash
pnpm drizzle-kit migrate
```

### C.3 Verify

- Check DB has `activity_log` table with correct schema
- Run integration test to verify insert + query works

---

## Task D: Frontend — Activity Timeline UI (ReUI)

**Goal:** Timeline component in inbox detail view showing activity events.

### D.1 Install ReUI Timeline

```bash
pnpm dlx shadcn@latest add @reui/c-timeline
```

This adds the timeline component from the ReUI registry to `src/components/ui/timeline.tsx`.

### D.2 Create server function `getActivityTimelineFn`

- `src/contexts/activity/server/activity.ts`
- Wraps `activityPublicApi.getActivityTimeline`
- Input: `resourceType: 'inbox_item'`, `resourceId`, `organizationId`
- Returns `ActivityLog[]`

### D.3 Create `InboxActivityTimeline` component

- `src/components/inbox/inbox-activity-timeline.tsx`
- Fetches activity timeline via the server function
- Renders ReUI timeline items:
  - Status changes: "Status changed from X to Y"
  - Assignments: "Assigned to User" / "Unassigned from User"
  - Notes: "Added note: ..."
  - Escalation: "Escalated from X"
  - Bulk changes: "Bulk status changed to X"
- Shows actor name, timestamp
- Loading skeleton, empty state

### D.4 Add to `InboxDetailContent`

- Insert `<InboxActivityTimeline>` between source content and status actions
- Pass `currentItem.id` as `resourceId`

### D.5 Visual verification

- `pnpm dev` → open inbox → select item → verify timeline renders

---

## Task E: Comprehensive Review Loop

### E.1 Full audit of new code

Run two parallel subagent reviews:

1. **Backend review** — `src/contexts/activity/` + event files
2. **Frontend review** — inbox timeline component + server function

### E.2 Review criteria

- Boundary violations (domain importing from infrastructure)
- Missing tests
- Type safety (any `any` types, missing null checks)
- Pattern consistency with existing contexts
- Decision alignment (Q7–Q16)
- Performance (N+1 queries, missing indexes)

### E.3 Fix plan → implement → re-review

If issues found, create fix plan, implement, re-review. Loop until clean.

---

## Execution Order

```
A (permission filtering) ──→ B (user lookup) ──→ C (migration)
                                                     ↓
D (frontend timeline) ←──────────────────────────────┘
         ↓
E (comprehensive review loop)
```

A and B can start in parallel. C is quick and independent. D needs C (migration applied).
