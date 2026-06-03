# Identity Context

## Bounded context

TODO: One sentence describing what this context does.

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

## Use cases

| Name                    | Input                                             | Output               | Permission           |
| ----------------------- | ------------------------------------------------- | -------------------- | -------------------- |
| `registerUser`          | `name`, `email`, `password`                       | `User`               | public               |
| `registerUserAndOrg`    | `name`, `email`, `password`, `orgName`, `orgSlug` | `{ user, org }`      | public               |
| `inviteMember`          | `email`, `role`, `orgId`                          | `Invitation`         | `org:manage_members` |
| `resendInvitation`      | `invitationId`, `orgId`                           | `Invitation`         | `org:manage_members` |
| `listInvitations`       | `orgId`                                           | `Invitation[]`       | `org:manage_members` |
| `removeMember`          | `memberId`, `orgId`                               | `void`               | `org:manage_members` |
| `updateMemberRole`      | `memberId`, `newRole`, `orgId`                    | `Member`             | `org:manage_members` |
| `updateOrganization`    | `orgId`, `name?`, `slug?`, `logo?`                | `Organization`       | `org:manage`         |
| `requestOrgLogoUpload`  | `orgId`, `contentType`                            | `{ uploadUrl, key }` | `org:manage`         |
| `finalizeOrgLogoUpload` | `orgId`, `key`                                    | `Organization`       | `org:manage`         |
| `requestAvatarUpload`   | `userId`, `contentType`                           | `{ uploadUrl, key }` | authenticated        |
| `finalizeAvatarUpload`  | `userId`, `key`                                   | `User`               | authenticated        |

## Server functions

| Name                    | Method | Permission           | Description                     |
| ----------------------- | ------ | -------------------- | ------------------------------- |
| `createOrganizationFn`  | POST   | authenticated        | Create new organization         |
| `getActiveOrganization` | GET    | authenticated        | Get current active org          |
| `setActiveOrganization` | POST   | authenticated        | Switch active org               |
| `listMembers`           | GET    | `org:manage_members` | List org members                |
| `inviteMember`          | POST   | `org:manage_members` | Invite user to org              |
| `acceptInvitation`      | POST   | authenticated        | Accept pending invitation       |
| `cancelInvitation`      | POST   | `org:manage_members` | Cancel sent invitation          |
| `resendInvitation`      | POST   | `org:manage_members` | Resend invitation email         |
| `listInvitations`       | GET    | `org:manage_members` | List pending invitations        |
| `updateMemberRole`      | POST   | `org:manage_members` | Change member role              |
| `removeMember`          | POST   | `org:manage_members` | Remove member from org          |
| `registerMember`        | POST   | `org:manage_members` | Register new member manually    |
| `registerUserAndOrg`    | POST   | public               | Register user + create org      |
| `signInUser`            | POST   | public               | Sign in existing user           |
| `updateOrganization`    | POST   | `org:manage`         | Update org name/slug/logo       |
| `requestOrgLogoUpload`  | POST   | `org:manage`         | Get S3 upload URL for org logo  |
| `finalizeOrgLogoUpload` | POST   | `org:manage`         | Finalize org logo upload        |
| `requestAvatarUpload`   | POST   | authenticated        | Get S3 upload URL for avatar    |
| `finalizeAvatarUpload`  | POST   | authenticated        | Finalize avatar upload          |
| `changePasswordFn`      | POST   | authenticated        | Change user password            |
| `updateProfileFn`       | POST   | authenticated        | Update user profile             |
| `updateUserImageFn`     | POST   | authenticated        | Update user image URL           |
| `listUserInvitations`   | GET    | authenticated        | List user's pending invitations |
| `listUserOrganizations` | GET    | authenticated        | List user's organizations       |

> **DEPRECATED per docs/standards.md §4.3**

## Intentional deviations

- **No `types.ts` or `constructors.ts`**: Identity is a wrapper around better-auth. Core entity types come from better-auth's schema and API responses. See `domain/ARCHITECTURE.md` for full rationale.
- **Port-driven design**: All better-auth calls go through `IdentityPort`. Use cases never import better-auth directly.
- **Use-case-only permission pattern**: Identity context enforces permissions exclusively at the use-case layer. Server functions do not add redundant `can()` checks for routes that delegate to use cases. For routes that bypass use cases (e.g., thin auth delegation), the server function performs the permission check directly.
- **Domain rules (domain/rules.ts) use hasRole() directly for role-based business logic — this is intentional per ADR-0001.**

## Dependencies

- **Shared** — Uses shared domain ids (`OrganizationId`, `UserId`, `InvitationId`), roles, auth context, and slug utilities.
- No direct dependencies on other bounded contexts (identity is a foundational context).

## Permissions

Identity context uses the following permissions from `shared/domain/permissions.ts`:

- `organization.update` — Update organization settings (name, slug, billing info)
- `member.update` — Change member roles
- `member.delete` — Remove members from organization
- `member.list` — List organization members
- `invitation.create` — Send invitations to new members
- `invitation.list` — View pending invitations
- `invitation.cancel` — Cancel pending invitations
- `invitation.resend` — Resend invitation emails
- `identity.avatar_upload` — Upload user avatar
- `identity.logo_upload` — Upload organization logo
- `dashboard.read` — Access dashboard data
