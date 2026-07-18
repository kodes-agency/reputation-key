// Identity context — invite member use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// Use cases THROW tagged errors at the application boundary (never return Result).

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { toBetterAuthRole } from '#/shared/domain/roles'
import { canInviteWithRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { identityMemberInvited } from '../../domain/events'
import type { InviteMemberInput } from '../dto/invitation.dto'

// fallow-ignore-next-line unused-type
export type { InviteMemberInput }
export type InviteMember = ReturnType<typeof inviteMember>

/** Invitation email sender — same payload as the resend-invitation path. */
export type InvitationEmailSender = (params: {
  email: string
  invitedByUsername: string
  organizationName: string
  inviteLink: string
}) => Promise<void>

export type InviteMemberDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
  idGen: () => InvitationId
  /** Invitation lifetime — wired from INVITATION_EXPIRY_SECONDS in composition. */
  invitationExpiresInMs: number
  sendEmail: InvitationEmailSender
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  baseUrl: string
}>

/**
 * Invite a member to the organization.
 *
 * Steps:
 * 1. Authorize — permission check via centralized can()
 * 2. Validate — DTO validation already happened at the server boundary
 * 3. Check business invariants — domain rule restricts target role hierarchy
 * 4. Persist + emit — the command store commits the invitation row and the
 *    member.invited fact in ONE transaction (BQC-3.5; previously better-auth
 *    created the row and the fact was a separate, losable write)
 * 5. Send the invitation email (post-commit — previously sent inside
 *    better-auth's createInvitation)
 */
export const inviteMember =
  (deps: InviteMemberDeps) =>
  async (input: InviteMemberInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize — permission check + role hierarchy
    if (!canForContext(ctx, 'invitation.create')) {
      throw identityError('forbidden', 'Insufficient role to invite members')
    }

    // 3. Check business invariants — domain rule restricts target role
    const authResult = canInviteWithRole(ctx.role, input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 4. Persist + fact — atomic via the command store
    const invitationId = deps.idGen()
    const now = deps.clock()
    await deps.commandStore.inviteMember({
      invitationId,
      organizationId: ctx.organizationId,
      email: input.email,
      role: toBetterAuthRole(input.role),
      inviterId: ctx.userId,
      propertyIds: input.propertyIds ?? [],
      now,
      expiresAt: new Date(now.getTime() + deps.invitationExpiresInMs),
      event: identityMemberInvited({
        organizationId: ctx.organizationId,
        email: input.email,
        role: input.role,
        userId: ctx.userId,
        invitationId,
        occurredAt: now,
      }),
    })

    // 5. Send the invitation email — post-commit side effect. Resolution
    //    mirrors resend-invitation (org name + inviter display name).
    const organizationName = await deps.getOrganizationName(ctx)
    const members = await deps.identity.listMembers(ctx)
    const inviter = members.find((m) => m.userId === ctx.userId)
    await deps.sendEmail({
      email: input.email,
      invitedByUsername: inviter?.name ?? 'Organization Admin',
      organizationName,
      inviteLink: `${deps.baseUrl}/accept-invitation?id=${invitationId as string}`,
    })

    return
  }
