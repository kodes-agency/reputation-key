// Identity context — resend invitation use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// Use cases THROW tagged errors at the application boundary (never return Result).

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import type { AcceptInvitationInput } from '../dto/invitation.dto'

// fallow-ignore-next-line unused-type
export type ResendInvitationOutput = Readonly<{
  success: boolean
}>

/** Email sender capability — decoupled from infrastructure. */
type EmailSender = (
  params: Readonly<{
    email: string
    invitedByUsername: string
    organizationName: string
    inviteLink: string
  }>,
) => Promise<void>

type Deps = Readonly<{
  identity: IdentityPort
  sendEmail: EmailSender
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  baseUrl: string
}>

/**
 * Resend an invitation email.
 *
 * Steps:
 * 1. Authorize — permission check via centralized can()
 * 2. Validate — DTO validation already happened at the server boundary
 * 3. Check business invariants — invitation must exist and belong to the org
 * 4. Send email — re-send the invitation link to the invitee
 * 5. Return success
 */
export const resendInvitation =
  (deps: Deps) =>
  async (
    input: AcceptInvitationInput,
    ctx: AuthContext,
  ): Promise<ResendInvitationOutput> => {
    // 1. Authorize — permission check
    if (!can(ctx.role, 'invitation.resend')) {
      throw identityError('forbidden', 'Insufficient role to resend invitations')
    }

    // 3. Check business invariants — invitation must exist
    const invitations = await deps.identity.listInvitations(ctx)
    const invitation = invitations.find((inv) => inv.id === input.invitationId)

    if (!invitation) {
      throw identityError('invitation_not_found', 'Invitation not found')
    }

    // 4. Send email — re-send the invitation link
    const organizationName = await deps.getOrganizationName(ctx)
    const inviteLink = `${deps.baseUrl}/accept-invitation?id=${invitation.id}`

    // Look up the current user's name from the org member list.
    // Fallback to a generic label if the member record isn't available.
    const members = await deps.identity.listMembers(ctx)
    const currentMember = members.find((m) => m.userId === ctx.userId)
    const invitedByUsername = currentMember?.name ?? 'Organization Admin'

    await deps.sendEmail({
      email: invitation.email,
      invitedByUsername,
      organizationName,
      inviteLink,
    })

    return { success: true }
  }
