import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffAccountDeps } from './add-staff-member.server'
import { requireStaffProperty, staffAddressRefusal } from './add-staff-member.server'
import type { StaffManagementStore } from './staff-management-store.port.server'
import { staffAccountError } from '../domain/staff-account'
import { identityError } from '../domain/errors'

export type ManageStaffDeps = StaffAccountDeps &
  Readonly<{
    management: StaffManagementStore
    invitationBudget: (ctx: AuthContext) => Promise<number>
    removeLogin: (memberId: string, userId: string, ctx: AuthContext) => Promise<void>
  }>

async function target(
  deps: ManageStaffDeps,
  participationId: string,
  ctx: AuthContext,
  permission: 'staff.invite' | 'staff.remove',
) {
  const found = await deps.management.target(ctx.organizationId, participationId)
  if (!found) throw staffAccountError('participation_not_found', 'Staff member not found')
  await requireStaffProperty(deps.store, ctx, found.propertyId, permission)
  await deps.authorizeProperty(ctx, found.propertyId, permission)
  if (permission === 'staff.invite' && !found.active)
    throw staffAccountError(
      'participation_not_found',
      'This staff participation has ended. Refresh Staff before trying again',
    )
  return found
}

export { checkStaffBatch, checkStaffSource } from './check-staff-batch.server'

async function finishRemoval(
  deps: ManageStaffDeps,
  found: NonNullable<Awaited<ReturnType<StaffManagementStore['target']>>>,
  ctx: AuthContext,
  archive = deps.portals.archive,
  memberDeparture = false,
) {
  if (found.removalComplete) return { removed: true as const }
  const run = async () => {
    const locked = memberDeparture
      ? await deps.management.target(ctx.organizationId, found.participationId)
      : await target(deps, found.participationId, ctx, 'staff.remove')
    if (!locked)
      throw staffAccountError('participation_not_found', 'Staff member not found')
    if (locked.removalComplete) return { removed: true as const }
    await deps.management.denyAccess(ctx.organizationId, locked)
    const current = await deps.management.target(
      ctx.organizationId,
      found.participationId,
    )
    if (
      !memberDeparture &&
      current &&
      !current.otherParticipations &&
      current.memberRole === 'member' &&
      current.memberId &&
      current.userId
    )
      await deps.removeLogin(current.memberId, current.userId, ctx)
    await deps.management.cancelOnboardings(ctx.organizationId, locked)
    if (locked.portalId) await archive(locked.portalId, ctx)
    await deps.management.completeRemoval(ctx.organizationId, locked)
    return { removed: true as const }
  }
  return found.email
    ? deps.store.withAddressLock(ctx.organizationId, found.email, run)
    : run()
}

export const removeStaffMember =
  (deps: ManageStaffDeps) =>
  async (input: Readonly<{ participationId: string }>, ctx: AuthContext) => {
    const found = await target(deps, input.participationId, ctx, 'staff.remove')
    return finishRemoval(deps, found, ctx)
  }

/** Called only after Remove member or Leave has authorized the departing login. */
export const removeStaffForMemberDeparture =
  (deps: ManageStaffDeps) =>
  async (userId: string, ctx: AuthContext): Promise<void> => {
    const ids = await deps.management.removalsForUser(ctx.organizationId, userId)
    try {
      for (const id of ids) {
        const found = await deps.management.target(ctx.organizationId, id)
        if (found)
          await finishRemoval(
            deps,
            found,
            ctx,
            deps.portals.archiveForMemberDeparture,
            true,
          )
      }
    } catch {
      throw identityError(
        'forbidden',
        'Staff removal is unfinished. Retry removing this member before continuing',
      )
    }
  }

export const renameStaffMember =
  (deps: ManageStaffDeps) =>
  async (
    input: Readonly<{ participationId: string; displayName: string }>,
    ctx: AuthContext,
  ) => {
    const found = await target(deps, input.participationId, ctx, 'staff.invite')
    const name = input.displayName.trim()
    if (!name || name.length > 100)
      throw staffAccountError('name_required', 'Use a name between 1 and 100 characters')
    const properties = await deps.management.propertiesForParticipant(
      ctx.organizationId,
      found.participantId,
    )
    await Promise.all(
      properties.map(async (propertyId) => {
        await requireStaffProperty(deps.store, ctx, propertyId, 'staff.invite')
        await deps.authorizeProperty(ctx, propertyId, 'staff.invite')
      }),
    )
    await deps.management.rename(
      ctx.organizationId,
      found,
      name,
      (transaction, portalIds) =>
        deps.portals.rename({ portalIds, displayName: name }, ctx, transaction),
      properties,
    )
    return { renamed: true as const }
  }

export const listStaffMembers =
  (deps: ManageStaffDeps) =>
  async (input: Readonly<{ propertyId: string }>, ctx: AuthContext) => {
    await requireStaffProperty(deps.store, ctx, input.propertyId, 'staff.read')
    await deps.authorizeProperty(ctx, input.propertyId, 'staff.read')
    const rows = await deps.management.list(ctx.organizationId, input.propertyId)
    return {
      staffScanTargetsEnabled: deps.staffScanTargetsEnabled ?? false,
      colleagueListEnabled:
        (await deps.management.getColleagues?.(ctx.organizationId, input.propertyId)) ??
        false,
      members: rows.map(({ email, ...row }) => ({
        ...row,
        ...(canForContext(ctx, 'staff.invite') ? { email } : {}),
      })),
    }
  }

export const setColleagueListEnabled =
  (deps: ManageStaffDeps) =>
  async (input: Readonly<{ propertyId: string; enabled: boolean }>, ctx: AuthContext) => {
    await requireStaffProperty(deps.store, ctx, input.propertyId, 'staff.settings')
    await deps.authorizeProperty(ctx, input.propertyId, 'staff.settings')
    await deps.management.setColleagues(
      ctx.organizationId,
      input.propertyId,
      input.enabled,
      ctx.userId,
    )
    return { enabled: input.enabled }
  }

export const resendStaffInvitation =
  (deps: ManageStaffDeps) =>
  async (input: Readonly<{ participationId: string }>, ctx: AuthContext) => {
    const found = await target(deps, input.participationId, ctx, 'staff.invite')
    if (!found.email)
      throw staffAccountError(
        'participation_not_found',
        'This staff invitation has ended',
      )
    return deps.store.withAddressLock(ctx.organizationId, found.email, async (store) => {
      await target(deps, input.participationId, ctx, 'staff.invite')
      const facts = await store.addressFacts(
        ctx.organizationId,
        found.propertyId,
        found.email!,
      )
      if (facts.organizationIds.some((id) => id !== ctx.organizationId))
        throw staffAddressRefusal(ctx, deps.reportAddressRefusal)
      const row = await deps.management.renewInvitation(
        ctx.organizationId,
        input.participationId,
      )
      await deps.spendInvitationBudget(ctx)
      try {
        await deps.deliverAccess(row, { invited: true, userId: null })
        await store.markDeliveryProblem(ctx.organizationId, input.participationId, false)
      } catch {
        await store.markDeliveryProblem(ctx.organizationId, input.participationId, true)
        deps.reportDeliveryFailure(row)
        throw staffAccountError(
          'operation_conflict',
          "The invitation email couldn't be sent. Use Resend to try again.",
        )
      }
      return { sent: true as const }
    })
  }
