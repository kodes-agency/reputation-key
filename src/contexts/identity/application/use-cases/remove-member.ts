// Identity context — remove member use case
// Per architecture: "Every use case follows this order:
// 1. Authorize → 2. Validate → 3. Check invariants → 4. Build → 5. Persist → 6. Emit → 7. Return"
// Use cases THROW tagged errors at the application boundary.

import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { isOwnerToken } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import { identityMemberRemoved } from '../../domain/events'
import { userId as toUserId, type OrganizationId } from '#/shared/domain/ids'
import type { RemoveMemberInput } from '../dto/invitation.dto'
export type { RemoveMemberInput }

export type RemoveMemberOutput = Readonly<{
  success: boolean
}>
export type RemoveMemberDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  clock: () => Date
  /** Fail-closed import lifecycle fence before membership removal. */
  cancelGoogleImportsForUser?: (
    organizationId: OrganizationId,
    userId: string,
  ) => Promise<void>
  /** Fence any current OAuth grant authorized by the departing member. */
  prepareGoogleConnectorDeparture?: (
    organizationId: OrganizationId,
    userId: string,
    cause: 'member_removed',
  ) => Promise<void>
  /** Release Inbox/manager/access authorities without requiring replacements. */
  releaseMemberAuthorities?: (
    organizationId: OrganizationId,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>
export type RemoveMember = ReturnType<typeof removeMember>

/**
 * Remove a member from the organization.
 *
 * Steps:
 * 1. Authorize — check that the user's role allows removing members
 * 2. Validate — load the target member; last-owner UX guard (the command
 *    store re-enforces the same invariant under the org advisory lock)
 * 3. Persist + emit — command store: member delete + removed fact, atomic
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

    // 2b. Last-owner UX guard — cannot remove the last owner. Detected via the raw
    // role string so a multi-role owner ('owner,editor') still counts as an owner.
    // The command store re-checks this under the advisory lock (TOCTOU backstop).
    if (isOwnerToken(targetMember.rawRole)) {
      const members = await deps.identity.listMembers(ctx)
      const ownerCount = members.filter((m) => isOwnerToken(m.rawRole)).length
      if (ownerCount <= 1) {
        throw identityError(
          'forbidden',
          'Cannot remove the last admin of the organization',
        )
      }
    }

    // LIF-01-T21 ordering, and it is deliberate. These two fences belong to
    // Integration and cannot join the Identity transaction, so they run FIRST:
    // a fenced connector with a surviving membership is a repairable state
    // (`repairPartialOffboarding` converges it), while a deleted membership
    // with a live provider grant is not. `property_access_grant` revocation
    // moved OUT of `releaseMemberAuthorities` and INTO the command-store
    // transaction for the same reason — Identity owns that table, so there is
    // no excuse for revoking it in a separate commit.
    await deps.prepareGoogleConnectorDeparture?.(
      ctx.organizationId,
      targetMember.userId,
      'member_removed',
    )
    await deps.cancelGoogleImportsForUser?.(ctx.organizationId, targetMember.userId)
    await deps.releaseMemberAuthorities?.(
      ctx.organizationId,
      targetMember.userId,
      ctx.userId,
    )

    // 3. Persist + fact — atomic via the command store
    await deps.commandStore.removeMember({
      organizationId: ctx.organizationId,
      memberId: input.memberId,
      event: identityMemberRemoved({
        organizationId: ctx.organizationId,
        userId: toUserId(targetMember.userId),
        removedBy: ctx.userId,
        occurredAt: deps.clock(),
      }),
    })

    return { success: true }
  }
