// Identity context — resend invitation use case.
// Resend renews: the same invitation row gets a fresh expiry and reads pending
// again (the command store re-checks membership and competing invitations),
// then the email goes out with the renewed lifetime.

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationEmailSender } from '../ports/invitation-email.port'
import type { PropertyNameLookup } from '../ports/invitation-read-model.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { invitationId as toInvitationId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { betaInvitationRole } from '../../domain/invitation-state'
import { INELIGIBLE_ROLE_MESSAGE } from '../../domain/invitation-copy'
import type { AcceptInvitationInput } from '../dto/invitation.dto'
import { deliverInvitationEmail } from '../invitation-email-delivery'

export type ResendInvitationInput = AcceptInvitationInput

export type ResendInvitationOutput = Readonly<{
  /** The renewed expiry. */
  expiresAt: Date
  emailSent: boolean
}>

export type ResendInvitationDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
  /** Invitation lifetime — the renewal grants a full one. */
  invitationExpiresInMs: number
  sendEmail: InvitationEmailSender
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  propertyNames: PropertyNameLookup
  baseUrl: string
  logger: LoggerPort
}>
export type ResendInvitation = ReturnType<typeof resendInvitation>

/**
 * Renew and resend an invitation.
 *
 * Steps:
 * 1. Authorize — invitation.resend
 * 2. Renew — the command store: pending or expired rows only, same row, new
 *    expiry, no fact
 * 3. Send — post-commit; a failure reports `emailSent: false`
 */
export const resendInvitation =
  (deps: ResendInvitationDeps) =>
  async (
    input: ResendInvitationInput,
    ctx: AuthContext,
  ): Promise<ResendInvitationOutput> => {
    if (!canForContext(ctx, 'invitation.resend')) {
      throw identityError('forbidden', 'Insufficient role to resend invitations')
    }

    const invitationId = toInvitationId(input.invitationId)
    const now = deps.clock()
    const renewed = await deps.commandStore.renewInvitation({
      invitationId,
      organizationId: ctx.organizationId,
      now,
      expiresAt: new Date(now.getTime() + deps.invitationExpiresInMs),
    })
    // The store refuses a non-beta role before renewing; this only narrows it.
    const role = betaInvitationRole(renewed.role)
    if (!role) {
      throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
    }

    const emailSent = await deliverInvitationEmail(deps, ctx, {
      invitationId,
      email: renewed.email,
      role,
      propertyIds: renewed.propertyIds,
    })
    return { expiresAt: renewed.expiresAt, emailSent }
  }
