# Identity Context

## Bounded context

Authentication, session management, organization membership, and invitation workflows. Wraps better-auth as a thin adapter layer — does not own core entity types.

## Glossary

- **User** — An authenticated person. In beta, an account is created only by the exact invitation-bound registration saga, which delegates password handling to better-auth `signUpEmail`.
- **Organization** — A tenant/workspace. Created via better-auth. Has `name`, `slug`, and optional `logo`.
- **Member** — A login belonging to an Organization. The beta interactive roles are AccountAdmin (`owner`) and PropertyManager (`admin`). Historical Staff/custom-role rows are retained but cannot authenticate into the manager app.
- **Staff Participant** — A manager-maintained business/person profile owned by the Staff context. It does not require or imply a login. Staff User login is deferred.
- **Invitation** — A pending request for a user to join an organization with a specific role. Follows lifecycle: `pending` → `accepted` | `rejected` | `canceled`.
- **Role** — The shared hierarchy remains AccountAdmin > PropertyManager > Staff, but only the first two are interactive in beta. Invitation and mutation DTOs enforce that subset.
- **User Organization Binding** — App-owned closed-beta authority that makes one active Organization per login representable. Session state does not override it.
- **Organization Lifecycle Authority** — App-owned state/revision/deadline fence, separate from Better Auth's Organization row. The local control plane represents request, Closing preparation, recovery, Purge Pending, the explicit irreversible Purging boundary, and Closed. A named runtime exposes the control plane and composition readiness, while execution remains gated on every owning context and the independently authorized operator workflow.
- **Beta Feedback Triage Receipt** — Identity-owned, content-free local delivery and support authority for manager-authored native feedback. Report text and masked-layout bytes remain in the restricted monitoring project; PostgreSQL retains only controlled diagnostics, pseudonyms, delivery/triage state, safe linkage, clocks, and transition evidence.
- **Organization Export** — AccountAdmin-requested, context-contributed immutable ZIP. PostgreSQL owns only the request state, revisions, checksums, private object key, digest-only single-use retrieval authority, expiry, and content-free evidence; it never stores archive bytes or a raw retrieval token.
- **Slug** — URL-friendly organization identifier. Validated by `validateSlug` (2–63 chars, lowercase alphanumeric + hyphens).
- **IdentityPort** — Adapter interface wrapping better-auth API calls. All use cases depend on this port, never on better-auth directly.

## Relationships

- Organization → Members (many members per org).
- Organization → Invitations (many pending invitations per org).
- User → Organization (exactly one active beta binding; conflicting legacy memberships require support resolution).
- Staff context references `userId` from identity for staff assignments.
- Integration context references `userId` for `connectedBy` on Google connections.
- Goal context does not directly depend on identity (uses shared auth context).
- The operator-only People authority report is Identity-owned because Better Auth
  membership and the singular `property_access_grant` table are the access
  authority. It observes Staff/Portal/Property history read-only and never turns
  participation, attribution, Team, or manager responsibility into access.
- Native Beta Feedback uses Identity authorization/pseudonymization and an Identity-owned triage receipt; it does not become Inbox/Guest feedback and creates no automatic engineering issue.

## Invariants

- Only AccountAdmin can invite, and only AccountAdmin or PropertyManager roles.
- Only one Organization may hold a pending manager invitation for an email at a time.
- Invitation acceptance atomically claims the user's Organization binding; a conflicting binding cannot create membership.
- Invitation Property access is provisioned by a context-owned capability injected into the concrete `IdentityPort` adapter. The capability is scoped to that adapter/container, is idempotent per active grant, and failure-isolates sibling Properties. Shared Better Auth holds no mutable invitation/member lifecycle callback; its raw accept/remove/role/delete hooks deny before mutation, while the app-owned Identity commands carry the complete lifecycle dependencies.
- Registration requires the exact pending, unexpired, email-bound manager invitation. Before Better Auth runs, the app commits a content-free fence containing preallocated user/account/session IDs. Recovery may resume exact provider authority, compensate only those fenced records, or stop in `manual_review`; it never deletes by email or inferred ownership.
- Public registration, self-service Organization creation, Team, custom roles, and Staff User login are blocked beta capabilities.
- Current actor-to-Property authority is decided from one transactionally consistent Identity snapshot for the command's complete unique `(principal, Property)` set: it reads the Organization permission generation optimistically, locks every current membership in stable user order, resolves every permission/scope required by the command, locks every required Property grant in stable `(user, Property)` order, then locks and rechecks the generation exactly once before a protected cross-context command commits. A changed generation denies the command. The decision returns only canonical beta manager roles (`AccountAdmin` or `PropertyManager`); retained Staff/custom-role identities fail closed. Membership, role, or grant revocation therefore linearizes before or after the command without taking the generation lock between concrete authority rows; a stale session role or earlier authorization fact cannot preserve present authority.
- Cannot change role of a member with equal or higher role.
- Cannot assign a role higher than your own.
- Every policy-admin capability, suspension, or Property-access mutation commits
  its policy state/version change and required content-free decision audit in one
  Identity-owned PostgreSQL transaction. The strong policy refresh and any
  Responsible Manager reconciliation run only after that commit and are safe to
  retry.
- An Organization closure request is authorized from a transactionally locked exact `owner` membership plus matching active User Organization Binding. It atomically commits lifecycle revision, 30-day recovery deadline, Organization suspension/policy generation, retry receipt, and a content-minimal durable fact.
- Every new Better Auth Organization is provisioned with an `active` lifecycle authority in the same database transaction; existing Organizations are backfilled without inferring provider state. Database guards require exact revision increments, immutable closure lineage, edge-matched machine reasons, monotonic transition time, and a retained Organization-policy suspension until deliberate reactivation.
- The bounded coordinator advances `closure_requested → closing`, due `closing → purge_pending`, and `purging → closed` only after exactly one durable, content-free result from each of the 17 owning contexts. A missing, duplicate, mismatched, or failed contributor leaves the lifecycle state unchanged.
- Recoverable cancellation from Closure Requested or Closing never clears the Organization suspension or restores provider/Portal/AI/schedule capability. Support may also return Purge Pending to `active` before `irreversibleAt`, but only with exact revision/lineage, independent authorization evidence, and typed confirmation. Every recovery leaves `reactivationRequired=true`.
- `purge_pending → purging` is the explicit irreversible boundary. It requires exact revision/lineage, independent support authorization, typed confirmation, and content-free evidence. `purging` has no recovery edge; Closed is terminal.
- Organization Export requires a current transactionally rechecked AccountAdmin and exactly one contributor for every owning context. Complete contributions require human CSV and lossless JSON; empty/omitted contexts remain explicit. The deterministic manifest/checksums, encrypted private storage, append-only digest-only retrieval issuance history, seven-day object deadline, and deletion evidence are locally implemented. Expired retrieval rotation cannot reuse any operation or digest previously issued for the request.
- The production composition exposes one named lifecycle/export runtime and boot-registers three no-mutation safety handlers. Identity supplies its reviewed tenant-visible export contributor internally, so readiness reports the other 16 export owners as missing without allowing an external override. All 17 lifecycle contributors, the other 16 export contributors, durable post-upload generation recovery, active worker schedules, manager Closure Center, mutating operator commands, storage environment, and deliberate reactivation remain unbound. Export readiness exposes the recovery blocker and cannot construct the service while it is absent. The Identity lifecycle receipt wrapper transactionally locks and verifies the exact live lifecycle state/lineage/revision/deadline before phase work, then co-commits an append-only content-free receipt, but has no destructive phase work attached. Local control-plane code and quarantined handlers are not deployment or purge evidence, and no context data is purged merely because a lifecycle state changes.
- Removing a member transactionally revokes all of that user's Better Auth sessions, releases the matching singular Organization Binding, deletes membership, and records the durable removal fact. Cross-context manager/provider authorities are fenced before this commit; the final AccountAdmin cannot be removed.
- Native Beta Feedback prepares its local UUID receipt before provider delivery. A delivered/failed settlement advances the exact revision; a provider-success/database-finalize fault remains content-free `prepared` work correlated by the local reference.
- Suggestions are text-only. A Bug may carry only the validated `masked-layout-v1` geometry contract after explicit per-submission capture on an allowlisted route; no ordinary screenshot or Replay integration exists.
- Triage changes are delivered-only, optimistic-concurrency guarded, and co-commit one append-only content-free transition. Exact transition-ID retry is idempotent; report text and attachment bytes never enter the repository/operator interface.
- Organization slugs must be unique and match `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
- Organization names: 2–100 characters.

## Events produced

| Name                           | Tag                                       | Payload                                                                                                                                                                             | When                                 |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Organization created           | `identity.organization.created`           | organizationId, organizationName, slug, ownerId                                                                                                                                     | Organization created                 |
| Invitation sent                | `identity.member.invited`                 | organizationId, userId, role, invitationId                                                                                                                                          | Invitation sent                      |
| Invitation accepted            | `identity.invitation.accepted`            | invitationId, organizationId, userId, propertyIds                                                                                                                                   | Invitation accepted                  |
| Invitation canceled            | `identity.invitation.canceled`            | invitationId, organizationId                                                                                                                                                        | Invitation canceled                  |
| Member removed                 | `identity.member.removed`                 | organizationId, userId, removedBy                                                                                                                                                   | Member removed from organization     |
| Member role updated            | `identity.member.role_changed`            | organizationId, memberUserId, previousRole, newRole, userId                                                                                                                         | Member role updated                  |
| Merchant AI changed            | `identity.merchant_ai.changed`            | organizationId, propertyId, authorizationLineageId, state, reviewAnalysisEpoch, replyDraftingEpoch, propertyTrendsEpoch, authorizedSourceEpoch, analysisStartSequence, stateVersion | Merchant AI authorization changes    |
| Organization lifecycle changed | `identity.organization_lifecycle.changed` | organizationId, closureLineageId, state, revision, reactivationRequired, recoverableUntil                                                                                           | Every committed lifecycle transition |

## Events consumed

None. Identity context does not subscribe to events from other contexts.

`identity.member.invited` is identifier-only: the invitee email remains in
the canonical invitation row and is absent from the domain event. During the
bounded v1→v2 rolling migration, PostgreSQL may add only the literal
`[redacted]` to the v1 durable shape so pre-cutover parsers remain compatible;
v2 removes the key. The Data Cell cutover separately reports private retained
values and content-free v1 compatibility copies; privacy sealing does not
authorize removing the v1 parser. The retained-job scrub, verification,
contraction barrier, and rollback boundary are owned by
`docs/operations/identity-invitation-fact-cutover.md`.

## Architecture layers

```
identity/
  domain/              events.ts, errors.ts, rules.ts, organization-lifecycle.ts,
                       betaFeedbackTriage.ts, ARCHITECTURE.md
                       (No types.ts or constructors.ts — entities defined by better-auth)
  application/
    ports/             identity.port.ts (IdentityPort adapter interface),
                       invited-registration-store.port.ts,
                       organization-lifecycle-command-store.port.ts,
                       organization-lifecycle-contributor.port.ts,
                       organization-export.port.ts
    dto/               invitation.dto.ts, update-org-settings.dto.ts, change-password.dto.ts
    use-cases/         register-invited-user.ts, recover-invited-registrations.ts,
                       register-user.ts,
                       register-user-and-org.ts, invite-member.ts,
                       list-invitations.ts, resend-invitation.ts, update-member-role.ts,
                       remove-member.ts, update-organization.ts,
                       organization-lifecycle.ts, advance-organization-lifecycle.ts,
                       organization-export.ts,
                       request-org-logo-upload.ts, finalize-org-logo-upload.ts,
                       request-avatar-upload.ts, finalize-avatar-upload.ts
    beta-feedback-triage-invocation.ts
  infrastructure/
                       identity-command-store.ts, invited-registration-store.ts,
                       policy-admin-command-store.ts, organization-lifecycle-command-store.ts,
                       organization-export.repository.ts,
                       deterministic-zip-archive-writer.ts,
                       organization-export-s3-storage.ts,
                       organization-export-retrieval-secret.ts,
                       beta-feedback-triage.repository.ts
    jobs/              recover-invited-registrations.job.ts (bounded 60s cadence),
                       advance-organization-lifecycle.job.ts,
                       generate-organization-export.job.ts,
                       purge-expired-organization-exports.job.ts
                       (lifecycle/export families are safety-registered and quarantined)
    adapters/          auth-identity.adapter.ts (implements IdentityPort),
                       better-auth-schemas.ts (Zod schemas for better-auth responses)
    repositories/      includes the read-only, deterministic People authority
                       reconciliation report used before legacy contraction
  server/              organizations.ts, organizations.query.ts, organizations.update.ts,
                       organizations.members.ts, organizations.invitations.ts,
                       organizations.registration.ts, organizations.upload.ts,
                       organizations.shared.ts, auth-settings.ts, auth-settings.org.ts,
                       auth-settings.helpers.ts, beta-feedback.ts,
                       beta-feedback-delivery.server.ts
```

`build.ts` owns `createInvitationPropertyAccessProvisioner`, the narrow
construction interface used by the composition root to bind invitation access
to one concrete Identity adapter. It is not part of the cross-context runtime
interface and does not expose the grant repository.

## Use cases

| Name                                           | Input                                                                 | Output            | Beta posture                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `registerInvitedUser`                          | `invitationId`, `name`, `email`, `password`                           | `{ org }`         | exact invitation; public but not self-service                                                             |
| `recoverInvitedRegistrations`                  | due content-free recovery fences                                      | counts only       | worker-only; exact preallocated identities                                                                |
| `registerUser`                                 | `name`, `email`, `password`                                           | `User`            | dormant; no beta server entry point                                                                       |
| `registerUserAndOrg`                           | `name`, `email`, `password`, `organizationName`, `orgSlug`            | `{ user, org }`   | blocked by `organization.create`                                                                          |
| `inviteMember`                                 | `email`, beta manager `role`, `organizationId`                        | `void`            | `invitation.create`; AccountAdmin only                                                                    |
| `acceptInvitation`                             | `invitationId`, `organizationId`                                      | `{ user, org }`   | authenticated; exact binding enforced                                                                     |
| `cancelInvitation`                             | `invitationId`, `organizationId`                                      | `void`            | `invitation.cancel`                                                                                       |
| `resendInvitation`                             | `invitationId`, `organizationId`                                      | `Invitation`      | `invitation.resend`                                                                                       |
| `listInvitations`                              | `organizationId`                                                      | `Invitation[]`    | `invitation.list`                                                                                         |
| `removeMember`                                 | `memberId`, `organizationId`                                          | `void`            | `member.delete`                                                                                           |
| `updateMemberRole`                             | `memberId`, beta manager `newRole`, `organizationId`                  | `Member`          | `member.update`                                                                                           |
| custom-role use cases                          | `organizationId`, role definition                                     | varies            | dormant; custom-role endpoints are blocked                                                                |
| `updateOrganization`                           | `organizationId`, `name?`, `slug?`, `logo?`                           | `Organization`    | `organization.update`                                                                                     |
| `organizationLifecycle.requestClosure`         | operation/Organization/actor IDs, reason code, support evidence ref   | lifecycle status  | internal control-plane seam; no server route                                                              |
| `organizationLifecycle.getStatus`              | Organization/actor IDs                                                | lifecycle status  | current AccountAdmin only; no server route                                                                |
| `organizationLifecycle.cancelClosure`          | operation/Organization/actor IDs, cancel code, support evidence ref   | lifecycle status  | recovery window only; suspension retained                                                                 |
| `organizationLifecycle.runScheduledPass`       | bounded batch size                                                    | transition counts | named worker seam only when all 17 contributors and support authorization are bound; schedule quarantined |
| `organizationLifecycle.waiveRecoveryWindow`    | exact lineage/revision, independent authorization, typed confirmation | lifecycle status  | named support seam only when fully bound; no operator command                                             |
| `organizationLifecycle.cancelPendingPurge`     | exact lineage/revision, independent authorization, typed confirmation | lifecycle status  | named support seam only when fully bound; no operator command                                             |
| `organizationLifecycle.beginIrreversiblePurge` | exact lineage/revision, independent authorization, typed confirmation | lifecycle status  | named support seam only when fully bound; no operator command                                             |
| `organizationExport.request`                   | request/Organization/actor IDs                                        | export status     | named AccountAdmin-only service; unavailable until fully bound                                            |
| `organizationExport.generateNext`              | bounded worker claim                                                  | generated export  | exactly 17 contributors and private storage; schedule quarantined                                         |
| `organizationExport.issueRetrieval`            | request/operation/Organization/actor IDs                              | token + expiry    | named service; digest-only, single-use, 24-hour authority; unavailable until fully bound                  |
| `organizationExport.retrieve`                  | request/Organization/actor IDs + token                                | ZIP bytes         | named service; current AccountAdmin and checksum rechecked; unavailable until fully bound                 |
| `organizationExport.purgeNextExpired`          | bounded worker claim                                                  | completion flag   | one-object storage deletion precedes DB evidence; schedule quarantined                                    |

## Public API

- `src/contexts/identity/application/public-api.ts`
  - Defines the exact `IdentityPublicApi` runtime contract as four frozen facades: `managerFacts` (`IdentityManagerFactsPublicApi`, exposing `listActiveManagers` over `ManagerMembership`), `accountAdminAuthority` (`IdentityAccountAdminAuthorityPublicApi`, exposing `isCurrentAccountAdmin`), an offboarding-facts facade (`IdentityOffboardingFactsPublicApi`, the read-only transfer worklist a departing member must clear — LIF-01-T21), and request-facing `requests` (`IdentityRequestApi`).
  - Property and Portal receive only `managerFacts`; Guest receives the two authority facades separately; the complete facade remains available only to Identity delivery handlers.
  - Re-exports event types: `IdentityOrganizationCreated`, `IdentityMemberInvited`, `IdentityInvitationAccepted`, `IdentityInvitationCanceled`, `IdentityMemberRemoved`, `IdentityMemberRoleChanged`, `IdentityMerchantAiChanged`, `IdentityOrganizationLifecycleChanged`, `IdentityEvent`
  - Re-exports event constructors: `identityOrganizationCreated`, `identityMemberInvited`, `identityInvitationAccepted`, `identityInvitationCanceled`, `identityMemberRemoved`, `identityMemberRoleChanged`, `identityMerchantAiChanged`, `identityOrganizationLifecycleChanged`
  - Re-exports organization lifecycle vocabulary: `OrganizationLifecycleState`, `OrganizationLifecycleStatus`, `OrganizationClosureRequestReasonCode`, `OrganizationClosureCancelReasonCode`
  - Re-exports merchant AI authorization vocabulary: `CURRENT_MERCHANT_AI_CAPABILITIES`, `CurrentMerchantAiCapability`, `MerchantAiCapability`, `MerchantAiSnapshot`, `MerchantAiState`
  - Re-exports port types: `IdentityPort`, `MemberRecord`, `InvitationRecord`, `OrganizationRecord`

## Internal runtime API

- `buildIdentityContext(...).internal.organizationLifecycleRuntime`
  - `control` owns AccountAdmin request/status/recoverable-cancel commands.
  - `operator.readStatus` is the content-free authority read used by the governed read-only report.
  - `maintenance.readiness` distinguishes exact contributor coverage, independent support authorization, and executable composition. `runScheduledPass` is absent unless both requirements are complete.
  - `support` exposes waiver, pending-purge cancellation, and the irreversible-boundary command only when the exact contributor set and independent support authorization are both present. No server or operator command invokes it.
  - `organizationExport.readiness` distinguishes exact contributor coverage, storage binding, durable generation recovery, and executable composition. `service` is absent until all three requirements are complete; generation recovery is deliberately reported false today.
- Root composition exposes that object as the single named `identityLifecycleRuntime`; it does not flatten maintenance, support, export, retrieval, or deletion operations into the shared `useCases` surface.

## Server functions

| Name                    | Method | Permission               | Description                                                                                  |
| ----------------------- | ------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| `createOrganizationFn`  | POST   | blocked capability       | Dormant self-service org creation                                                            |
| `getActiveOrganization` | GET    | `dashboard.read`         | Get current active org                                                                       |
| `setActiveOrganization` | POST   | authenticated            | Reassert the exact beta binding                                                              |
| `listMembers`           | GET    | `member.list`            | List org members                                                                             |
| `inviteMember`          | POST   | `member.create`          | Invite user to org                                                                           |
| `acceptInvitation`      | POST   | authenticated            | Accept pending invitation                                                                    |
| `cancelInvitation`      | POST   | `invitation.cancel`      | Cancel sent invitation                                                                       |
| `resendInvitation`      | POST   | `invitation.resend`      | Resend invitation email                                                                      |
| `listInvitations`       | GET    | `invitation.list`        | List pending invitations                                                                     |
| `updateMemberRole`      | POST   | `member.update`          | Change member role                                                                           |
| `removeMember`          | POST   | `member.delete`          | Remove member from org                                                                       |
| `registerMember`        | POST   | exact invitation         | Invitation-bound manager signup                                                              |
| `registerUserAndOrg`    | POST   | blocked capability       | Dormant user + org signup                                                                    |
| `signInUser`            | POST   | public                   | Sign in existing user                                                                        |
| `updateOrganization`    | POST   | `organization.update`    | Update org name/slug/logo                                                                    |
| `requestOrgLogoUpload`  | POST   | `identity.logo_upload`   | Get S3 upload URL for org logo                                                               |
| `finalizeOrgLogoUpload` | POST   | `identity.logo_upload`   | Finalize org logo upload                                                                     |
| `requestAvatarUpload`   | POST   | `identity.avatar_upload` | Get S3 upload URL for avatar                                                                 |
| `finalizeAvatarUpload`  | POST   | `identity.avatar_upload` | Finalize avatar upload                                                                       |
| `changePasswordFn`      | POST   | authenticated            | Change user password                                                                         |
| `updateProfileFn`       | POST   | authenticated            | Update user profile                                                                          |
| `updateUserImageFn`     | POST   | authenticated            | Update user image URL                                                                        |
| `listUserInvitations`   | GET    | authenticated            | List user's pending invitations                                                              |
| `listUserOrganizations` | GET    | authenticated            | List user's organizations                                                                    |
| `submitBetaFeedbackFn`  | POST   | `feedback.respond`       | Native Bug/Suggestion intake; content-free local receipt before restricted provider delivery |

### Closure Center (LIF-01-T17/T18)

| Name                                 | Method | Authority                         | Description                                                        |
| ------------------------------------ | ------ | --------------------------------- | ------------------------------------------------------------------ |
| `getClosureCenterFn`                 | GET    | current AccountAdmin (under lock) | Lifecycle status, deadline, export view, reactivation checklist    |
| `requestOrganizationClosureFn`       | POST   | current AccountAdmin (under lock) | Typed-confirmation closure request                                 |
| `cancelOrganizationClosureFn`        | POST   | current AccountAdmin (under lock) | Cancel inside the recovery window; resumes nothing                 |
| `reactivateOrganizationFn`           | POST   | current AccountAdmin (under lock) | Explicit reactivation; refuses until every check and action passes |
| `requestOrganizationExportFn`        | POST   | current AccountAdmin (under lock) | Request an Organization Export                                     |
| `issueOrganizationExportRetrievalFn` | POST   | current AccountAdmin (under lock) | Single-use, 24-hour retrieval token                                |
| `downloadOrganizationExportFn`       | POST   | current AccountAdmin (under lock) | Consume the token and return the archive                           |

These seven are the ONLY server functions that deliberately skip
`requireExecutionAllowed`. A closure suspends the Organization, which denies
every capability; routing them through the capability gate would make the
closure uncancellable and the export unretrievable exactly when the tenant
needs both. Their authority is the locked "current AccountAdmin with an active
Organization binding" check inside each command-store transaction, plus an
explicit AccountAdmin role gate that denies Staff User principals. No
fresh-password, MFA or step-up factor is introduced on this path
(program bullet 8); `BLOCKED_CAPABILITIES` is untouched.

### Leaving an Organization (LIF-01-T21)

| Name                                | Method | Permission           | Description                                        |
| ----------------------------------- | ------ | -------------------- | -------------------------------------------------- |
| `listOutstandingResponsibilitiesFn` | GET    | `identity.leave_org` | The transfer worklist the caller must clear        |
| `leaveOrganizationFn`               | POST   | `identity.leave_org` | Transfer-first leave; sole AccountAdmin is refused |

The internal `ops:triage-beta-feedback` command is report-first and ticketed. It lists only content-free queue fields and applies one revision/transition-ID-bound change; it never reads report text, downloads attachments, or creates an engineering issue automatically.

## Permissions

Identity context uses the following permissions from `shared/domain/permissions.ts`:

- `organization.update` — Update beta organization identity settings (name, slug, logo, contact); dormant billing metadata is neither accepted nor returned
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
