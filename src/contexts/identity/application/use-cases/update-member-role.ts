// Identity context — update member role use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// This started as a thin use case but evolved to full: loading the target member
// is step 2 (validate referenced entities), and the role hierarchy check with the
// actual current role is step 3 (check business invariants).

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { ADMIN_ROLE, isOwnerToken, toBetterAuthRole } from '#/shared/domain/roles'
import { canChangeRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { identityMemberRoleChanged } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
import type { UpdateMemberRoleInput } from '../dto/invitation.dto'
export type { UpdateMemberRoleInput }

// fallow-ignore-next-line unused-type
export type UpdateMemberRoleOutput = Readonly<{
  success: boolean
}>
export type UpdateMemberRoleDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
}>
export type UpdateMemberRole = ReturnType<typeof updateMemberRole>

/**
 * Update a member's role in the organization.
 *
 * Steps:
 * 1. Authorize — check that the changer's role allows the target role assignment
 * 2. Validate referenced entities — load the target member to get their current role
 * 3. Check business invariants — role hierarchy with the actual current role,
 *    plus the last-owner UX guard (the command store re-enforces it under the
 *    org advisory lock)
 * 4. Persist + emit — command store: role update + role_changed fact, atomic
 * 5. Return
 */
export const updateMemberRole =
  (deps: UpdateMemberRoleDeps) =>
  async (
    input: UpdateMemberRoleInput,
    ctx: AuthContext,
  ): Promise<UpdateMemberRoleOutput> => {
    // 1. Authorize — permission check + role hierarchy
    if (!canForContext(ctx, 'member.update')) {
      throw identityError('forbidden', 'Insufficient role to change member roles')
    }

    // 2. Validate referenced entities — load the target member
    const targetMember = await deps.identity.getMember(ctx, input.memberId)
    if (!targetMember) {
      throw identityError('member_not_found', 'Member not found in this organization')
    }

    // 3. Check business invariants — role hierarchy with actual current role
    const authResult = canChangeRole(ctx.role, targetMember.role ?? 'Staff', input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 3b. Last-owner UX guard — cannot demote the last owner. Detected via the raw
    // role string so a multi-role owner ('owner,editor') still counts as an owner
    // even though its built-in Role is null. The command store re-checks this
    // under the advisory lock (TOCTOU backstop).
    if (isOwnerToken(targetMember.rawRole) && input.role !== ADMIN_ROLE) {
      const members = await deps.identity.listMembers(ctx)
      const ownerCount = members.filter((m) => isOwnerToken(m.rawRole)).length
      if (ownerCount <= 1) {
        throw identityError(
          'forbidden',
          'Cannot demote the last admin of the organization',
        )
      }
    }

    // 4. Persist + fact — atomic via the command store
    await deps.commandStore.changeMemberRole({
      organizationId: ctx.organizationId,
      memberId: input.memberId,
      newRole: toBetterAuthRole(input.role),
      event: identityMemberRoleChanged({
        organizationId: ctx.organizationId,
        memberUserId: toUserId(targetMember.userId),
        previousRole: targetMember.role ?? 'Staff',
        newRole: input.role,
        userId: ctx.userId,
        occurredAt: deps.clock(),
      }),
    })

    return { success: true }
  }
