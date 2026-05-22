# Deep Review r17 — ADR & Documentation Compliance

## ADR Compliance Table

| ADR | Title | Status | Code Compliant |
|-----|-------|--------|---------------|
| 0001 | Dynamic Access Control via Better-auth | Implemented | ✅ Yes — `can()` used in server functions, `usePermissions()` in components, `hasRole()` only for hierarchy, no double-mapping |
| 0002 | Section-Based Navigation | Proposed | ✅ Yes — distinct Manager/Staff sidebars in `_authenticated.tsx`, section-based routing |
| 0003 | Review as Separate BC | Proposed | ✅ Yes — separate `review` context, `GoogleReviewApiPort` facade, event-driven sync, BullMQ jobs |
| 0004 | Inbox as Separate BC | Proposed | ✅ Yes — separate `inbox` context, status workflow `new→read→addressed→archived`, `escalated` sidetrack, notes, assignment, Redis unread counter |
| 0005 | GBP Review API Path Fix | Accepted | ✅ Yes — v4 API base URL, `recoverable` flag on integration errors, `gbpLocationName` enriched at import time |

## Findings

### MINOR

**N1: Root CONTEXT.md bounded-contexts table formatting inconsistent**

Rows had mixed `||` vs `|` prefix. Fixed.

### No BLOCKER or MAJOR findings

All ADRs are reflected in code. No contradictions between CONTEXT.md files. All Key Files entries resolve.

## Doc Edits Required

- ✅ Fixed: Root CONTEXT.md bounded contexts table formatting (was inconsistent)
- No other doc edits needed

## Triage

- N1 → **relevant** — fixed in this review
