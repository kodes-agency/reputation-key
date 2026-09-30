// Identity context — AccountAdmins read and edit which Properties each
// PropertyManager can work, from Members. Grants and revokes commit with one
// identity.member.property_access_changed fact; a request that revokes then
// releases any Responsible Manager duty the member can no longer hold.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { userId as toUserId } from '#/shared/domain/ids'
import { identityError } from '../../domain/errors'
import { identityMemberPropertyAccessChanged } from '../../domain/events'
import type { IdentityPort } from '../ports/identity.port'
import type { MemberPropertyAccessStore } from '../ports/member-property-access.port'
import type {
  ListMemberPropertyAccessOutput,
  SetMemberPropertyAccessInput,
  SetMemberPropertyAccessOutput,
} from '../dto/member-access.dto'

export type SetMemberPropertyAccessDeps = Readonly<{
  identity: IdentityPort
  store: MemberPropertyAccessStore
  clock: () => Date
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

export type ListMemberPropertyAccessDeps = Readonly<{
  store: MemberPropertyAccessStore
  clock: () => Date
}>

/**
 * Only an Organization-wide `member.update` holder administers access: the
 * grants of every member are visible and editable here.
 */
function requireOrganizationMemberAdministration(ctx: AuthContext, message: string) {
  if (
    !canForContext(ctx, 'member.update') ||
    scopeForPermission(ctx, 'member.update') !== 'organization'
  ) {
    throw identityError('forbidden', message)
  }
}

const unique = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(ids)]

/**
 * Grant and revoke Properties for one PropertyManager.
 *
 * Steps:
 * 1. Authorize — member.update at Organization scope
 * 2. Validate the target — a member of this Organization, not the caller,
 *    and a PropertyManager (an AccountAdmin already reaches every Property)
 * 3. Persist — the store applies what changes and records the fact atomically
 * 4. Reconcile — a request that revokes releases responsibilities the member
 *    lost. Decided by the request, not by what this call revoked: the
 *    reconcile runs after the commit, so if it fails, repeating the request
 *    (which then revokes nothing) must still run it. It is idempotent.
 */
export const setMemberPropertyAccess =
  (deps: SetMemberPropertyAccessDeps) =>
  async (
    input: SetMemberPropertyAccessInput,
    ctx: AuthContext,
  ): Promise<SetMemberPropertyAccessOutput> => {
    requireOrganizationMemberAdministration(
      ctx,
      'Only Account Admins can change property access',
    )

    const target = await deps.identity.getMember(ctx, input.memberId)
    if (!target) {
      throw identityError('member_not_found', 'Member not found in this organization')
    }
    if (target.userId === ctx.userId) {
      throw identityError('forbidden', 'You cannot change your own property access')
    }
    if (target.role !== 'PropertyManager') {
      throw identityError('validation_error', 'Account Admins can access every property')
    }

    const now = deps.clock()
    const memberUserId = toUserId(target.userId)
    const revokePropertyIds = unique(input.revokePropertyIds)
    const applied = await deps.store.setPropertyAccess({
      organizationId: ctx.organizationId,
      userId: memberUserId,
      actorUserId: ctx.userId,
      grantPropertyIds: unique(input.grantPropertyIds),
      revokePropertyIds,
      now,
      buildEvent: (changed) =>
        identityMemberPropertyAccessChanged({
          organizationId: ctx.organizationId,
          memberUserId,
          userId: ctx.userId,
          grantedPropertyIds: changed.grantedPropertyIds,
          revokedPropertyIds: changed.revokedPropertyIds,
          occurredAt: now,
        }),
    })

    if (revokePropertyIds.length > 0) {
      await deps.reconcileResponsibleManagerEligibility?.(
        ctx.organizationId,
        target.userId,
        ctx.userId,
      )
    }
    return applied
  }

/** Every member's active Property grants, for the Members page. */
export const listMemberPropertyAccess =
  (deps: ListMemberPropertyAccessDeps) =>
  async (_input: void, ctx: AuthContext): Promise<ListMemberPropertyAccessOutput> => {
    requireOrganizationMemberAdministration(
      ctx,
      'Only Account Admins can view property access',
    )
    return {
      access: await deps.store.listActiveByOrganization(ctx.organizationId, deps.clock()),
    }
  }

export type SetMemberPropertyAccess = ReturnType<typeof setMemberPropertyAccess>
export type ListMemberPropertyAccess = ReturnType<typeof listMemberPropertyAccess>
