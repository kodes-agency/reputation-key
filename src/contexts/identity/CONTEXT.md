# Identity Context

## Bounded context

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

| Name                 | Tag                             | Payload                                                     | When                    |
| -------------------- | ------------------------------- | ----------------------------------------------------------- | ----------------------- |
| Organization created | `identity.organization.created` | organizationId, organizationName, slug, ownerId             | Organization created    |
| Invitation sent      | `identity.member.invited`       | organizationId, userId, email, role, invitationId           | Invitation sent         |
| Invitation accepted  | `identity.invitation.accepted`  | invitationId, organizationId, userId, propertyIds           | Invitation accepted     |
| Invitation rejected  | `identity.invitation.rejected`  | invitationId, organizationId                                | Invitation rejected     |
| Invitation canceled  | `identity.invitation.canceled`  | invitationId, organizationId                                | Invitation canceled     |
| Member removed       | `identity.member.removed`       | organizationId, userId, removedBy                           | Member removed from org |
| Member role updated  | `identity.member.role_changed`  | organizationId, memberUserId, previousRole, newRole, userId | Member role updated     |

## Events consumed

None. Identity context does not subscribe to events from other contexts.

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
  server/              organizations.ts, organizations.query.ts, organizations.update.ts,
                       organizations.members.ts, organizations.invitations.ts,
                       organizations.registration.ts, organizations.upload.ts,
                       organizations.shared.ts, auth-settings.ts, auth-settings.org.ts,
                       auth-settings.helpers.ts
```

## Use cases

| Name                 | Input                                                      | Output          | Permission            |
| -------------------- | ---------------------------------------------------------- | --------------- | --------------------- |
| `registerUser`       | `name`, `email`, `password`                                | `User`          | public                |
| `registerUserAndOrg` | `name`, `email`, `password`, `organizationName`, `orgSlug` | `{ user, org }` | public                |
| `inviteMember`       | `email`, `role`, `organizationId`                          | `Invitation`    | `invitation.create`   |
| `acceptInvitation`   | `invitationId`, `organizationId`                           | `{ user, org }` | authenticated         |
| `cancelInvitation`   | `invitationId`, `organizationId`                           | `void`          | `invitation.cancel`   |
| `resendInvitation`   | `invitationId`, `organizationId`                           | `Invitation`    | `invitation.resend`   |
| `listInvitations`    | `organizationId`                                           | `Invitation[]`  | `invitation.list`     |
| `removeMember`       | `memberId`, `organizationId`                               | `void`          | `member.delete`       |
| `updateMemberRole`   | `memberId`, `newRole`, `organizationId`                    | `Member`        | `member.update`       |
| `createCustomRole`   | `organizationId`, `name`, `permissions`                    | `CustomRole`    | `member.update`       |
| `updateCustomRole`   | `organizationId`, `roleId`, `name?`, `permissions?`        | `CustomRole`    | `member.update`       |
| `deleteCustomRole`   | `organizationId`, `roleId`                                 | `void`          | `member.update`       |
| `updateOrganization` | `organizationId`, `name?`, `slug?`, `logo?`                | `Organization`  | `organization.update` |

## Public API

- `src/contexts/identity/application/public-api.ts`
  - Re-exports event types: `IdentityOrganizationCreated`, `IdentityMemberInvited`, `IdentityInvitationAccepted`, `IdentityInvitationRejected`, `IdentityInvitationCanceled`, `IdentityMemberRemoved`, `IdentityMemberRoleChanged`, `IdentityEvent`
  - Re-exports event constructors: `identityOrganizationCreated`, `identityMemberInvited`, `identityInvitationAccepted`, `identityInvitationRejected`, `identityInvitationCanceled`, `identityMemberRemoved`, `identityMemberRoleChanged`
  - Re-exports port types: `IdentityPort`, `MemberRecord`, `InvitationRecord`, `OrganizationRecord`, `CustomRoleRecord`

## Server functions

| Name                    | Method | Permission               | Description                      |
| ----------------------- | ------ | ------------------------ | -------------------------------- |
| `createOrganizationFn`  | POST   | authenticated            | Create new organization          |
| `getActiveOrganization` | GET    | `dashboard.read`         | Get current active org           |
| `setActiveOrganization` | POST   | authenticated            | Switch active org                |
| `listMembers`           | GET    | `member.list`            | List org members                 |
| `inviteMember`          | POST   | `member.create`          | Invite user to org               |
| `acceptInvitation`      | POST   | authenticated            | Accept pending invitation        |
| `cancelInvitation`      | POST   | `invitation.cancel`      | Cancel sent invitation           |
| `resendInvitation`      | POST   | `invitation.resend`      | Resend invitation email          |
| `listInvitations`       | GET    | `invitation.list`        | List pending invitations         |
| `updateMemberRole`      | POST   | `member.update`          | Change member role               |
| `removeMember`          | POST   | `member.delete`          | Remove member from org           |
| `registerMember`        | POST   | public                   | Register new member manually     |
| `registerUserAndOrg`    | POST   | public                   | Register user + create org       |
| `signInUser`            | POST   | public                   | Sign in existing user            |
| `updateOrganization`    | POST   | `organization.update`    | Update org name/slug/logo        |
| `requestOrgLogoUpload`  | POST   | `identity.logo_upload`   | Get S3 upload URL for org logo   |
| `finalizeOrgLogoUpload` | POST   | `identity.logo_upload`   | Finalize org logo upload         |
| `requestAvatarUpload`   | POST   | `identity.avatar_upload` | Get S3 upload URL for avatar     |
| `finalizeAvatarUpload`  | POST   | `identity.avatar_upload` | Finalize avatar upload           |
| `changePasswordFn`      | POST   | authenticated            | Change user password             |
| `updateProfileFn`       | POST   | authenticated            | Update user profile              |
| `updateUserImageFn`     | POST   | authenticated            | Update user image URL            |
| `listUserInvitations`   | GET    | authenticated            | List user's pending invitations  |
| `listUserOrganizations` | GET    | authenticated            | List user's organizations        |
| `getOrgResponseSla`     | GET    | `dashboard.read`         | Get organization response SLA    |
| `updateOrgResponseSla`  | POST   | `organization.update`    | Update organization response SLA |

## Permissions

Identity context uses the following permissions from `shared/domain/permissions.ts`:

- `organization.update` — Update organization settings (name, slug, billing info)
- `member.update` — Change member roles
- `member.delete` — Remove members from organization
- `member.list` — List organization members
- `member.create` — Invite members (used in inviteMember server function)
- `dashboard.read` — Read organization dashboard data (used in getActiveOrganization)
- `invitation.create` — Send invitations to new members
- `invitation.list` — View pending invitations
- `invitation.cancel` — Cancel pending invitations
- `invitation.resend` — Resend invitation emails
- `identity.avatar_upload` — Upload user avatar
- `identity.logo_upload` — Upload organization logo
