// Identity context — accept invitation use case
// Extracted from the server fn (D8-007): the better-auth acceptInvitation call
// + identity.invitation.accepted event emission now live in a use case,
// testable independently. User may not have an org yet (they're joining), so
// there is no AuthContext — the caller resolves auth (userId) and passes headers.
// BQC-3.5: the member insert + invitation status update + accepted fact now
// commit in ONE transaction via the command store.

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
 * 2. Persist + emit — command store: lock the invitation, re-validate it,
 *    create the membership, mark accepted, and record the fact atomically
 *    (identity.invitation.accepted) so downstream handlers (e.g.
 *    staff-assignment creation) react
 * 3. Post-commit — auto-create staff assignments for the invited properties
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

    // Post-commit side effect — auto-create staff assignments for the invited
    // properties (the BA afterAcceptInvitation hook replacement).
    await deps.identity.runOnAcceptInvitation({
      userId: input.userId as string,
      organizationId: result.organizationId as string,
      propertyIds: result.propertyIds,
    })

    return { organizationId: result.organizationId }
  }
