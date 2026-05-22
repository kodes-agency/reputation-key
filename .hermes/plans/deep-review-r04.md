# Deep Review r04 — Application / Use Case Layer

**Status:** Completed  
**Date:** 2026-05-22  
**Scope:** All bounded contexts' `application/use-cases/` directories  

## Findings

### 1. [MAJOR] getLogger() called directly instead of injected logger in 4 use cases

**Triage: relevant** — application layer should not import `getLogger()` directly per the rule "use case calling fetch, opening a connection, reading env vars, or logging via console". getLogger() is a singleton import; logging should be via injected logger port or passed deps.

Files:
- `src/contexts/review/application/use-cases/sync-reviews.ts:28,152`
- `src/contexts/integration/application/use-cases/import-property.ts:20,94`
- `src/contexts/integration/application/use-cases/handle-gbp-notification.ts:7,29`
- `src/contexts/integration/application/use-cases/disconnect-google-account.ts:16,58`
- `src/contexts/inbox/application/use-cases/create-inbox-item.ts:19,87`
- `src/contexts/inbox/application/use-cases/get-unread-count.ts:10,31`

Rule: Application layer should not reach into shared infrastructure singletons. Contexts CONTEXT.md: "application/ imports from domain/, shared/domain/, shared/events/" — getLogger comes from shared/observability which is not listed as an allowed import.

Fix: Add `logger` to the deps type of each use case and pass it from the composition root.

---

### 2. [MAJOR] `createHash` from `crypto` imported directly in import-property.ts

**Triage: relevant** — Application layer importing Node.js `crypto` directly violates layer purity. The hash generation should be through an injected port or at minimum the dependency should be injected.

File: `src/contexts/integration/application/use-cases/import-property.ts:19`
```ts
import { createHash } from 'crypto'
```

Rule: Application layer must not contain framework/infrastructure code. `crypto` is a Node.js built-in.

Fix: Inject a `slugGenerator` function into deps, or move the slug generation logic to the domain layer.

---

### 3. [MAJOR] `crypto.randomUUID()` called directly in 2 use cases instead of injected idGen

**Triage: relevant** — Use cases should use injected ID generators, not `crypto.randomUUID()` directly.

Files:
- `src/contexts/integration/application/use-cases/connect-google-account.ts:88`
  ```ts
  const connectionId = googleConnectionId(crypto.randomUUID())
  ```
- `src/contexts/integration/application/use-cases/start-property-import.ts:57`
  ```ts
  const importJobId = gbpImportJobId(crypto.randomUUID())
  ```

Rule: Per CONTEXT.md use case shape, IDs should come through injected `idGen` functions, not generated inline.

Fix: Add `idGen: () => GoogleConnectionId` and `idGen: () => GbpImportJobId` to respective deps.

---

### 4. [MAJOR] Missing test files for 7 use cases

**Triage: relevant** — Use cases without test coverage.

Files without tests:
- `src/contexts/identity/application/use-cases/request-avatar-upload.ts`
- `src/contexts/identity/application/use-cases/finalize-avatar-upload.ts`
- `src/contexts/identity/application/use-cases/request-org-logo-upload.ts`
- `src/contexts/identity/application/use-cases/finalize-org-logo-upload.ts`
- `src/contexts/identity/application/use-cases/update-organization.ts`
- `src/contexts/integration/application/use-cases/handle-gbp-notification.ts`
- `src/contexts/integration/application/use-cases/import-property.ts`

Rule: "Missing test file colocated next to the use case" is MAJOR.

Fix: Add unit tests with in-memory port fakes for each.

---

### 5. [MINOR] No test for 5 thin/delegating use cases

**Triage: wontfix** — These are thin delegation or query-only use cases where the risk is low:
- `src/contexts/portal/application/use-cases/get-portal-qr-url.ts` — URL builder, no side effects
- `src/contexts/guest/application/use-cases/get-public-portal.ts` — thin query
- `src/contexts/guest/application/use-cases/resolve-portal-context.ts` — pure resolver
- `src/contexts/guest/application/use-cases/resolve-link-and-track.ts` — composing two other use cases
- `src/contexts/integration/application/use-cases/index.ts` — barrel file, not a use case

---

### 6. [MAJOR] Silent catches in inbox and guest use cases

**Triage: wontfix** — These are intentional: the counter/cache operations are marked non-critical with DB as source of truth. The catches do log via getLogger(). This is an acceptable trade-off documented in the code.

Files:
- `src/contexts/inbox/application/use-cases/update-inbox-status.ts:90` — counter decrement, logged
- `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts:55,106` — counter ops, non-critical
- `src/contexts/inbox/application/use-cases/create-inbox-item.ts:85` — counter increment, logged
- `src/contexts/inbox/application/use-cases/get-unread-count.ts:42` — cache warm, non-critical
- `src/contexts/guest/application/use-cases/record-scan.ts:49` — analytics scan, explicitly documented as non-critical
- `src/contexts/guest/application/use-cases/track-review-link-click.ts:31` — analytics, same pattern

---

### 7. [MINOR] hasRole() used for property-access scoping in inbox use cases

**Triage: wontfix** — The inbox use cases use `hasRole(input.role, ADMIN_ROLE)` to decide whether to check staff assignments. This is a legitimate hierarchy decision (admin has access to all properties; non-admin needs assignment check). CONTEXT.md explicitly allows `hasRole` for "domain hierarchy rules" which is what this is — checking whether the user is above the PropertyManager tier.

---

### 8. [MAJOR] reply-operations.ts takes `role` + `userId` individually instead of `AuthContext`

**Triage: outdated-doc** — The review use cases use a flat input type `{ reviewId, organizationId, userId, role }` rather than `AuthContext`. This is intentional because: (a) the reply operations don't need the full AuthContext, (b) the server function layer destructures AuthContext into these fields when calling the use case, (c) some reply operations (markReplyPublished, markReplyPublishFailed) don't take auth at all since they're called by background jobs. The flat input pattern is consistent across review context.

---

### 9. [MAJOR] handle-gbp-notification.ts imports from review context's public-api

**Triage: wontfix** — `handle-gbp-notification.ts:6` imports `ReviewQueuePort` from `#/contexts/review/application/public-api`. This is the documented exception: cross-context communication through public API is allowed.

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 4     |
| MINOR    | 2     |
| NIT      | 0     |

**Top priority:** Add `logger` to deps and inject from composition root in the 6 use cases that call `getLogger()` directly. This is the most impactful fix because it removes a hidden singleton dependency from the application layer.

**Relevant findings to fix:**
1. getLogger() direct imports in application layer (6 files)
2. createHash crypto import in import-property.ts
3. crypto.randomUUID() direct calls in connect-google-account.ts and start-property-import.ts
4. Missing tests for 7 use cases
