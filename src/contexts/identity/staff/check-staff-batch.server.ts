import type { AuthContext } from '#/shared/domain/auth-context'
import type { ManageStaffDeps } from './manage-staff-accounts.server'
import type { StaffPortalPlan } from './staff-portal-provisioner.port.server'
import { staffAccountError } from '../domain/staff-account'
import {
  requireStaffProperty,
  staffRowProblem,
  staffRowCodeForActor,
} from './add-staff-member.server'

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
    await deps.spendAddressCheckBudget(ctx, input.rows.length)
    const emails = input.rows.map((row) => row.email.trim().toLowerCase())
    const rows = await Promise.all(
      input.rows.map(async (row, index) => {
        const email = emails[index]!
        const basic = staffRowProblem(row)
        const duplicate = emails.filter((value) => value === email).length > 1
        const facts =
          basic || duplicate
            ? null
            : await deps.store.addressFacts(ctx.organizationId, input.propertyId, email)
        const code =
          basic ??
          (duplicate
            ? 'duplicate_in_batch'
            : staffRowProblem(row, facts ?? undefined, ctx.organizationId))
        return {
          code:
            staffRowCodeForActor(code, ctx, deps.reportAddressRefusal) ?? ('ok' as const),
          needsInvitation:
            !facts?.userId || !facts.organizationIds.includes(ctx.organizationId),
        }
      }),
    )
    const remainingInvitations = await deps.invitationBudget(ctx)
    try {
      const plan = await deps.portals.check(
        { ...input, displayNames: input.rows.map((row) => row.displayName) },
        ctx,
      )
      return {
        rows: rows.map(({ code }) => ({ code })),
        invitationsRequired: rows.filter(
          (row) => row.code === 'ok' && row.needsInvitation,
        ).length,
        code: null,
        omittedLinks: plan.omittedLinks,
        remainingInvitations,
      }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'preflight_failed'
      return {
        rows: rows.map(({ code }) => ({ code })),
        invitationsRequired: rows.filter(
          (row) => row.code === 'ok' && row.needsInvitation,
        ).length,
        code,
        omittedLinks: [],
        remainingInvitations,
      }
    }
  }

export const checkStaffSource =
  (deps: ManageStaffDeps) => async (input: StaffPortalPlan, ctx: AuthContext) => {
    await requireStaffProperty(deps.store, ctx, input.propertyId, 'staff.invite')
    await deps.authorizeProperty(ctx, input.propertyId, 'staff.invite')
    return deps.portals.check(input, ctx)
  }
