// Identity context — the AccountAdmin invitation the operator console sends
// (ADR 0063).
//
// It is the ordinary invitation: the same command, guards and
// `identity.member.invited` fact as an admin's invite, with the operator as
// inviter and no Properties. The operator never becomes a member of the
// Organization, so the email names the Organization explicitly instead of
// reading it from the operator's session.

import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { toBetterAuthRole } from '#/shared/domain/roles'
import { absoluteUrl } from '#/shared/email/urls'
import { identityMemberInvited } from '../domain/events'
import { invitationExpiresInDays } from '../domain/invitation-state'
import type { PlatformOperatorActor } from './dto/platform-console.dto'
import { sendCommittedInvitationEmail } from './invitation-email-delivery'
import type { InviteMemberCommand } from './ports/identity-command-store.port'
import type { InvitationEmailSender } from './ports/invitation-email.port'

/** The inviter the email names when the operator's account has no name. */
const OPERATOR_INVITER_FALLBACK_NAME = 'The Reputation Key team'

export type AdminInvitationEmailDeps = Readonly<{
  sendEmail: InvitationEmailSender
  baseUrl: string
  invitationExpiresInMs: number
  logger: Pick<LoggerPort, 'error'>
}>

type AdminInvitation = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  email: string
  operator: PlatformOperatorActor
}>

/** An AccountAdmin invitation with no Properties, the operator as inviter. */
export function adminInvitationCommand(
  invitation: AdminInvitation,
  timing: Readonly<{ now: Date; invitationExpiresInMs: number }>,
): InviteMemberCommand {
  return {
    invitationId: invitation.invitationId,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: toBetterAuthRole('AccountAdmin'),
    inviterId: invitation.operator.userId,
    propertyIds: [],
    now: timing.now,
    expiresAt: new Date(timing.now.getTime() + timing.invitationExpiresInMs),
    event: identityMemberInvited({
      organizationId: invitation.organizationId,
      role: 'AccountAdmin',
      userId: invitation.operator.userId,
      invitationId: invitation.invitationId,
      occurredAt: timing.now,
    }),
  }
}

/** Mail a committed AccountAdmin invitation; false when the send failed (logged). */
export function sendAdminInvitationEmail(
  deps: AdminInvitationEmailDeps,
  invitation: Readonly<{
    invitationId: InvitationId
    email: string
    organizationName: string
    operator: PlatformOperatorActor
  }>,
): Promise<boolean> {
  return sendCommittedInvitationEmail(deps, async () => ({
    email: invitation.email,
    invitedByUsername: invitation.operator.name.trim() || OPERATOR_INVITER_FALLBACK_NAME,
    organizationName: invitation.organizationName,
    inviteLink: absoluteUrl(deps.baseUrl, '/accept-invitation', {
      id: invitation.invitationId as string,
    }),
    role: 'AccountAdmin',
    propertyNames: [],
    expiresInDays: invitationExpiresInDays(deps.invitationExpiresInMs),
  }))
}
