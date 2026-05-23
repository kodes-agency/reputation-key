# Review 5: Infrastructure Adapters

**Date:** 2026-05-23  
**Scope:** All `infrastructure/` folders across all 12 bounded contexts  
**Reviewer:** Automated code review (R2 re-review)

## Summary

Infrastructure adapters are well-implemented overall. All repository adapters implement their corresponding port interfaces correctly. SQL queries are properly tenant-scoped with `organizationId` filters. No secrets were found at module scope. Dependency injection is clean — adapters receive dependencies through constructor functions. Key findings: one infrastructure handler imports from the composition root (`getContainer()`), one adapter imports a TanStack framework module, one adapter has response-validation helper code that could leak tech details into return types, and the GBP notification handler couples infrastructure to the DI container.

## Findings

### [MAJOR] integration/infrastructure/handlers/gbp-notification-handler.ts calls getContainer()

File: src/contexts/integration/infrastructure/handlers/gbp-notification-handler.ts:7
Quote:

```ts
import { getContainer } from '#/composition'

// Inside handler:
const container = getContainer()
const useCase = container.resolve('processGbpNotification')
```

Rule: Infrastructure should not import from the composition root. This creates a circular dependency path and couples the handler to the DI container implementation. Infrastructure handlers should receive use cases as function parameters.
Fix: Refactor to a factory pattern: `export function createGbpNotificationHandler(deps: { processGbpNotification: ProcessGbpNotificationUseCase })`. Wire in `composition.ts` or `build.ts`.

### [MINOR] identity/infrastructure/adapters/auth-identity.adapter.ts uses TanStack getRequest()

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:18
Quote:

```ts
import { getRequest } from '@tanstack/react-start/server'

// Inside adapter method:
const request = getRequest()
const headers = request.headers
```

Rule: Infrastructure adapters should not couple to web framework internals. The adapter's port interface should accept headers as a parameter rather than extracting them from a framework-specific request object.
Fix: Add `headers: Record<string, string>` to the port method signature. Have the server layer extract headers and pass them through. Remove the TanStack import from the adapter.

### [MINOR] identity/infrastructure/adapters/better-auth-schemas.ts — response validation helpers not behind a port

File: src/contexts/identity/infrastructure/adapters/better-auth-schemas.ts:1
Quote:

```ts
// Zod schemas for validating better-auth API responses
// These are infrastructure-internal helpers, not a port implementation
export const sessionSchema = z.object({ ... })
```

Rule: "Adapters not implementing port interfaces." This file is a helper used by `auth-identity.adapter.ts`, not a standalone adapter. It doesn't implement a port, but it's also not leaked outside infrastructure.
Fix: No fix needed — this is an internal helper within the adapter boundary. Consider renaming to `auth-identity.adapter.schemas.ts` to clarify its role.

### [NIT] All repository adapters properly implement port interfaces

File: src/contexts/_/infrastructure/repositories/_.repository.ts
Quote:

```ts
// Example from goal/infrastructure/repositories/goal.repository.ts:
// Implements GoalRepositoryPort from goal/application/ports/goal.repository.ts
export function createGoalRepository(db: Database): GoalRepositoryPort {
```

Rule: Correct — all repos implement their port interfaces and receive dependencies via factory functions.
Fix: No fix needed.

### [NIT] SQL queries are properly tenant-scoped with organizationId

File: src/contexts/_/infrastructure/repositories/_.repository.ts
Quote:

```ts
// Example pattern found in all repositories:
.where(eq(goals.organizationId, organizationId))
```

Rule: "SQL without tenant scoping." All queries include `organizationId` filtering. No unscoped queries were found.
Fix: No fix needed.

### [NIT] No secrets found at module scope

File: All infrastructure files
Quote:

```
// Grep for process.env.*, SECRET, PASSWORD, TOKEN, API_KEY patterns
// in infrastructure files — none found at module scope.
// Secrets are injected through environment config at composition time.
```

Rule: "Secrets at module scope." No violations found.
Fix: No fix needed.

### [NIT] Error translation at boundaries — mixed compliance

File: src/contexts/_/infrastructure/repositories/_.repository.ts
Quote:

```ts
// Most repos catch Drizzle errors and translate:
} catch (error) {
  if (isDrizzleUniqueViolation(error)) {
    return err({ _tag: 'GoalAlreadyExistsError', ... })
  }
  return err({ _tag: 'GoalRepositoryError', code: 'UNEXPECTED', message: '...' })
}
```

Rule: "Missing error translation at boundaries." Most repos translate DB errors to domain errors. Some catch blocks could be more specific about error translation (e.g., distinguishing connection errors from constraint violations).
Fix: Generally acceptable. Consider adding more specific error categories for connection timeouts vs. constraint violations in high-value paths.

## Severity Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 1     |
| MINOR     | 2     |
| NIT       | 4     |
| **Total** | **7** |
