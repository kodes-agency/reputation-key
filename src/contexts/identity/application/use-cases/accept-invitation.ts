// Identity context — accept invitation use case
// Owns the Better Auth invitation-acceptance orchestration and is independently
// testable. A joining user may not have an Organization yet, so there is no
// AuthContext — the caller resolves auth (userId) and passes headers. The
// command store commits the member insert, invitation status update, and
// accepted fact in one transaction.

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { identityError } from '../../domain/errors'
import { identityInvitationAccepted } from '../../domain/events'

export type AcceptInvitationDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
}>

export type AcceptInvitationInput = Readonly<{
  invitationId: InvitationId
  headers: Headers
  userId: UserId
}>

export type AcceptInvitationResult = Readonly<{
  organizationId: OrganizationId
}>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type AcceptInvitation = (
  input: AcceptInvitationInput,
) => Promise<AcceptInvitationResult>

/**
 * Accept a pending organization invitation.
 *
 * Steps:
 * 1. Resolve the session — the acceptor's email authorizes the acceptance
 * 2. Persist — command store: lock the invitation, re-validate it, create the
 *    membership, mark accepted, and record identity.invitation.accepted
 *    atomically
 * 3. Post-commit — provision explicit access grants for invited Properties
 */
export const acceptInvitation =
  (deps: AcceptInvitationDeps): AcceptInvitation =>
  async (input) => {
    const session = await deps.identity.getSessionUser(input.headers)
    if (!session) {
      throw identityError('forbidden', 'No active session')
    }

    const now = deps.clock()
    const result = await deps.commandStore.acceptInvitation({
      invitationId: input.invitationId,
      acceptorEmail: session.email,
      acceptorUserId: input.userId,
      now,
      buildEvent: (accepted) =>
        identityInvitationAccepted({
          organizationId: accepted.organizationId,
          userId: input.userId,
          invitationId: input.invitationId,
          propertyIds: accepted.propertyIds,
          occurredAt: now,
        }),
    })

    // The binding is now durable and the membership exists. Align this
    // session to that exact Organization; login recovery repeats the same
    // binding-derived operation if the response is interrupted here.
    await deps.identity.setActiveOrganization(
      input.headers,
      result.organizationId as string,
    )

    // Post-commit side effect — provision only the explicitly invited Property
    // access grants. Staff participation remains a separate manager command.
    await deps.identity.runOnAcceptInvitation({
      userId: input.userId as string,
      organizationId: result.organizationId as string,
      propertyIds: result.propertyIds,
    })

    return { organizationId: result.organizationId }
  }
