# ADR 0001 — Dynamic Access Control via Better-auth

**Status:** Implemented
**Date:** 2026-05-02
**Implemented:** 2026-05-02 (commits `6e14d50`, `a15e1ca`, `804389f`, `0c637e3`)
**Context:** Identity & Authorization

## Decision

Use better-auth's built-in `dynamicAccessControl` feature for runtime role and permission management, rather than building a custom RBAC layer.

## Context

The application had a static three-role permission system (`AccountAdmin`, `PropertyManager`, `Staff`) hardcoded in `shared/auth/permissions.ts`. Every permission change required a code deploy. The system had two parallel permission APIs (`can()` and `hasRole()`) causing confusion and bugs — most critically, a double-mapping bug where `toDomainRole()` was called on an already-mapped domain role, silently degrading all users to `Staff`.

The business needs:

1. AccountAdmin should be able to create custom roles with cherry-picked permissions
2. AccountAdmin should be able to modify built-in role permissions per-organization
3. The developer experience of checking permissions in UI and server code must be clean and unambiguous

## Alternatives Considered

### A. Custom permission tables + application-layer RBAC

Build `roles`, `permissions`, and `role_permissions` tables in the application DB. Implement a permission resolver that loads role config at request time.

- **Pros:** Full control, no coupling to auth framework
- **Cons:** Duplicate work — better-auth already has this. Custom migration burden. Must keep in sync with better-auth's own member/role system.

### B. Static roles only, no runtime customization

Keep the current three-role model. Fix the bugs but don't add dynamic roles.

- **Pros:** Simplest. No new tables, no new UI.
- **Cons:** Every permission change requires a deploy. Doesn't scale to multi-tenant use cases where different orgs need different permission configs.

### C. Better-auth dynamicAccessControl (chosen)

Enable `dynamicAccessControl: { enabled: true }` in the organization plugin. Better-auth provides:

- `organizationRole` table for per-org role overrides and custom roles
- Built-in CRUD endpoints (`/organization/create-role`, `/organization/update-role`, `/organization/delete-role`)
- Automatic merge logic: built-in roles are fallback, org-specific overrides take precedence
- `ac.create` permission gate for role creation (AccountAdmin has this)

- **Pros:** Zero custom infrastructure. Battle-tested. Auto-migrates the table. Built-in merge/caching. Already paid for by using better-auth.
- **Cons:** Coupled to better-auth's permission model (resource.action tuples). Custom role names are lowercase-normalized. Limited to the statement defined in `createAccessControl`.

## Consequences

### Positive

- AccountAdmin can create custom roles from day one via better-auth API endpoints
- Built-in roles serve as fallback — no migration needed for existing orgs
- Permission checks remain `can(role, permission)` on the server — no change to use case code
- `organizationRole` table auto-created by better-auth migration

### Negative

- Custom roles limited to resources defined in the `statement` object (new resources require code deploy)
- Role names normalized to lowercase by better-auth
- Better-auth's `hasPermission` loads from DB on every check unless cached — need to verify caching behavior

### Risks

- If better-auth changes the dynamic AC API in a major version, migration effort may be needed
- The `organizationRole` table stores permissions as JSON strings — querying/auditing requires parsing

## Implementation Notes

- Enabled via `dynamicAccessControl: { enabled: true }` in `organization()` plugin config (done)
- The `ac` instance and role definitions passed to both `organization()` (server) and `organizationClient()` (client)
- Server-side permission checks use `can()` from `shared/domain/permissions` — boundary-compliant
- Client-side uses `usePermissions()` hook from `shared/hooks/usePermissions` — reads role from route context
- `hasRole()` retained only for hierarchy checks (sidebar visibility, domain rules)
- Double-mapping bug fixed — `beforeLoad` no longer calls `toDomainRole()` on already-mapped roles
- All `canEdit`/`canCreate`/`canDelete` prop drilling replaced with `usePermissions()` or `can()`
- Phase 4 (Admin UI for custom role management) deferred to future session
