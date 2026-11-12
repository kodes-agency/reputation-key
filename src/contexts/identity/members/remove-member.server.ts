// Identity context — remove member use case
// Order: authorize → validate → check invariants → build → persist → return.
// Use cases throw tagged errors at the application boundary.

import type { IdentityPort } from '../application/ports/identity.port'
import type { IdentityCommandStore } from '../application/ports/identity-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { isOwnerToken } from '#/shared/domain/roles'
import { identityError } from '../domain/errors'
import { identityMemberRemoved } from '../domain/events'
import { assertAnotherOwnerRemains } from './last-owner-guard.server'
import { userId as toUserId } from '#/shared/domain/ids'
import type { RemoveMemberInput } from '../application/dto/invitation.dto'
export type { RemoveMemberInput }

export type RemoveMemberOutput = Readonly<{
  success: boolean
}>
export type RemoveMemberDeps = Readonly<{
  removeStaffForMemberDeparture?: (userId: string, ctx: AuthContext) => Promise<void>
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
}>
export type RemoveMember = ReturnType<typeof removeMember>

/**
 * Remove a member from the organization.
 *
 * Steps:
 * 1. Authorize — check that the user's role allows removing members
 * 2. Validate — load the target member; last-owner UX guard (the command
 *    store re-enforces it, and the actor's role, under the lock)
 * 3. Persist — command store: sessions, grants, membership and the removed
 *    fact in one transaction
 *
 * Everything the member held elsewhere is released from that fact by its
 * owner: Property, Portal and Inbox responsibilities, and Google authority
 * (Integration). The membership goes first, so nothing is released for a
 * removal the store refuses, and a release that runs late re-proves what a
 * member invited again since may hold.
 */
export const removeMember =
  (deps: RemoveMemberDeps) =>
  async (input: RemoveMemberInput, ctx: AuthContext): Promise<RemoveMemberOutput> => {
    // 1. Authorize — domain permission check
    if (!canForContext(ctx, 'member.delete')) {
      throw identityError('forbidden', 'Insufficient role to remove members')
    }

    // 2. Load target member to check last-admin invariant
    const targetMember = await deps.identity.getMember(ctx, input.memberId)
    if (!targetMember) {
      throw identityError('member_not_found', 'Member not found in this organization')
    }
    if (targetMember.rawRole === 'member')
      throw identityError('forbidden', 'Remove this person from Staff')

    // Removal releases responsibilities for another AccountAdmin to reassign.
    // Check self-removal before the last-owner guard.
    if (targetMember.userId === ctx.userId) {
      throw identityError(
        'forbidden',
        'You cannot remove yourself; leaving the organization is a separate action',
      )
    }

    // 2b. Last-owner UX guard — cannot remove the last owner. Detected via the raw
    // role string so a multi-role owner ('owner,editor') still counts as an owner.
    // The command store re-checks this under the advisory lock (TOCTOU backstop).
    if (isOwnerToken(targetMember.rawRole)) {
      await assertAnotherOwnerRemains(
        deps.identity,
        ctx,
        'Cannot remove the last admin of the organization',
      )
    }

    // Staff removal is Identity's own and the store refuses a member whose
    // staff removal is unfinished, so it goes first.
    await deps.removeStaffForMemberDeparture?.(targetMember.userId, ctx)

    // 3. Persist + fact — atomic via the command store
    await deps.commandStore.removeMember({
      organizationId: ctx.organizationId,
      memberId: input.memberId,
      actorUserId: ctx.userId,
      event: identityMemberRemoved({
        organizationId: ctx.organizationId,
        userId: toUserId(targetMember.userId),
        removedBy: ctx.userId,
        occurredAt: deps.clock(),
      }),
    })

    return { success: true }
  }
