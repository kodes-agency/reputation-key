# Review 5 — Infrastructure Adapters

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Findings

### [MAJOR] Adapters missing trace spans on significant operations

The following adapters perform DB queries or external calls without `trace()` wrappers:

- `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` — 0 trace calls (wraps better-auth)
- `src/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter.ts` — 0 trace calls (DB queries)
- `src/contexts/inbox/infrastructure/adapters/property-lookup.adapter.ts` — 0 trace calls (DB queries)
- `src/contexts/inbox/infrastructure/adapters/review-lookup.adapter.ts` — 0 trace calls (DB queries)
- `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts` — 0 trace calls (Redis ops)
- `src/contexts/integration/infrastructure/adapters/property-event.adapter.ts` — 0 trace calls (event emission)
- `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts` — 0 trace calls (crypto ops)

Rule: CONTEXT.md requires trace spans on significant operations (DB queries, external API calls).
Fix: Wrap each adapter method body in `trace('context.adapter.method', async () => { ... })`.

### [MAJOR] Infrastructure adapter imports from server framework

File: `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:18`
Quote:

```
import { getRequest } from '@tanstack/react-start/server'
```

Rule: Infrastructure must not import server-layer dependencies.
Fix: Extract the request resolution into a port or pass request context as a parameter.

### [MINOR] `better-auth-schemas.ts` has no port interface

File: `src/contexts/identity/infrastructure/adapters/better-auth-schemas.ts`
This file is a schema definition rather than an adapter implementing a port. Acceptable for thin identity context, but should be documented as an exception.

### Checks passed

- **All repository implementations** import and use port interfaces from `application/ports/` ✅
- **Event handlers** subscribe via EventBus port, not directly to BullMQ ✅
- **External API adapters** (Google OAuth, GBP API, S3, Google Review API) all implement port interfaces ✅
- **No business logic** in infrastructure files ✅
- **All repository implementations** have trace spans ✅
- **Dashboard adapters** (metric-stats, review-stats) have trace spans ✅
- **Integration adapters** (gbp-api, google-oauth, google-review-api, s3-storage) have trace spans ✅

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 1     |
| NIT      | 0     |

**Most important thing to fix first:** Add trace spans to the inbox lookup adapters and redis-unread-counter — these are called on every inbox request.
