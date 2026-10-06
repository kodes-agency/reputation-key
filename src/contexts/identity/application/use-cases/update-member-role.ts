// Identity context — update member role use case
// Order: authorize → validate → check invariants → build → persist → return.
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
import { assertAnotherOwnerRemains } from './last-owner-guard'
import { userId as toUserId } from '#/shared/domain/ids'
import type { UpdateMemberRoleInput } from '../dto/invitation.dto'
export type { UpdateMemberRoleInput }

export type UpdateMemberRoleOutput = Readonly<{
  success: boolean
}>
export type UpdateMemberRoleDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
  /**
   * Converge a demoted AccountAdmin's Google connector once the demotion has
   * committed: cancel the imports of the connections it authorized.
   */
  prepareGoogleConnectorDeparture?: (
    organizationId: string,
    userId: string,
    cause: 'account_admin_role_lost',
  ) => Promise<void>
}>
export type UpdateMemberRole = ReturnType<typeof updateMemberRole>

/**
 * Update a member's role in the organization.
 *
 * Steps:
 * 1. Authorize — check that the changer's role allows the target role assignment
 * 2. Validate referenced entities — load the target member to get their current role
 * 3. Check business invariants — role hierarchy with the actual current role,
 *    no self-change, no same-role change, then the last-owner UX guard (the
 *    command store re-enforces it under the org advisory lock)
 * 4. Persist — command store: role update + role_changed fact, atomic
 * 5. Converge — reconcile Responsible Manager eligibility, then, for a demoted
 *    AccountAdmin, the Google connector they authorized
 * 6. Return
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
    const authResult = canChangeRole(ctx.role, targetMember.role ?? 'Member', input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 3a. Nobody changes their own role, and a change must change something —
    // both before the last-owner guard, so they are never reported as it. The
    // role_changed fact also asserts a real transition.
    if (targetMember.userId === ctx.userId) {
      throw identityError('forbidden', 'Ask another Account Admin to change your role')
    }
    if (targetMember.role === input.role) {
      throw identityError('validation_error', 'The member already has this role')
    }

    // 3b. Last-owner UX guard — cannot demote the last owner. Detected via the raw
    // role string so a multi-role owner ('owner,editor') still counts as an owner
    // even though its built-in Role is null. The command store re-checks this
    // under the advisory lock (TOCTOU backstop).
    const demotesAccountAdmin =
      isOwnerToken(targetMember.rawRole) && input.role !== ADMIN_ROLE
    if (demotesAccountAdmin) {
      await assertAnotherOwnerRemains(
        deps.identity,
        ctx,
        'Cannot demote the last admin of the organization',
      )
    }

    // 4. Persist + fact — atomic via the command store
    await deps.commandStore.changeMemberRole({
      organizationId: ctx.organizationId,
      memberId: input.memberId,
      newRole: toBetterAuthRole(input.role),
      event: identityMemberRoleChanged({
        organizationId: ctx.organizationId,
        memberUserId: toUserId(targetMember.userId),
        previousRole: targetMember.role ?? 'Member',
        newRole: input.role,
        userId: ctx.userId,
        occurredAt: deps.clock(),
      }),
    })

    // 5. Converge, only now that the demotion is known to have won: a store
    // refusal (another AccountAdmin's concurrent demotion taking the last-owner
    // slot, a removed member) must leave the connector and its imports alone.
    // Provider use is not left open meanwhile — the member row's trigger fenced
    // the connector in the role change's own transaction — so what remains is
    // cancelling imports a reauth_required connection can no longer run. That
    // is why the Responsible Manager reconcile goes first.
    await deps.reconcileResponsibleManagerEligibility?.(
      ctx.organizationId,
      targetMember.userId,
      ctx.userId,
    )
    if (demotesAccountAdmin) {
      await deps.prepareGoogleConnectorDeparture?.(
        ctx.organizationId,
        targetMember.userId,
        'account_admin_role_lost',
      )
    }

    return { success: true }
  }
