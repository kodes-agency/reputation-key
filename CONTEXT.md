# Context — Reputation Key

## Architecture

Layered hexagonal (clean architecture). Six bounded contexts in `src/contexts/`, shared infrastructure in `src/shared/`, React frontend in `src/components/` and `src/routes/`.

```
routes/ → contexts/<ctx>/server/ → contexts/<ctx>/application/ → contexts/<ctx>/domain/
                                        ↑
                          infrastructure/ implements ports
```

Composition root: `src/composition.ts`. Bootstrap: `src/bootstrap.ts`.

## Layer guides

| Working in | Read this |
| ---------- | --------- |
| Components, forms, hooks | `src/components/CONTEXT.md` |
| Domain, use cases, repos, server functions | `src/contexts/CONTEXT.md` |
| Shared infrastructure, auth, cache, observability | `src/shared/CONTEXT.md` |
| Routes, loaders, mutations, auth guards | `src/routes/CONTEXT.md` |

## Bounded contexts

| Context  | Responsibility                                         | Key Entities                           |
| -------- | ------------------------------------------------------ | -------------------------------------- |
| Identity | Users, organizations, members, invitations             | User, Organization, Member, Invitation |
| Property | Properties (hotels/restaurants) owned by organizations | Property                               |
| Portal   | Guest-facing portal pages with links, per property     | Portal, Link, LinkCategory             |
| Guest    | Public portal rendering, review collection, feedback   | Review, Feedback                       |
| Team     | Staff teams and shift management                       | Team, StaffAssignment                  |

## Glossary

### Roles & Permissions

| Term                       | Definition                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Role**                   | A named set of permissions assigned to an organization member. Org-wide — not per-property.                                            |
| **AccountAdmin**           | Organization owner. Full permissions including role management (`ac.*`). Created when the org is created.                              |
| **PropertyManager**        | Can manage properties, portals, members, teams. Cannot delete resources or manage roles.                                               |
| **Staff**                  | Read-only access. Can view reviews.                                                                                                    |
| **Permission**             | A `resource.action` string (e.g. `portal.create`). The atomic unit of authorization.                                                   |
| **Dynamic Access Control** | Better-auth feature that loads org-specific role overrides from the DB at permission-check time. Built-in roles are the fallback.      |
| **Staff Assignment**       | Links a member to a specific property. Controls which properties a PropertyManager can manage.                                         |

### Auth Architecture

| Term                 | Definition                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Better-auth role** | Role string stored in better-auth's member table: `owner`, `admin`, `member`.                                           |
| **Domain role**      | Our business role type: `AccountAdmin`, `PropertyManager`, `Staff`. Mapped from better-auth roles via `toDomainRole()`. |
| **AuthContext**      | `{ userId, organizationId, role }` — attached to every server function call via `resolveTenantContext()`.               |
| **Route context**    | `{ user, role, activeOrganization }` — attached to every authenticated route via `_authenticated.tsx` `beforeLoad`.     |

### Property Access

| Term                    | Definition                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Property Assignment** | A `staff_assignment` record linking a user to a property. PropertyManagers only manage assigned properties.  |
| **Org-wide role**       | A member's role applies across the entire organization, but property-level actions are scoped by assignment. |

## Permission Patterns

### When to use what

| API                           | When                                              | Import                          |
| ----------------------------- | ------------------------------------------------- | ------------------------------- |
| `can(role, permission)`       | Server functions, route `beforeLoad` guards       | `#/shared/domain/permissions`   |
| `usePermissions()`            | React components (reads role from route context)  | `#/shared/hooks/usePermissions` |
| `hasRole(role, requiredRole)` | Sidebar visibility, domain rules (hierarchy only) | `#/shared/domain/roles`         |

### Forbidden patterns

- Never pass `canEdit`/`canCreate`/`canDelete` boolean props — use `usePermissions()` in the component
- Never use `hasRole()` for permission checks — only for hierarchy
- Never call `toDomainRole()` on an already-mapped domain role — `resolveTenantContext()` already returns domain roles

## Architecture Decisions

See `docs/adr/` for formal ADRs.

## Key Files

| Area                      | Path                                 |
| ------------------------- | ------------------------------------ |
| Permission definitions    | `src/shared/auth/permissions.ts`     |
| Permission type + `can()` | `src/shared/domain/permissions.ts`   |
| Role types + `hasRole()`  | `src/shared/domain/roles.ts`         |
| Client permission hook    | `src/shared/hooks/usePermissions.ts` |
| Auth context type         | `src/shared/domain/auth-context.ts`  |
| Auth middleware            | `src/shared/auth/middleware.ts`      |
| Better-auth config        | `src/shared/auth/auth.ts`            |
| Better-auth client        | `src/shared/auth/auth-client.ts`     |
| Authenticated route       | `src/routes/_authenticated.tsx`      |
| Composition root          | `src/composition.ts`                 |
| Bootstrap                 | `src/bootstrap.ts`                   |
| Request tracing           | `src/shared/observability/traced-server-fn.ts` |
| Tenant cache              | `src/shared/auth/middleware.ts`      |
