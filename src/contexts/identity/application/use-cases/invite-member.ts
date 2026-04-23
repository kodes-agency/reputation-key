// Identity context — invite member use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// Use cases THROW tagged errors at the application boundary (never return Result).

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { canInviteWithRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { memberInvited } from '../../domain/events'
import type { InviteMemberInput } from '../dto/invitation.dto'

export type { InviteMemberInput }
export type InviteMemberOutput = Readonly<{
  success: boolean
}>

type Deps = Readonly<{ identity: IdentityPort; events: EventBus }>

/**
 * Invite a member to the organization.
 *
 * Steps:
 * 1. Authorize — check that the inviter's role allows inviting with the target role
 * 2. Validate — DTO validation already happened at the server boundary
 * 3. Persist — delegate to the identity port
 * 4. Emit — member.invited event
 */
export const inviteMember =
  (deps: Deps) =>
  async (input: InviteMemberInput, ctx: AuthContext): Promise<InviteMemberOutput> => {
    // 1. Authorize — domain rule checks role hierarchy
    const authResult = canInviteWithRole(ctx.role, input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 3. Persist — delegate to port (better-auth handles the rest)
    const invitationId = await deps.identity.createInvitation(
      ctx,
      input.email,
      input.role,
    )

    // 4. Emit event
    deps.events.emit(
      memberInvited({
        organizationId: ctx.organizationId,
        email: input.email,
        role: input.role,
        inviterId: ctx.userId,
        invitationId,
        occurredAt: new Date(),
      }),
    )

    return { success: true }
  }
