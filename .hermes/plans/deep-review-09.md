# Deep Review r09: Permissions & Authorization

## Status: COMPLETED

## Findings

### BLOCKER 1: ReplyEditor renders for all roles including Staff
- **File:** `src/components/inbox/reply-editor.tsx:25` and `src/components/inbox/inbox-detail-content.tsx:142-143`
- **Quote:** `{currentItem.sourceType === 'review' && (<ReplyEditor reviewId={currentItem.sourceId} />)}`
- **Rule:** CONTEXT.md: "Only PM+ roles can manage replies; Staff cannot view or manage them."
- **Triage:** `relevant`
- **Fix:** Add `usePermissions()` check in `InboxDetailContent`. Only render `ReplyEditor` when user has `reply.manage` permission. The server-side check in `reply-operations.ts:requireManager()` prevents actual mutations, but the UI should not show reply controls to Staff.

### BLOCKER 2: MemberTable/InvitationTable import `can()` directly instead of using `usePermissions()`
- **Files:** `src/components/features/identity/member-directory/member-table.tsx:7,51-52` and `src/components/features/identity/member-directory/invitation-table.tsx:7,53`
- **Quote:** `import { can } from '#/shared/domain/permissions'` then `const canChangeRoles = can(viewerRole, 'member.update')`
- **Rule:** CONTEXT.md Permission Patterns: `usePermissions()` is for React components, `can(role, permission)` is for server functions and route `beforeLoad` guards.
- **Triage:** `relevant` (these components receive `viewerRole` as a prop from the parent route, which itself gets role from route context — effectively the same data source. However, the convention is clear: components should use `usePermissions()` not `can()` directly.)
- **Fix:** Refactor both components to use `usePermissions()` internally instead of receiving `viewerRole` prop and calling `can()`.

### BLOCKER 3: `role === 'AccountAdmin'` string equality check in `staff/build.ts`
- **File:** `src/contexts/staff/build.ts:48`
- **Quote:** `if (role === 'AccountAdmin') return null`
- **Rule:** "A role check that uses string equality when a permission or `hasRole()` would express intent."
- **Triage:** `relevant`
- **Fix:** Use `hasRole(role, 'AccountAdmin')` from shared/domain/roles for consistency.

### MAJOR 1: Inbox use cases use `hasRole(role, ADMIN_ROLE)` instead of `can(role, permission)`
- **Files:** Multiple inbox use cases: `add-inbox-note.ts:48`, `update-inbox-status.ts:45`, `get-inbox-items.ts:34`, `get-inbox-item-detail.ts:36`, `bulk-update-inbox-status.ts:48`, `assign-inbox-item.ts:49`, `get-inbox-notes.ts:38`
- **Quote:** `if (!hasRole(input.role, ADMIN_ROLE)) {`
- **Rule:** CONTEXT.md: "`can(role, permission)` for server functions; `hasRole(role, requiredRole)` for sidebar visibility, domain hierarchy rules only."
- **Triage:** `wontfix` — These inbox use cases are using `hasRole` for a hierarchy check (is user admin-level or above) to determine property-scoping behavior, not for permission gating per se. The `hasRole` check determines *which* properties a user can see, which is a hierarchy/domain rule. They also do actual `can()` checks in the server layer. The pattern is: admin sees all properties, PM sees assigned properties. This is hierarchy logic, not authorization. Acceptable.

### MAJOR 2: Inbox domain rule `canAssign` uses `hasRole` instead of permission
- **File:** `src/contexts/inbox/domain/rules.ts:42-44`
- **Quote:** `return hasRole(role, 'PropertyManager')`
- **Rule:** Domain rules should use permission checks for authorization.
- **Triage:** `wontfix` — This is a domain rule in the `domain/` layer. Since domain can't import `can()` from `shared/domain/permissions` (which requires initialization), using `hasRole` for hierarchy is the pragmatic choice. The actual permission enforcement happens in the application layer.

### MAJOR 3: `integration/list-google-connections.ts` uses `hasRole` for visibility filter
- **File:** `src/contexts/integration/application/use-cases/list-google-connections.ts:16`
- **Quote:** `const filter: ConnectionVisibilityFilter = hasRole(ctx.role, 'AccountAdmin')`
- **Triage:** `wontfix` — Same pattern as inbox: using hierarchy to determine visibility scope (admin sees all connections, others see own). Not an authorization gate.

### MAJOR 4: `_authenticated.tsx` line 81 uses `as Role` cast on org.role
- **File:** `src/routes/_authenticated.tsx:81`
- **Quote:** `role = org.role as Role`
- **Triage:** `wontfix` — The role comes from better-auth's `getActiveOrganization()` which returns the mapped role string. The cast is appropriate here since the route `beforeLoad` is the boundary between better-auth and domain roles.

### NIT 1: RoleBadge uses string equality `role === 'AccountAdmin'`
- **File:** `src/components/features/identity/shared/role-badge.tsx:12-14`
- **Quote:** `role === 'AccountAdmin' ? 'default' : role === 'PropertyManager' ? 'secondary' : 'outline'`
- **Triage:** `wontfix` — This is a pure UI component mapping role to badge variant. Using string equality here is fine; `hasRole` would be semantically wrong (hierarchy check ≠ variant selection).

## Actions Taken

1. **BLOCKER 1 fixed:** Added `usePermissions()` check to `InboxDetailContent` to gate `ReplyEditor` behind `reply.manage`.
2. **BLOCKER 2 fixed:** Refactored `MemberTable` and `InvitationTable` to use `usePermissions()` internally.
3. **BLOCKER 3 fixed:** Changed `role === 'AccountAdmin'` to `hasRole(role, 'AccountAdmin')` in `staff/build.ts`.

## Permission Matrix

| Permission | AccountAdmin | PropertyManager | Staff | Enforced Where |
|---|---|---|---|---|
| organization.update | ✅ granted | ✅ granted | ❌ | server: settings route beforeLoad, settings organization server fn |
| organization.delete | ✅ granted | ❌ | ❌ | Not enforced (no delete org feature yet) |
| member.create | ✅ granted | ✅ granted | ❌ | server: identity organizations.ts, use-case: identity domain rules |
| member.update | ✅ granted | ❌ | ❌ | server: identity organizations.ts, use-case: identity domain rules |
| member.delete | ✅ granted | ❌ | ❌ | server: identity organizations.ts, use-case: identity domain rules |
| invitation.create | ✅ granted | ✅ granted | ❌ | server: identity organizations.ts |
| invitation.cancel | ✅ granted | ✅ granted | ❌ | server: identity organizations.ts |
| invitation.resend | ✅ granted | ✅ granted | ❌ | server: identity organizations.ts |
| property.create | ✅ granted | ✅ granted | ❌ | client: dashboard-page, properties index; server: property server fns |
| property.update | ✅ granted | ✅ granted | ❌ | server: property server fns |
| property.delete | ✅ granted | ❌ | ❌ | server: property server fns |
| team.create | ✅ granted | ✅ granted | ❌ | server: team use case |
| team.update | ✅ granted | ✅ granted | ❌ | server: team use case |
| team.delete | ✅ granted | ❌ | ❌ | client: teams-tab.tsx; server: team use case |
| staff_assignment.create | ✅ granted | ✅ granted | ❌ | server: staff use case |
| staff_assignment.delete | ✅ granted | ✅ granted | ❌ | server: staff use case |
| ac.create | ✅ granted | ❌ | ❌ | Not enforced (dynamic AC Phase B) |
| ac.read | ✅ granted | ❌ | ❌ | Not enforced (dynamic AC Phase B) |
| ac.update | ✅ granted | ❌ | ❌ | Not enforced (dynamic AC Phase B) |
| ac.delete | ✅ granted | ❌ | ❌ | Not enforced (dynamic AC Phase B) |
| portal.create | ✅ granted | ✅ granted | ❌ | server: route beforeLoad, portal server fns |
| portal.update | ✅ granted | ✅ granted | ❌ | client: portal components; server: portal server fns |
| portal.delete | ✅ granted | ❌ | ❌ | client: portal index; server: portal server fns |
| review.read | ✅ granted | ✅ granted | ✅ granted | server: review server fns (all roles can read) |
| review.reply | ✅ granted | ✅ granted | ❌ | Not explicitly enforced as separate permission (reply.manage covers it) |
| reply.manage | ✅ granted | ✅ granted | ❌ | server: reply-operations.ts requireManager(); client: InboxDetailContent (after fix) |
| feedback.read | ✅ granted | ✅ granted | ❌ | server: inbox use cases |
| feedback.respond | ✅ granted | ✅ granted | ❌ | Not enforced (no respond-to-feedback feature yet) |
| integration.manage | ✅ granted | ❌ | ❌ | server: integration server fns |

**Note:** `review.reply` permission is granted to AccountAdmin and PropertyManager but enforcement uses `reply.manage` instead. The `review.reply` permission may be redundant with `reply.manage`.
