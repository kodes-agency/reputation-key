// Identity context — when the platform operator console may act (ADR 0065).
//
// Least privilege: the console acts on an Organization only while it has no
// AccountAdmin. Once one accepts, the Organization's own admins invite,
// resend and cancel, and the console stops showing its invitees' addresses.
// It touches only open AccountAdmin invitations, and a new invitation needs
// an active Organization (cancelling one does not).

import {
  invitationId as toInvitationId,
  organizationId as toOrganizationId,
  type InvitationId,
  type OrganizationId,
} from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import { invitationState } from '../domain/invitation-state'
import type {
  OrganizationInvitationInput,
  PlatformOrganizationView,
} from './dto/platform-console.dto'
import type {
  OrganizationAdministration,
  PlatformOrganizationRow,
  PlatformOrganizationStore,
} from './ports/platform-organization-store.port'

/** The console lists at most this many Organizations, newest first. */
export const PLATFORM_ORGANIZATION_LIST_LIMIT = 200

export type AdministrationCheck = Readonly<{
  requireActive: boolean
  /** When the change targets one invitation, it must be an open AccountAdmin one. */
  invitationId?: InvitationId
}>

/** Throws a tagged IdentityError unless the console may act on this Organization. */
export function assertOperatorMayAdminister(
  admin: OrganizationAdministration | null,
  check: AdministrationCheck,
): asserts admin is OrganizationAdministration {
  if (!admin) {
    throw identityError('forbidden', 'Organization not found')
  }
  if (admin.accountAdminCount > 0) {
    throw identityError(
      'forbidden',
      'This Organization already has an Account Admin; its admins manage invitations.',
    )
  }
  if (check.requireActive && admin.lifecycleState !== 'active') {
    throw identityError('forbidden', 'This Organization is not active.')
  }
  if (
    check.invitationId !== undefined &&
    !admin.openAdminInvitationIds.includes(check.invitationId)
  ) {
    throw identityError('invitation_not_found', 'Invitation not found')
  }
}

/** The Organization and invitation a console change targets, once permitted. */
export type PermittedInvitation = Readonly<{
  organizationId: OrganizationId
  invitationId: InvitationId
  administration: OrganizationAdministration
}>

/**
 * Reads the Organization an invitation change targets and refuses unless the
 * console may act on that invitation. Resend and cancel share it.
 */
export async function readPermittedInvitation(
  store: Pick<PlatformOrganizationStore, 'readAdministration'>,
  input: OrganizationInvitationInput,
  check: Pick<AdministrationCheck, 'requireActive'>,
): Promise<PermittedInvitation> {
  const organizationId = toOrganizationId(input.organizationId)
  const invitationId = toInvitationId(input.invitationId)
  const administration = await store.readAdministration(organizationId)
  assertOperatorMayAdminister(administration, { ...check, invitationId })
  return { organizationId, invitationId, administration }
}

export function toPlatformOrganizationView(
  row: PlatformOrganizationRow,
  controlledBetaEnabled: boolean,
  now: Date,
): PlatformOrganizationView {
  const administered = row.accountAdminCount > 0
  return {
    id: row.id as string,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    lifecycleState: row.lifecycleState,
    memberCount: row.memberCount,
    accountAdminCount: row.accountAdminCount,
    pendingInvitationCount: row.pendingInvitationCount,
    controlledBetaEnabled,
    pendingAdminInvitations: administered
      ? []
      : row.adminInvitations.map((invitation) => ({
          id: invitation.id as string,
          email: invitation.email,
          expiresAt: invitation.expiresAt.toISOString(),
          expired:
            invitationState(invitation.status, invitation.expiresAt, now) !== 'pending',
        })),
  }
}
