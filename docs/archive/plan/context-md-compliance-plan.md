# CONTEXT.md Compliance Plan

**Date:** 2026-06-03
**Scope:** Bring all 13 `src/contexts/<name>/CONTEXT.md` files to full §4 compliance per `docs/standards.md`.
**Baseline:** Audit run 2026-06-03 — 7 of 13 fully compliant.

---

## Gap Summary

| Context     | Missing Sections                    | Count |
| ----------- | ----------------------------------- | ----- |
| activity    | RL, INV, EP, EC, AL, UC, PA, SF, PE | 8     |
| dashboard   | RL, EP, EC                          | 3     |
| guest       | GL, INV, PE                         | 3     |
| identity    | UC, SF                              | 2     |
| integration | GL, INV                             | 2     |
| metric      | SF, PE                              | 2     |
| review      | RL                                  | 1     |
| staff       | UC                                  | 1     |
| goal        | —                                   | 0 ✅  |
| inbox       | —                                   | 0 ✅  |
| portal      | —                                   | 0 ✅  |
| property    | —                                   | 0 ✅  |
| team        | —                                   | 0 ✅  |

---

## Required Sections (per §4.1)

| #   | Section             | Content                                         |
| --- | ------------------- | ----------------------------------------------- |
| 1   | Bounded context     | One sentence: what this context does            |
| 2   | Glossary            | Terms defined here, markdown table              |
| 3   | Relationships       | Entity relationships (within + cross-context)   |
| 4   | Invariants          | Rules that must always hold                     |
| 5   | Events produced     | Table: `_tag` → payload fields → when emitted   |
| 6   | Events consumed     | Table: `_tag` → source context → handler action |
| 7   | Architecture layers | Directory tree (standard format)                |
| 8   | Use cases           | Table: name → input → output → permission       |
| 9   | Public API          | Exported types, functions, port interfaces      |
| 10  | Server functions    | Table: name → method → permission → route       |
| 11  | Permissions         | Role × permission matrix                        |

---

## Phase 1: Single-section fixes (lowest effort first)

### 1.1 review — Add Relationships (§4 RL)

**Source:** Domain types in `review/domain/types.ts`, event files, entity model.
**Content needed:**

- Review → Reply (1:N)
- Review → Property (N:1, via propertyId)
- Cross-context: Review listens to `property.created`, `property.deleted`

### 1.2 staff — Add Use cases (§4 UC)

**Source:** `staff/application/use-cases/` (3 files: create, list, remove)
**Content needed:** Table with createStaffAssignment, listStaffAssignments, removeStaffAssignment

---

## Phase 2: Two-section fixes

### 2.1 identity — Add Use cases (§4 UC) + Server functions (§4 SF)

**Source UC:** `identity/application/use-cases/` (12 files excluding tests)
**Source SF:** `identity/server/` (organizations.ts, auth-settings.ts)

### 2.2 integration — Add Glossary (§4 GL) + Invariants (§4 INV)

**Source GL:** `integration/domain/types.ts` — GoogleConnection, GbpLocation, GbpImportJob, etc.
**Source INV:** Domain rules, event handlers, use case guards

### 2.3 metric — Add Server functions (§4 SF) + Permissions (§4 PE)

**Source SF:** `metric/server/` — check if server functions exist
**Source PE:** Permission model from `shared/domain/permissions`

---

## Phase 3: Three-section fixes

### 3.1 dashboard — Add Relationships (§4 RL) + Events produced (§4 EP) + Events consumed (§4 EC)

**Source RL:** Dashboard aggregates from review + metric + portal contexts
**Source EP:** Does dashboard emit events? (likely no — check domain/events.ts)
**Source EC:** Dashboard consumes `review.created`, `metric.recorded`, etc.

### 3.2 guest — Add Glossary (§4 GL) + Invariants (§4 INV) + Permissions (§4 PE)

**Source GL:** GuestInteraction, Scan, Rating, Feedback — from `guest/domain/types.ts`
**Source INV:** Rating uniqueness, feedback rules
**Source PE:** Public access patterns (guest context serves public portals)

---

## Phase 4: Near-full rewrite

### 4.1 activity — Add all 8 missing sections

**Context:** Activity is the audit log context. It consumes events from all other contexts via BullMQ.
**Strategy:**

- RL: ActivityLog → Organization (N:1), ActivityLog → Property (N:1)
- INV: Idempotency (dedup key), at-least-once delivery
- EP: Does activity emit events? (check domain/events.ts)
- EC: Lists all consumed event tags from event handlers
- AL: Standard directory tree
- UC: If any use cases exist
- PA: `ActivityPublicApi` types
- SF: Server functions if any
- PE: Who can query activity logs

---

## Execution Order

1. **review** (1 section, ~5 min)
2. **staff** (1 section, ~5 min)
3. **metric** (2 sections, ~10 min)
4. **integration** (2 sections, ~10 min)
5. **identity** (2 sections, ~15 min)
6. **dashboard** (3 sections, ~15 min)
7. **guest** (3 sections, ~15 min)
8. **activity** (8 sections, ~30 min)

**Total estimated:** ~1.5 hours

---

## Verification

After all phases complete, run the §4 audit script:

```bash
for f in src/contexts/*/CONTEXT.md; do
  ctx=$(echo $f | cut -d/ -f3)
  for sec in "Bounded context" "Glossary" "Relationships" "Invariants" \
             "Events produced" "Events consumed" "Architecture layers" \
             "Use cases" "Public API" "Server functions" "Permissions"; do
    grep -q "^## $sec" "$f" || echo "$ctx: MISSING $sec"
  done
done
```

**Exit criteria:** Zero "MISSING" lines, zero tsc errors, all 1790 tests passing.
