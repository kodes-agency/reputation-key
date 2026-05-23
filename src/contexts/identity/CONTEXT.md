# Identity Context

Authentication, session management, organization membership, and invitation workflows. Wraps better-auth as a thin adapter layer — does not own core entity types.

## Glossary

- **User** — An authenticated person. Registered via better-auth `signUpEmail`. Identity context does not define a custom User type.
- **Organization** — A tenant/workspace. Created via better-auth. Has `name`, `slug`, and optional `logo`.
- **Member** — A user belonging to an organization with a role (AccountAdmin, PropertyManager, Staff).
- **Invitation** — A pending request for a user to join an organization with a specific role. Follows lifecycle: `pending` → `accepted` | `rejected` | `canceled`.
- **Role** — Hierarchical: AccountAdmin > PropertyManager > Staff. Enforced by `canInviteWithRole` and `canChangeRole` domain rules.
- **Slug** — URL-friendly organization identifier. Validated by `validateSlug` (2–63 chars, lowercase alphanumeric + hyphens).
- **IdentityPort** — Adapter interface wrapping better-auth API calls. All use cases depend on this port, never on better-auth directly.

## Relationships

- Organization → Members (many members per org).
- Organization → Invitations (many pending invitations per org).
- User → Organizations (a user can belong to multiple organizations).
- Staff context references `userId` from identity for staff assignments.
- Integration context references `userId` for `connectedBy` on Google connections.
- Goal context does not directly depend on identity (uses shared auth context).

## Invariants

- Only AccountAdmin can invite PropertyManager or AccountAdmin roles.
- PropertyManager can only invite Staff.
- Cannot change role of a member with equal or higher role.
- Cannot assign a role higher than your own.
- Organization slugs must be unique and match `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
- Organization names: 2–100 characters.

## Events produced

| Tag                    | Payload                                         | When                    |
| ---------------------- | ----------------------------------------------- | ----------------------- |
| `organization.created` | orgId, orgName, slug, ownerId                   | Organization created    |
| `member.invited`       | orgId, email, role, inviterId, invitationId     | Invitation sent         |
| `invitation.accepted`  | orgId, userId, role, invitationId               | Invitation accepted     |
| `invitation.rejected`  | orgId, invitationId, email                      | Invitation rejected     |
| `member.removed`       | orgId, userId, removedBy                        | Member removed from org |
| `member.role-changed`  | orgId, userId, previousRole, newRole, changedBy | Member role updated     |

## Events consumed

None. Identity context does not subscribe to events from other contexts.

## Public API

- `src/contexts/identity/application/public-api.ts`
  - Re-exports event types and constructors: `OrganizationCreated`, `MemberInvited`, `InvitationAccepted`, `InvitationRejected`, `MemberRemoved`, `MemberRoleChanged`
  - Re-exports port types: `IdentityPort`, `MemberRecord`, `InvitationRecord`, `OrganizationRecord`

## Architecture layers

```
identity/
  domain/              events.ts, errors.ts, rules.ts, ARCHITECTURE.md
                       (No types.ts or constructors.ts — entities defined by better-auth)
  application/
    ports/             identity.port.ts (IdentityPort adapter interface)
    dto/               invitation.dto.ts, update-org-settings.dto.ts, change-password.dto.ts
    use-cases/         register-user.ts, register-user-and-org.ts, invite-member.ts,
                       list-invitations.ts, resend-invitation.ts, update-member-role.ts,
                       remove-member.ts, update-organization.ts,
                       request-org-logo-upload.ts, finalize-org-logo-upload.ts,
                       request-avatar-upload.ts, finalize-avatar-upload.ts
  infrastructure/
    adapters/          auth-identity.adapter.ts (implements IdentityPort),
                       better-auth-schemas.ts (Zod schemas for better-auth responses)
  server/              organizations.ts, auth-settings.ts
```

## Intentional deviations

- **No `types.ts` or `constructors.ts`**: Identity is a wrapper around better-auth. Core entity types come from better-auth's schema and API responses. See `domain/ARCHITECTURE.md` for full rationale.
- **Port-driven design**: All better-auth calls go through `IdentityPort`. Use cases never import better-auth directly.

## Dependencies

- **Shared** — Uses shared domain ids (`OrganizationId`, `UserId`, `InvitationId`), roles, auth context, and slug utilities.
- No direct dependencies on other bounded contexts (identity is a foundational context).
