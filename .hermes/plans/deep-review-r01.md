# Deep Review r01 — Architecture & Layering

## Findings

### 1. [MAJOR] Cross-context domain import in import-property.job.ts
- **File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts:12`
- **Quote:** `import { normalizeSlug } from '#/contexts/property/domain/rules'`
- **Rule:** Rule 5 — Cross-context calls must go through published application API. Never reach into another context's `domain/`.
- **Fix:** Import `normalizeSlug` from `#/shared/domain/slug` or `#/shared/domain` where it already lives (re-exported from property/domain/rules.ts).

### 2. [MAJOR] Cross-context port import not through public-api
- **File:** `src/contexts/integration/application/use-cases/handle-gbp-notification.ts:6`
- **Quote:** `import type { ReviewQueuePort } from '#/contexts/review/application/ports/review-queue.port'`
- **Rule:** CONTEXT.md dependency rules — "Cross-context: import from `application/public-api` only."
- **Fix:** Export `ReviewQueuePort` from `review/application/public-api.ts` and update the import.

### 3. [WONTFIX] Inline DB query in composition.ts for propertyLookup
- **File:** `src/composition.ts:193-206`
- **Rule:** Cross-context reads should go through the owning context's application layer.
- **Rationale:** The composition root is the wiring layer. This is a pragmatic port implementation for a webhook that has no auth context (push-based from Google). The property context doesn't expose a `findByGbpPlaceId` without auth. Documented with an inline comment.

## Implementation

- [x] Fix #1: Change import in import-property.job.ts
- [x] Fix #2: Export ReviewQueuePort from review public-api, update import in handle-gbp-notification.ts
- [x] Verify no type errors
