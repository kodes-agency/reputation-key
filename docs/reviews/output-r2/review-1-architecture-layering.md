# Review 1: Architecture & Layering

**Date:** 2026-05-23  
**Scope:** All 12 bounded contexts — domain/, application/, infrastructure/, server/  
**Reviewer:** Automated code review (R2 re-review)

## Summary

The codebase broadly follows the hexagonal dependency rule (`server → application → domain`, `infrastructure` implements ports). Most contexts adhere well. Findings include: one cross-context port import bypass (guest→staff port), one `ui/` folder importing domain types directly, one infrastructure file importing `getContainer()` from composition root, one infrastructure adapter importing a TanStack framework module, and the dashboard repo querying other contexts' database tables directly (documented ADR exception). Layer purity is strong overall — domain has no framework/async leaks, application stays within bounds, and server files are thin orchestrators.

## Findings

### [MAJOR] guest/build.ts imports staff repository port directly (not via public-api)

File: src/contexts/guest/build.ts:4
Quote:

```ts
import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
```

Rule: Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`.
Fix: Export the `StaffAssignmentRepository` type from `staff/application/public-api.ts` and import from there instead.

### [MAJOR] goal/ui/helpers.ts imports from goal/domain/types directly

File: src/contexts/goal/ui/helpers.ts:6
Quote:

```ts
import type { Goal, GoalStatus } from '#/contexts/goal/domain/types'
```

Rule: The `ui/` folder sits alongside domain/application/infrastructure/server. UI helpers should import from `application/dto` re-exports, not domain directly. This creates a coupling path from UI → domain that bypasses the application layer.
Fix: Import `Goal` and `GoalStatus` from `goal/application/dto/goal.dto.ts` which already re-exports these types.

### [MAJOR] integration/infrastructure/handlers/gbp-notification-handler.ts imports getContainer()

File: src/contexts/integration/infrastructure/handlers/gbp-notification-handler.ts:7
Quote:

```ts
import { getContainer } from '#/composition'
```

Rule: Infrastructure should not import from the composition root. Only `composition.ts` wires adapters to ports. Infrastructure handlers should receive their dependencies as function arguments (factory pattern).
Fix: Refactor to accept use case / repo as a parameter rather than calling `getContainer()` directly. The handler should be a factory function with deps injected.

### [MINOR] identity/infrastructure/adapters/auth-identity.adapter.ts imports TanStack framework

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:18
Quote:

```ts
import { getRequest } from '@tanstack/react-start/server'
```

Rule: Infrastructure layer Forbidden: "HTTP routing, React". While `getRequest` is server-side (not React), it still couples the infrastructure adapter to the TanStack framework. The adapter should receive headers via its port interface.
Fix: Pass headers through the port method signature instead of using `getRequest()` inside the adapter. The composition root or server layer can extract headers and pass them down.

### [NIT] dashboard/infrastructure/repositories/dashboard.repository.ts queries review/reply/metric tables directly

File: src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts:19
Quote:

```ts
import { reviews, replies, metricReadings } from '#/shared/db/schema'
```

Rule: Dashboard is a "read-only aggregation" context. Per ADR 0007, it is architecturally permitted to read from shared DB schemas as a read model. This is a documented exception, not a violation.
Fix: No fix needed — this is acceptable per ADR 0007. The shared schema module acts as the integration point for this read-only context.

### [NIT] goal/application/dto/goal.dto.ts re-exports domain types for UI

File: src/contexts/goal/application/dto/goal.dto.ts:bottom
Quote:

```ts
export type { Goal, GoalProgress, GoalType, GoalStatus } from '../../domain/types'
export { deriveEntityScope } from '../../domain/types'
```

Rule: This is the correct pattern for exposing domain types to the UI layer through the application boundary. Not a violation.
Fix: No fix needed.

### [NIT] guest/build.ts imports portal public-api (correct cross-context pattern)

File: src/contexts/guest/build.ts:4
Quote:

```ts
import type { LinkResolverPort } from '#/contexts/portal/application/public-api'
```

Rule: This is the correct cross-context import pattern — via `application/public-api.ts`.
Fix: No fix needed.

## Severity Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 3     |
| MINOR     | 1     |
| NIT       | 3     |
| **Total** | **7** |
