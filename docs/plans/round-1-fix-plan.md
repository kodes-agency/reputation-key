# Round 1 Fix Plan — 43 findings → 0

> **For Hermes:** Execute via subagent-driven-development. Streams in parallel where possible.

## Streams

### Stream M: BLOCKER — Token Exposure (1 finding)

- **M1:** Create GoogleConnectionDto (strip tokens), use in public-api

### Stream N: MAJOR — Permissions (6 findings)

- **N1:** getPortal: portal.update → portal.read
- **N2:** getReply: align server+use-case permission
- **N3:** listPortals + listPortalLinks: add portal.read
- **N4:** listProperties + getProperty: add property.read
- **N5:** listStaffAssignments: add staff_assignment.read
- **N6:** ADR-0001: update goal.write → goal.create/update/cancel

### Stream O: MAJOR — Duplicate Types (3 findings)

- **O1:** Rename duplicate GoalWithProgress
- **O2:** Consolidate CreateGoalInput/UpdateGoalInput/CancelGoalInput to dto file
- **O3:** Rename JOB_NAME exports (reconcile vs spawn)

### Stream P: MINOR — Docs + Sloppy Patterns (10 findings)

- **P1:** Complete review CONTEXT.md
- **P2:** Create CONTEXT.md for metric, portal, property, team
- **P3:** Complete integration + guest CONTEXT.md
- **P4:** Fix staff CONTEXT.md (build.ts, event re-exports)
- **P5:** Remove dead export computeProgressValue
- **P6:** Fix local EventBus type duplication in on-metric-recorded
- **P7:** Non-null assertion guards on jobQueue
- **P8:** Hardcoded job name strings → constants
- **P9:** Team public-api: remove TeamRepository export
- **P10:** Review public-api: move raw port exports to internal barrel

### Stream Q: MINOR — Permission Patterns (5 findings)

- **Q1:** Document permission check pattern in root CONTEXT.md
- **Q2:** Comment cross-context permission usage in integration use cases
- **Q3:** getActiveOrganization: fix dashboard.read proxy permission
- **Q4:** Note goal ui/helpers deviation in CONTEXT.md
- **Q5:** Document identity uses use-case-only pattern
