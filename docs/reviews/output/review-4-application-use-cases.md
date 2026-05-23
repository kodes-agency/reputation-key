# Review #4: Application / Use Case Layer

**Date:** 2026-05-23
**Scope:** All `application/use-cases/` directories under `src/contexts/` (12 bounded contexts)

---

## BLOCKER Findings

### B1. Direct `pino.Logger` dependency in 9 use cases

The application layer depends on the concrete `pino` logger instead of an application-defined logging port. `import type { Logger } from 'pino'` couples use cases to an infrastructure library.

**Affected files:**

- `inbox/application/use-cases/create-inbox-item.ts`
- `inbox/application/use-cases/update-inbox-status.ts`
- `inbox/application/use-cases/get-unread-count.ts`
- `inbox/application/use-cases/bulk-update-inbox-status.ts`
- `integration/application/use-cases/handle-gbp-notification.ts`
- `integration/application/use-cases/import-property.ts`
- `integration/application/use-cases/disconnect-google-account.ts`
- `integration/application/use-cases/list-gbp-locations.ts`
- `review/application/use-cases/sync-reviews.ts`

**Fix:** Define a `LoggerPort` in `shared/` or in each context's `application/ports/`, inject it via deps, and let infrastructure provide the pino adapter.

### B2. Direct Node.js `crypto` usage in 4 use cases

Use cases import `randomUUID` or `createHash` from the `crypto` built-in instead of going through injected `idGen` deps or a hashing port.

**Affected files:**

- `identity/application/use-cases/request-avatar-upload.ts` — `randomUUID` from `crypto`
- `identity/application/use-cases/request-org-logo-upload.ts` — `randomUUID` from `crypto`
- `portal/application/use-cases/request-upload-url.ts` — `randomUUID` from `crypto`
- `integration/application/use-cases/import-property.ts` — `createHash` from `crypto`

**Fix:** Pass `idGen` / `hashGen` via deps (the pattern already used elsewhere, e.g. `sync-reviews.ts` has `idGen`).

---

## MAJOR Findings

### M1. Missing tests for 8 use cases

CONTEXT.md requires "Every use case tested for happy + error paths." The following have no test file at all:

| Use Case                   | Context  |
| -------------------------- | -------- |
| `request-avatar-upload`    | identity |
| `finalize-avatar-upload`   | identity |
| `request-org-logo-upload`  | identity |
| `finalize-org-logo-upload` | identity |
| `get-public-portal`        | guest    |
| `resolve-link-and-track`   | guest    |
| `resolve-portal-context`   | guest    |
| `list-portal-links`        | portal   |

### M2. Implicit transactions with multiple writes

- **`sync-reviews`** (review) — In the per-review loop: upserts review, then calls `mirrorReply` which does another upsert/delete, then emits an event. No transaction boundary. A failure between review upsert and reply mirror leaves inconsistent state.
- **`create-inbox-item`** (inbox) — Creates inbox item, increments unread counter, then emits event. Three side-effecting operations with no transaction. The unread counter catch is non-fatal but the counter could drift.
- **`import-property`** (integration) — Marks job in-progress, then loops over locations doing insertProperty + incrementImported per location, then finalizes status. Multiple writes with no transaction boundary.
- **`disconnect-google-account`** (integration) — Updates status, purges cache, then emits event. Multiple writes without transaction.
- **`approveReply`** (review) — Upserts reply and then enqueues a publish job. No transaction boundary.

### M3. `reply-operations.ts` bundles 8+ use cases in a single file

File contains `draftReply`, `submitReply`, `approveReply`, `rejectReply`, `deleteReply`, `getReply`, `markReplyPublished`, `markReplyPublishFailed`, `retryPublish` — nine exported use cases. While they share `ReplyDeps`, the file at 380 lines is a cohesion magnet. Individual use case files would improve discoverability and reviewability. The file name `reply-operations` also does not follow VerbNoun convention (though the individual functions do).

### M4. `sync-reviews` does multiple conceptual things

This use case fetches reviews from Google, upserts each one, mirrors reply state, and emits events — all within a single function. It does >1 conceptual thing (sync reviews + sync replies) without composition or delegation to smaller use cases.

---

## MINOR Findings

### m1. `getDashboardData` has no authorization step

Comment says "Authorization is enforced at the router/loader level." While this may be acceptable for a read-model context, it deviates from the standard use case pattern where auth is step 1. This is a known architectural trade-off for dashboard/read-model use cases.

### m2. `connectGoogleAccount` calls `crypto.randomUUID()` directly

Even though other use cases properly inject `idGen`, this one calls `crypto.randomUUID()` inline (wrapping it with `googleConnectionId()`) instead of using a deps-injected `idGen`. Should use the injected pattern for consistency.

### m3. `get-public-portal` returns raw domain/lookup result

The use case returns whatever `publicPortalLookup.findBySlug` returns without mapping through an output DTO. Whether this is a domain type or a view-model depends on the port contract — should be verified.

---

## Use Case Inventory

**Total use cases found:** 71 (excluding `index.ts` barrel files)
**Total test files found:** 72 (includes 1 integration test)

| Context     | Use Cases                 | Tests              | Ports                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dashboard   | 1                         | 1                  | dashboard.repository                                                                                                                                                                                                                                                   |
| goal        | 5                         | 5                  | goal.repository                                                                                                                                                                                                                                                        |
| guest       | 8                         | 5 (+1 integration) | guest-interaction.repository, portal-context-resolver.port, public-portal-lookup.port                                                                                                                                                                                  |
| identity    | 9                         | 7                  | identity.port                                                                                                                                                                                                                                                          |
| inbox       | 9                         | 9                  | inbox.repository, inbox-note.repository, unread-counter.port                                                                                                                                                                                                           |
| integration | 10                        | 10                 | google-connection.repository, google-oauth.port, token-encryption.port, gbp-api.port, gbp-cache.repository, gbp-import.repository, gbp-queue.port, property-event.port, property-fk-cleanup.port, property-import-repo.port, property-lookup.port, property-query.port |
| metric      | 1                         | 1                  | metric.repository                                                                                                                                                                                                                                                      |
| portal      | 15                        | 14                 | portal.repository, portal-link.repository, link-resolver.port, storage.port                                                                                                                                                                                            |
| property    | 5                         | 5                  | property.repository                                                                                                                                                                                                                                                    |
| review      | 2 files (10 exported fns) | 2                  | review.repository, reply.repository, google-review-api.port, reply-queue.port, review-queue.port                                                                                                                                                                       |
| staff       | 4                         | 4                  | staff-assignment.repository                                                                                                                                                                                                                                            |
| team        | 5                         | 5                  | team.repository                                                                                                                                                                                                                                                        |

### Port → Implementation verification

All ports have corresponding infrastructure implementations wired in `src/composition.ts` or per-context `build.ts` files. No orphaned ports found. Cross-context wiring (e.g., `googleReviewApi` adapter in integration implementing review context port) is properly handled in the composition root.

---

## Summary

Across 12 bounded contexts, 71 use cases were reviewed. **2 BLOCKER categories** were found: 9 use cases directly import `pino.Logger` instead of a logging port, and 4 use cases import Node.js `crypto` directly. **4 MAJOR categories** include 8 untested use cases, 5 use cases with implicit multi-write transactions, a 380-line file bundling 9 reply use cases, and `sync-reviews` performing multiple conceptual operations. **Top priority fix** is extracting a `LoggerPort` abstraction — it affects the most files (9) and is the most mechanically straightforward change.
