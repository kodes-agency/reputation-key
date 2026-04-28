// Identity context — update member role use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// This started as a thin use case but evolved to full: loading the target member
// is step 2 (validate referenced entities), and the role hierarchy check with the
// actual current role is step 3 (check business invariants).

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { can } from '#/shared/domain/permissions'
import { canChangeRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { memberRoleChanged } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
import type { UpdateMemberRoleInput } from '../dto/invitation.dto'

export type UpdateMemberRoleOutput = Readonly<{
  success: boolean
}>

type Deps = Readonly<{
  identity: IdentityPort
  events: EventBus
  clock: () => Date
}>

/**
 * Update a member's role in the organization.
 *
 * Steps:
 * 1. Authorize — check that the changer's role allows the target role assignment
 * 2. Validate referenced entities — load the target member to get their current role
 * 3. Check business invariants — role hierarchy with the actual current role
 * 4. Persist — delegate to the identity port
 * 5. Emit — member.role-changed event
 * 6. Return
 */
export const updateMemberRole =
  (deps: Deps) =>
  async (
    input: UpdateMemberRoleInput,
    ctx: AuthContext,
  ): Promise<UpdateMemberRoleOutput> => {
    // 1. Authorize — permission check + role hierarchy
    if (!can(ctx.role, 'member.update')) {
      throw identityError('forbidden', 'Insufficient role to change member roles')
    }

    // 2. Validate referenced entities — load the target member
    const targetMember = await deps.identity.getMember(ctx, input.memberId)
    if (!targetMember) {
      throw identityError('member_not_found', 'Member not found in this organization')
    }

    // 3. Check business invariants — role hierarchy with actual current role
    const authResult = canChangeRole(ctx.role, targetMember.role, input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 4. Persist
    await deps.identity.updateMemberRole(ctx, input.memberId, input.role)

    // 5. Emit event
    deps.events.emit(
      memberRoleChanged({
        organizationId: ctx.organizationId,
        userId: toUserId(targetMember.userId),
        previousRole: targetMember.role,
        newRole: input.role,
        changedBy: ctx.userId,
        occurredAt: deps.clock(),
      }),
    )

    return { success: true }
  }
