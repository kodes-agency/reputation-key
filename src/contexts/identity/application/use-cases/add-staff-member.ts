import { z } from 'zod/v4'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import {
  STAFF_ONBOARDING_STEPS,
  staffAccountError,
  staffOnboardingResult,
  type StaffOnboarding,
  type StaffRowCode,
} from '../../domain/staff-account'
import type {
  StaffAccountStore,
  StaffAddressFacts,
} from '../ports/staff-account-store.port'
import type {
  StaffPortalPlan,
  StaffPortalProvisioner,
} from '../ports/staff-portal-provisioner.port'

export type AddStaffInput = StaffPortalPlan &
  Readonly<{ operationId: string; email: string; displayName: string }>
export type StaffAccountDeps = Readonly<{
  authorizeProperty: (
    ctx: AuthContext,
    propertyId: string,
    action: 'staff.invite' | 'staff.remove' | 'staff.read' | 'staff.settings',
  ) => Promise<void>
  store: StaffAccountStore
  portals: StaffPortalProvisioner
  idGen: () => string
  spendAddressCheckBudget: (ctx: AuthContext, units: number) => Promise<void>
  reportDeliveryFailure: (row: StaffOnboarding) => void
  invitationBudget: (ctx: AuthContext) => Promise<number>
  spendInvitationBudget: (ctx: AuthContext) => Promise<void>
  deliverAccess: (
    row: StaffOnboarding,
    access: Readonly<{ invited: boolean; userId: string | null }>,
  ) => Promise<void>
}>

export async function requireStaffProperty(
  store: Pick<StaffAccountStore, 'propertyIds'>,
  ctx: AuthContext,
  propertyId: string,
  permission: 'staff.invite' | 'staff.remove' | 'staff.read' | 'staff.settings',
) {
  if (!canForContext(ctx, permission))
    throw staffAccountError('forbidden', 'This account cannot manage staff')
  const allowed = await store.propertyIds(ctx)
  if (allowed !== null && !allowed.includes(propertyId))
    throw staffAccountError('forbidden', 'Choose a Property you can work at')
}

export function staffRowProblem(
  input: Readonly<{ email: string; displayName: string }>,
  facts?: StaffAddressFacts,
  organizationId?: string,
): StaffRowCode | null {
  if (!z.email().max(320).safeParse(input.email.trim()).success) return 'invalid_email'
  if (!input.displayName.trim() || input.displayName.trim().length > 100)
    return 'name_required'
  if ((facts?.staffDisplayName?.length ?? 0) > 100) return 'name_required'
  if (facts?.organizationIds.some((id) => id !== organizationId))
    return 'other_organization'
  if (facts?.alreadyInvited) return 'already_invited'
  return facts?.alreadyStaffHere ? 'already_staff_here' : null
}

const failureCodeOf = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  /^[a-z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'step_failed'

const rowMessages: Partial<Record<StaffRowCode, string>> = {
  already_invited:
    "This address already has an open invitation. Add them here once they've accepted.",
  other_organization: 'This address belongs to another Organization',
}

async function runSteps(
  deps: StaffAccountDeps,
  store: StaffAccountStore,
  initial: StaffOnboarding,
  ctx: AuthContext,
) {
  let row = initial
  try {
    const start = STAFF_ONBOARDING_STEPS.indexOf(row.step)
    for (const step of STAFF_ONBOARDING_STEPS.slice(start)) {
      const actor = await store.currentActor(ctx)
      if (!actor)
        throw staffAccountError(
          'forbidden',
          'Your manager access has changed. Ask an Account Admin to continue this operation',
        )
      await requireStaffProperty(store, actor, row.propertyId, 'staff.invite')
      await deps.authorizeProperty(actor, row.propertyId, 'staff.invite')
      row = await store.checkpoint(row.id, step, 'running', null)
      const plan = {
        propertyId: row.propertyId,
        ...(row.sourcePortalId ? { sourcePortalId: row.sourcePortalId } : {}),
        ...(row.portalGroupId ? { portalGroupId: row.portalGroupId } : {}),
      }
      switch (step) {
        case 'person':
          await store.createPerson(row)
          break
        case 'portal':
          await deps.portals.create(
            { ...plan, portalId: row.portalId, displayName: row.displayName! },
            actor,
          )
          break
        case 'responsibility':
          await store.assignPortal(row, (transaction, displayName) =>
            deps.portals.rename(
              { portalIds: [row.portalId], displayName },
              actor,
              transaction,
            ),
          )
          break
        case 'code':
          await deps.portals.issueCode(row.portalId, actor)
          break
        case 'publication':
          await deps.portals.publish(row.portalId, actor)
          break
        case 'access': {
          const access = await store.grantAccess(row, () =>
            deps.spendInvitationBudget(actor),
          )
          const completed = await store.checkpoint(row.id, 'access', 'done', null)
          // Delivery follows the commit. Resend is the repair for a failed send.
          await deps
            .deliverAccess(row, access)
            .catch(() => deps.reportDeliveryFailure(row))
          return staffOnboardingResult(completed)
        }
      }
    }
  } catch (error) {
    return staffOnboardingResult(
      await store.checkpoint(row.id, row.step, 'failed', failureCodeOf(error)),
    )
  }
  throw new Error('Staff onboarding has no access step')
}

export const addStaffMember =
  (deps: StaffAccountDeps) => async (input: AddStaffInput, ctx: AuthContext) => {
    await requireStaffProperty(deps.store, ctx, input.propertyId, 'staff.invite')
    await deps.authorizeProperty(ctx, input.propertyId, 'staff.invite')
    const email = input.email.trim().toLowerCase()
    await deps.spendAddressCheckBudget(ctx, 1)
    return deps.store.withAddressLock(ctx.organizationId, email, async (store) => {
      const previous = await store.findOperation(ctx.organizationId, input.operationId)
      if (previous) {
        if (
          previous.propertyId !== input.propertyId ||
          (previous.email !== null && previous.email !== email)
        )
          throw staffAccountError(
            'operation_conflict',
            'Use a new operation for a different person',
          )
        if (previous.status === 'done' || previous.status === 'cancelled')
          return staffOnboardingResult(previous)
        return runSteps(deps, store, previous, ctx)
      }
      const facts = await store.addressFacts(ctx.organizationId, input.propertyId, email)
      const code = staffRowProblem(input, facts, ctx.organizationId)
      if (code)
        throw staffAccountError(
          code,
          rowMessages[code] ??
            'Check the staff name and email, or use Resend for someone already added',
        )
      if (
        (!facts.userId || !facts.organizationIds.includes(ctx.organizationId)) &&
        (await deps.invitationBudget(ctx)) === 0
      )
        throw staffAccountError(
          'rate_limited',
          'Please wait before sending more staff invitations',
        )
      await deps.portals.check(input, ctx)
      const row = await store.reserve({
        id: input.operationId,
        organizationId: ctx.organizationId,
        propertyId: input.propertyId,
        email,
        displayName: facts.staffDisplayName ?? input.displayName.trim(),
        sourcePortalId: input.sourcePortalId ?? null,
        portalGroupId: input.portalGroupId ?? null,
        requestedBy: ctx.userId,
        status: 'running',
        step: 'person',
        staffParticipantId: facts.staffParticipantId ?? deps.idGen(),
        staffParticipationId: deps.idGen(),
        portalId: deps.idGen(),
        invitationId: deps.idGen(),
        failureCode: null,
      })
      return runSteps(deps, store, row, ctx)
    })
  }
