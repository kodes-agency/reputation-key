import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffAccountDeps } from './add-staff-member'
import { requireStaffProperty, staffRowProblem } from './add-staff-member'
import type { StaffManagementStore } from '../ports/staff-management-store.port'
import type { StaffPortalPlan } from '../ports/staff-portal-provisioner.port'
import { staffAccountError } from '../../domain/staff-account'

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

export const checkStaffBatch =
  (deps: ManageStaffDeps) =>
  async (
    input: StaffPortalPlan &
      Readonly<{ rows: readonly Readonly<{ email: string; displayName: string }>[] }>,
    ctx: AuthContext,
  ) => {
    await requireStaffProperty(deps.store, ctx, input.propertyId, 'staff.invite')
    await deps.authorizeProperty(ctx, input.propertyId, 'staff.invite')
    if (input.rows.length > 20)
      throw staffAccountError('operation_conflict', 'Check at most 20 people at once')
    const emails = input.rows.map((row) => row.email.trim().toLowerCase())
    const rows = await Promise.all(
      input.rows.map(async (row, index) => {
        const email = emails[index]!
        const basic = staffRowProblem(row)
        const duplicate = emails.filter((value) => value === email).length > 1
        const code =
          basic ??
          (duplicate
            ? 'duplicate_in_batch'
            : staffRowProblem(
                row,
                await deps.store.addressFacts(
                  ctx.organizationId,
                  input.propertyId,
                  email,
                ),
                ctx.organizationId,
              ))
        return code ? { code } : { code: 'ok' as const }
      }),
    )
    const remainingInvitations = await deps.invitationBudget(ctx)
    try {
      const plan = await deps.portals.check(input, ctx)
      return { rows, code: null, omittedLinks: plan.omittedLinks, remainingInvitations }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'preflight_failed'
      return { rows, code, omittedLinks: [], remainingInvitations }
    }
  }

export const removeStaffMember =
  (deps: ManageStaffDeps) =>
  async (input: Readonly<{ participationId: string }>, ctx: AuthContext) => {
    const found = await target(deps, input.participationId, ctx, 'staff.remove')
    if (found.removalComplete) return { removed: true as const }
    const run = async () => {
      const locked = await target(deps, input.participationId, ctx, 'staff.remove')
      if (locked.removalComplete) return { removed: true as const }
      await deps.management.denyAccess(ctx.organizationId, locked)
      const current = await deps.management.target(
        ctx.organizationId,
        found.participationId,
      )
      if (
        current &&
        !current.otherParticipations &&
        current.memberRole === 'member' &&
        current.memberId &&
        current.userId
      )
        await deps.removeLogin(current.memberId, current.userId, ctx)
      await deps.management.cancelOnboardings(ctx.organizationId, locked)
      if (locked.portalId) await deps.portals.archive(locked.portalId, ctx)
      await deps.management.completeRemoval(ctx.organizationId, locked)
      return { removed: true as const }
    }
    return found.email ? deps.store.withAddressLock(found.email, run) : run()
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
    return deps.store.withAddressLock(found.email, async (store) => {
      await target(deps, input.participationId, ctx, 'staff.invite')
      const facts = await store.addressFacts(
        ctx.organizationId,
        found.propertyId,
        found.email!,
      )
      if (facts.organizationIds.some((id) => id !== ctx.organizationId))
        throw staffAccountError(
          'other_organization',
          'This address belongs to another Organization',
        )
      await deps.spendInvitationBudget(ctx)
      const row = await deps.management.renewInvitation(
        ctx.organizationId,
        input.participationId,
      )
      await deps.deliverAccess(row, { invited: true, userId: null })
      return { sent: true as const }
    })
  }
