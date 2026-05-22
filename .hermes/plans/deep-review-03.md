# Deep Review #3 — Domain Layer Purity Fix Plan

## Scope
Fix relevant findings across all 11 contexts (7 BLOCKER-equivalent, 3 MAJOR, 2 MINOR).

Wontfix: equals() methods (idiomatic for Readonly types), anemic entities in read-models (low ROI),
convenience re-exports from domain/types.ts.

## Tasks

### Priority 1: Brand all raw string IDs in domain types/events

**dashboard/domain/types.ts** — `RecentReview.id: string` → `ReviewId`
**guest/domain/events.ts** — `linkId: string` → `PortalLinkId`
**inbox/domain/events.ts** — `sourceId: string` → `ReviewId | FeedbackId`
**identity/domain/events.ts** — `invitationId: string` → add `InvitationId` branded type
**integration/domain/types.ts** — `GbpCacheEntry.id: string` → add `GbpCacheEntryId`
**portal/domain/events.ts** — `categoryId: string`, `linkId: string` → branded types
**portal/domain/types.ts** — `entityId: string` → typed union

### Priority 2: Fix new Error() in integration domain
- `integration/domain/errors.ts` — use `createErrorFactory`
- `integration/domain/gbp-api-error.ts` — use pure tagged record

### Priority 3: Quick fixes
- `integration/domain/constructors.ts` — use `isValidEmail()` from rules
- Move `validateSlug` to `shared/domain/slug.ts` (alongside `normalizeSlug`)
- Add `transitionReply()` domain function that produces new Reply

## Execution
Batch all priority 1 (branded IDs) in one subagent pass.
Then priority 2 + 3 in a second pass.
