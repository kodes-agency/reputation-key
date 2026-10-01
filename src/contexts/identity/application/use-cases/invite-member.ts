// Identity context — invite member use case
// Order: authorize → validate → check invariants → build → persist → return.
// Use cases throw tagged errors at the application boundary (never return Result).

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationEmailSender } from '../ports/invitation-email.port'
import type { PropertyNameLookup } from '../ports/invitation-read-model.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { canForContext } from '#/shared/domain/permissions'
import { toBetterAuthRole } from '#/shared/domain/roles'
import { canInviteWithRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { identityMemberInvited } from '../../domain/events'
import type { InviteMemberInput } from '../dto/invitation.dto'
import { deliverInvitationEmail } from '../invitation-email-delivery'

export type { InviteMemberInput }
export type { InvitationEmailSender }
export type InviteMember = ReturnType<typeof inviteMember>

export type InviteMemberDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
  idGen: () => InvitationId
  /** Invitation lifetime — wired from INVITATION_EXPIRY_SECONDS in composition. */
  invitationExpiresInMs: number
  sendEmail: InvitationEmailSender
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  propertyNames: PropertyNameLookup
  baseUrl: string
  logger: LoggerPort
}>

/** The invitation exists once this resolves; `emailSent` says whether it was mailed. */
export type InviteMemberResult = Readonly<{
  invitationId: InvitationId
  emailSent: boolean
}>

/**
 * Invite a member to the organization.
 *
 * Steps:
 * 1. Authorize — permission check via centralized can()
 * 2. Validate — DTO validation already happened at the server boundary
 * 3. Check business invariants — domain rule restricts target role hierarchy
 * 4. Persist — the command store commits the invitation row and the
 *    member.invited fact in ONE transaction (BQC-3.5)
 * 5. Send the invitation email post-commit. A failure there no longer fails
 *    the request: the invitation exists, so the result says `emailSent:
 *    false` and the admin can use Resend.
 */
export const inviteMember =
  (deps: InviteMemberDeps) =>
  async (input: InviteMemberInput, ctx: AuthContext): Promise<InviteMemberResult> => {
    // 1. Authorize — permission check + role hierarchy
    if (!canForContext(ctx, 'invitation.create')) {
      throw identityError('forbidden', 'Insufficient role to invite members')
    }

    // 3. Check business invariants — domain rule restricts target role
    const authResult = canInviteWithRole(ctx.role, input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // An AccountAdmin reaches every Property; stored Property ids would only
    // mislead the Members page and the email.
    const propertyIds = input.role === 'AccountAdmin' ? [] : (input.propertyIds ?? [])

    // 4. Persist + fact — atomic via the command store
    const invitationId = deps.idGen()
    const now = deps.clock()
    await deps.commandStore.inviteMember({
      invitationId,
      organizationId: ctx.organizationId,
      email: input.email,
      role: toBetterAuthRole(input.role),
      inviterId: ctx.userId,
      propertyIds,
      now,
      expiresAt: new Date(now.getTime() + deps.invitationExpiresInMs),
      event: identityMemberInvited({
        organizationId: ctx.organizationId,
        role: input.role,
        userId: ctx.userId,
        invitationId,
        occurredAt: now,
      }),
    })

    // 5. Send the invitation email — post-commit side effect.
    const emailSent = await deliverInvitationEmail(deps, ctx, {
      invitationId,
      email: input.email,
      role: input.role,
      propertyIds,
    })
    return { invitationId, emailSent }
  }
