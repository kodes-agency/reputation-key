# Round 3 Fix Plan — 56 findings → 0

## Streams

### Stream Z: MAJOR — Arch + Doc Fixes (5)

- **Z1:** handle-gbp-notification imports from internal-ports — move to public-api
- **Z2:** Add Permissions section to identity CONTEXT.md
- **Z3:** Add Permissions section to team CONTEXT.md
- **Z4:** Remove 5 TODO comments from shared production code
- **Z5:** goal/ui/helpers.ts — redirect DTO imports through public-api

### Stream AA: MAJOR — Permission-denied tests (20 use cases)

- Write a forbidden/denied test for each of 20 can()-guarded use cases that lacks one

### Stream AB: MAJOR — Untested server functions (2)

- **AB1:** Add tests for inbox/server/inbox.ts
- **AB2:** Add tests for review/server/reply.ts

### Stream AC: MINOR — Remaining gaps (19)

- **AC1:** 3 untested event handlers (on-review-updated, on-feedback-submitted, on-review-created)
- **AC2:** 15 happy-path-only test files — add at least one error-path test
- **AC3:** 1 untested use case (list-portal-links)

### Stream AD: NIT (5)

- **AD1:** Orphan integration test file naming
- **AD2:** 4 `as any` in test files
