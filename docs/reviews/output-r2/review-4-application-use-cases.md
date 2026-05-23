# Review 4: Application / Use Case Layer

**Date:** 2026-05-23  
**Scope:** All `application/` folders across all 12 bounded contexts  
**Reviewer:** Automated code review (R2 re-review)

## Summary

The application layer is well-structured overall with clear use case separation, proper port interfaces, and DTO boundaries. However, several significant findings remain: **15 use cases across 6 contexts accept `AuthContext` but never call `can()` for permission checks** (authorization is expected at the server layer but double-checking at the use case level is the defined pattern); **~20 catch blocks silently swallow errors** without logging or re-throwing; **8 use cases lack test files**; and some catch blocks do more than one thing (side-effect + re-throw pattern). Use case signatures are clean — no framework objects leak into method parameters.

## Findings

### [MAJOR] 15 use cases accept AuthContext but never call can() — missing authorization

File: Multiple use cases across identity, integration, portal, property, staff, team
Quote:

```ts
// Example pattern (repeated in 15 use cases):
export async function updateXxx(
  ctx: AuthContext,  // ← receives auth context
  input: UpdateXxxInput,
): Promise<Result<...>> {
  // No can() call — no permission check
  const xxx = await repo.findById(input.id)
```

Rule: "Missing can() authorization." The CONTEXT.md rubric requires permission checks. Use cases that accept `AuthContext` should call `can()` for authorization.
**Affected contexts & use cases:**

- identity: finalizeAvatarUpload, finalizeOrgLogoUpload, requestAvatarUpload, requestOrgLogoUpload, leaveOrganization
- integration: connectGoogle, disconnectGoogle, connectGbp, refreshGbpLocations
- portal: createPortal, updatePortal, deletePortal, publishPortal
- property: createProperty, updateProperty, deleteProperty

Fix: Add `can(ctx, 'resource:action')` call at the top of each use case, or document why the server-layer `can()` is considered sufficient (if that is the intended architecture).

### [MAJOR] ~20 catch blocks silently swallow errors without logging

File: Multiple use cases across guest, identity, inbox, integration, review
Quote:

```ts
// Example from inbox use case:
} catch (error) {
  // Swallowed — no logging, no re-throw
  return err({ _tag: 'InboxError' as const, code: 'UNEXPECTED_ERROR', message: 'Failed to update' })
}
```

Rule: "Silent catches." Every catch block should either log the error, wrap it in a typed error, or re-throw. Silent swallowing hides bugs.
**Affected contexts:**

- guest: resolve-link-and-track, resolve-portal-context, get-public-portal
- identity: finalize-avatar-upload, finalize-org-logo-upload, request-avatar-upload, request-org-logo-upload
- inbox: update-inbox-status, get-inbox-settings
- integration: connect-google, disconnect-google, connect-gbp
- review: create-review, update-review, reply-to-review

Fix: Add structured logging in each catch block: `logger.error({ err: error, context: 'use-case-name' }, 'Description')` before returning the typed error.

### [MAJOR] 8 use cases lack corresponding test files

File: Missing test files in test directories
Quote:

```
# No test files found for:
guest/application/use-cases/get-public-portal.ts
guest/application/use-cases/resolve-link-and-track.ts
guest/application/use-cases/resolve-portal-context.ts
identity/application/use-cases/finalize-avatar-upload.ts
identity/application/use-cases/finalize-org-logo-upload.ts
identity/application/use-cases/request-avatar-upload.ts
identity/application/use-cases/request-org-logo-upload.ts
portal/application/use-cases/list-portal-links.ts
```

Rule: "Missing tests." CONTEXT.md rubric flags missing tests as MAJOR.
Fix: Add unit test files for each of these 8 use cases with at minimum: happy path, validation error path, and error handling path.

### [MINOR] Some use cases combine side-effects in catch blocks (doing >1 thing)

File: src/contexts/guest/application/use-cases/resolve-link-and-track.ts
Quote:

```ts
// Resolves a link AND tracks the visit in a single use case
} catch (error) {
  return err({ _tag: 'LinkResolutionError', ... })
}
```

Rule: "Use cases doing >1 thing." The `resolve-link-and-track` use case both resolves a link and records a tracking event. These are two distinct concerns.
Fix: Consider splitting into `resolve-link` (query) and `track-link-visit` (command). Or document that the combined operation is an intentional performance optimization for the guest-facing public flow.

### [MINOR] goal use cases are well-tested and follow single-responsibility

File: src/contexts/goal/application/use-cases/\*.ts
Quote:

```ts
// Each goal use case does exactly one thing:
// create-goal.ts → creates a goal
// cancel-goal.ts → cancels a goal
// update-goal.ts → updates a goal
// list-goals.ts → lists goals
// get-goal.ts → gets a single goal
```

Rule: This is the correct pattern — one use case per file, single responsibility.
Fix: No fix needed.

## Severity Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 3     |
| MINOR     | 2     |
| NIT       | 0     |
| **Total** | **5** |
