// Identity context — sending the invitation email after the row is committed.
//
// invite-member and resend-invitation both commit first and mail second. A
// send that fails after the commit must not turn into a 500 while the
// invitation exists: the caller reports `emailSent: false` and the admin can
// use Resend. The failure is logged by name and code only — a transport or
// driver message can carry the invitee's address.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { absoluteUrl } from '#/shared/email/urls'
import { invitationExpiresInDays } from '../domain/invitation-state'
import type { IdentityPort } from './ports/identity.port'
import type { InvitationEmailSender } from './ports/invitation-email.port'
import type { PropertyNameLookup } from './ports/invitation-read-model.port'
import { resolveInvitationProperties } from './invitation-properties'

export type InvitationEmailDeliveryDeps = Readonly<{
  identity: Pick<IdentityPort, 'listMembers'>
  sendEmail: InvitationEmailSender
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  propertyNames: PropertyNameLookup
  baseUrl: string
  invitationExpiresInMs: number
  logger: Pick<LoggerPort, 'error'>
}>

export type InvitationEmailDelivery = Readonly<{
  invitationId: InvitationId
  email: string
  role: BetaInteractiveRole
  propertyIds: ReadonlyArray<string>
}>

const CONTENT_FREE_TOKEN = /^[A-Za-z0-9_]{1,64}$/u

/** A failure's name and code — never its message. */
function failureIdentity(error: unknown): Readonly<{
  name: string | null
  code: string | null
}> {
  if (!(error instanceof Error)) return { name: null, code: null }
  const code: unknown = 'code' in error ? error.code : undefined
  return {
    name: CONTENT_FREE_TOKEN.test(error.name) ? error.name : null,
    code: typeof code === 'string' && CONTENT_FREE_TOKEN.test(code) ? code : null,
  }
}

async function composeInvitationEmail(
  deps: InvitationEmailDeliveryDeps,
  ctx: AuthContext,
  delivery: InvitationEmailDelivery,
) {
  const organizationName = await deps.getOrganizationName(ctx)
  const members = await deps.identity.listMembers(ctx)
  const inviter = members.find((member) => member.userId === (ctx.userId as string))
  const properties =
    delivery.role === 'AccountAdmin'
      ? []
      : await resolveInvitationProperties(
          deps.propertyNames,
          ctx.organizationId,
          delivery.propertyIds,
        )
  return {
    email: delivery.email,
    invitedByUsername: inviter?.name ?? 'Organization Admin',
    organizationName,
    inviteLink: absoluteUrl(deps.baseUrl, '/accept-invitation', {
      id: delivery.invitationId as string,
    }),
    role: delivery.role,
    propertyNames: properties.map((property) => property.name),
    expiresInDays: invitationExpiresInDays(deps.invitationExpiresInMs),
  }
}

/**
 * Compose and send the invitation email for a committed invitation. Resolves
 * true once sent, false when anything after the commit failed (logged).
 */
export async function deliverInvitationEmail(
  deps: InvitationEmailDeliveryDeps,
  ctx: AuthContext,
  delivery: InvitationEmailDelivery,
): Promise<boolean> {
  try {
    await deps.sendEmail(await composeInvitationEmail(deps, ctx, delivery))
    return true
  } catch (error) {
    // Identifiers stay out of logs (observability schema); the request's
    // trace span already correlates this line.
    deps.logger.error(
      { failure: failureIdentity(error) },
      '[identity] invitation email could not be sent',
    )
    return false
  }
}
