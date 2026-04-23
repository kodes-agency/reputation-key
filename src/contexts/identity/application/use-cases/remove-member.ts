// Identity context — remove member use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// Use cases THROW tagged errors at the application boundary.

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { canManageUsers } from '../../domain/permissions'
import { identityError } from '../../domain/errors'
import { memberRemoved } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
import type { RemoveMemberInput } from '../dto/invitation.dto'

export type RemoveMemberOutput = Readonly<{
  success: boolean
}>

type Deps = Readonly<{ identity: IdentityPort; events: EventBus }>

/**
 * Remove a member from the organization.
 *
 * Steps:
 * 1. Authorize — check that the user's role allows removing members
 * 2. Persist — delegate to the identity port
 * 3. Emit — member.removed event
 */
export const removeMember =
  (deps: Deps) =>
  async (input: RemoveMemberInput, ctx: AuthContext): Promise<RemoveMemberOutput> => {
    // 1. Authorize — domain permission check
    if (!canManageUsers(ctx.role)) {
      throw identityError('forbidden', 'Insufficient role to remove members')
    }

    // 2. Persist — delegate to port (better-auth handles the rest)
    await deps.identity.removeMember(ctx, input.memberId)

    // 3. Emit event
    deps.events.emit(
      memberRemoved({
        organizationId: ctx.organizationId,
        userId: toUserId(input.memberId), // memberId is the member's user-facing ID
        removedBy: ctx.userId,
        occurredAt: new Date(),
      }),
    )

    return { success: true }
  }
