// Identity context — list invitations use case
// Thin use case: authorization check + delegation to port.
// Per architecture: "Does the operation require an authorization check? → If yes, thin use case."

import type { IdentityPort, InvitationRecord } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'

// fallow-ignore-next-line unused-type
export type ListInvitationsOutput = Readonly<{
  invitations: ReadonlyArray<InvitationRecord>
}>

type Deps = Readonly<{ identity: IdentityPort }>

/**
 * List pending invitations for the active organization.
 *
 * Steps:
 * 1. Authorize — check that the user's role allows viewing invitations
 * 2. Query — delegate to the identity port
 * 3. Return
 */
export const listInvitations =
  (deps: Deps) =>
  async (_input: void, ctx: AuthContext): Promise<ListInvitationsOutput> => {
    // 1. Authorize
    if (!can(ctx.role, 'invitation.create')) {
      throw identityError('forbidden', 'Insufficient role to view invitations')
    }

    // 2. Query — only return pending invitations
    const invitations = (await deps.identity.listInvitations(ctx)).filter(
      (inv) => inv.status === 'pending',
    )

    // 3. Return
    return { invitations }
  }
