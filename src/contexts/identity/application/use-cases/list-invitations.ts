// Identity context — list invitations use case.
// The Members page's open invitations: pending ones and expired ones Resend can
// renew, each with who sent it and which Properties it grants.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { betaInvitationRole, invitationState } from '../../domain/invitation-state'
import type { ListInvitationsOutput, OrganizationInvitation } from '../dto/invitation.dto'
import type {
  InvitationReadModel,
  OrganizationInvitationRow,
  PropertyNameLookup,
} from '../ports/invitation-read-model.port'
import { lookupPropertyNames, pickInvitationProperties } from '../invitation-properties'

export type ListInvitationsInput = void
export type { ListInvitationsOutput }

export type ListInvitationsDeps = Readonly<{
  invitations: InvitationReadModel
  propertyNames: PropertyNameLookup
  clock: () => Date
}>
export type ListInvitations = ReturnType<typeof listInvitations>

function toOrganizationInvitation(
  row: OrganizationInvitationRow,
  status: OrganizationInvitation['status'],
  names: ReadonlyMap<string, string>,
): OrganizationInvitation {
  const role = betaInvitationRole(row.role)
  return {
    id: row.id,
    email: row.email,
    role,
    rawRole: row.role ?? '',
    status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    inviterName: row.inviterName,
    // An AccountAdmin reaches every Property; listing some would mislead.
    properties:
      role === 'AccountAdmin' ? [] : pickInvitationProperties(names, row.propertyIds),
  }
}

/**
 * List the active Organization's open invitations, newest first.
 *
 * Steps:
 * 1. Authorize — invitation.list
 * 2. Read — open rows from the read model, their state derived at `now`
 * 3. Resolve — every invited Property's name in one batched lookup
 */
export const listInvitations =
  (deps: ListInvitationsDeps) =>
  async (
    _input: ListInvitationsInput,
    ctx: AuthContext,
  ): Promise<ListInvitationsOutput> => {
    if (!canForContext(ctx, 'invitation.list')) {
      throw identityError('forbidden', 'Insufficient role to view invitations')
    }

    const now = deps.clock()
    const open = (await deps.invitations.listOpenForOrganization(ctx.organizationId))
      .map((row) => ({ row, state: invitationState(row.status, row.expiresAt, now) }))
      .flatMap(({ row, state }) =>
        state === 'pending' || state === 'expired' ? [{ row, state }] : [],
      )
    const names = await lookupPropertyNames(
      deps.propertyNames,
      ctx.organizationId,
      open.flatMap(({ row }) => row.propertyIds),
    )

    return {
      invitations: open.map(({ row, state }) =>
        toOrganizationInvitation(row, state, names),
      ),
    }
  }
