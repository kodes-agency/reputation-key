# ADR 0009 — Permission Model

**Status:** Accepted
**Date:** 2026-05-24
**Context:** Architecture, Authorization

## Context

The application has multiple bounded contexts (identity, staff, property, portal, team, guest, review, inbox, metric, goal, integration, dashboard), each with server functions and use cases that need authorization checks. Early implementations used ad-hoc role checks scattered across server functions, leading to inconsistent authorization and difficulty auditing what each role can do.

A centralized, declarative permission model is needed so that:

1. Every use case and server function enforces authorization consistently.
2. Adding a new role or permission requires changing one file, not hunting through every server function.
3. The permission table is auditable — you can see at a glance what each role can do.

## Decision

Use a `can(role, permission)` pattern backed by a centralized permission table.

1. **Permission statement** — All resources and actions are declared in `shared/auth/permissions.ts` as a `statement` object (e.g. `{ goal: ['read', 'create', 'update', 'cancel'] }`).
2. **Role definitions** — Three default roles (AccountAdmin, PropertyManager, Staff) are defined using `createAccessControl` from better-auth, each declaring which resource.actions they may perform.
3. **Sync `can()` function** — `shared/domain/permissions.ts` exports `can(role, permission): boolean`. Application-layer code imports this (boundary-compliant). The lookup is injected at startup from the permission table.
4. **Permission table** — Built once at startup from role definitions, stored as `Record<Role, Set<string>>` for O(1) lookup.
5. **Server functions** — Every server function calls `can(ctx.role, '<resource>.<action>')` before invoking the use case. Permission is always checked at the HTTP boundary.
6. **Fine-grained permissions** — Each use case maps to exactly one permission. New use cases must define a new permission in the statement and assign it to the appropriate roles.

## Consequences

### Positive

- **Single source of truth** — All permissions are defined in one file. Adding a new permission is a one-line change.
- **Consistent enforcement** — Every server function follows the same `can()` pattern. No ad-hoc role checks.
- **Auditable** — The permission table can be printed or exported to answer "what can Staff do?" in O(1).
- **Type-safe** — The `Permission` union type in `shared/domain/permissions.ts` provides autocomplete and catches typos at compile time.
- **Testable** — Use cases can be tested with mocked `can()` or at the server function level with known roles.

### Negative

- **Compile-time sync** — The `Permission` type in `shared/domain/permissions.ts` must be manually kept in sync with the `statement` object. A missing entry won't cause a runtime error but will fail TypeScript compilation if a server function references it.
- **All-or-nothing startup** — The permission table must be initialized before any `can()` call. This is handled by auto-initialization on module import.

### Risks

- If developers bypass `can()` and check roles directly, authorization becomes inconsistent. Mitigate with code review and architectural tests.
