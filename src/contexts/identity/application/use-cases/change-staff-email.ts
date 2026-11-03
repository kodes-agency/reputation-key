import type { AuthContext } from '#/shared/domain/auth-context'
import type { ManageStaffDeps } from './manage-staff-accounts'
import {
  requireStaffProperty,
  staffRowProblem,
  staffRowCodeForActor,
  staffAddressRefusal,
} from './add-staff-member'
import { staffAccountError } from '../../domain/staff-account'

/** A correction replaces a pending invitation; it never edits a login or a code. */
export const changeStaffInvitationEmail =
  (deps: ManageStaffDeps) =>
  async (
    input: Readonly<{ participationId: string; email: string }>,
    ctx: AuthContext,
  ) => {
    const found = await deps.management.target(ctx.organizationId, input.participationId)
    if (!found)
      throw staffAccountError('participation_not_found', 'Staff member not found.')
    await requireStaffProperty(deps.store, ctx, found.propertyId, 'staff.invite')
    await deps.authorizeProperty(ctx, found.propertyId, 'staff.invite')
    if (!found.active || !found.email || found.hasLink)
      throw staffAccountError(
        'operation_conflict',
        'Only an invitation that has not been accepted can change email.',
      )
    const email = input.email.trim().toLowerCase()
    if (email === found.email.toLowerCase())
      throw staffAccountError('operation_conflict', 'Enter a different email address.')
    await deps.spendAddressCheckBudget(ctx, 1)
    // Removal and Add take the same address lock. Stable order also serializes two corrections.
    const addresses = [email, found.email.toLowerCase()].sort()
    return deps.store.withAddressLocks(ctx.organizationId, addresses, async (store) => {
      const actor = await store.currentActor(ctx)
      if (!actor)
        throw staffAccountError(
          'forbidden',
          'Your staff access has changed. Refresh Staff before trying again.',
        )
      await requireStaffProperty(store, actor, found.propertyId, 'staff.invite')
      await deps.authorizeProperty(actor, found.propertyId, 'staff.invite')
      const current = await deps.management.target(
        ctx.organizationId,
        input.participationId,
      )
      if (
        !current?.active ||
        current.hasLink ||
        current.email?.toLowerCase() !== found.email!.toLowerCase()
      )
        throw staffAccountError(
          'operation_conflict',
          'This invitation has changed. Refresh Staff before trying again.',
        )
      const facts = await store.addressFacts(ctx.organizationId, found.propertyId, email)
      const code = staffRowCodeForActor(
        staffRowProblem({ email, displayName: 'Staff' }, facts, ctx.organizationId),
        actor,
        deps.reportAddressRefusal,
      )
      if (code === 'cannot_add' || code === 'other_organization')
        throw staffAddressRefusal(actor, deps.reportAddressRefusal)
      if (code)
        throw staffAccountError(
          code,
          code === 'invalid_email'
            ? 'Enter a valid email address.'
            : 'This email is already staff or has an invitation. Use another address.',
        )
      if (facts.userId && facts.organizationIds.includes(ctx.organizationId))
        throw staffAccountError(
          'cannot_add',
          'This email already has an account here. Use another email address.',
        )
      const row = await deps.management.replaceInvitation(
        {
          organizationId: ctx.organizationId,
          participationId: input.participationId,
          oldEmail: found.email!,
          email,
          invitationId: deps.idGen(),
          actorId: ctx.userId,
        },
        () => deps.spendInvitationBudget(actor),
      )
      try {
        await deps.deliverAccess(row, { invited: true, userId: null })
        await store.markDeliveryProblem(ctx.organizationId, input.participationId, false)
      } catch {
        await store.markDeliveryProblem(ctx.organizationId, input.participationId, true)
        deps.reportDeliveryFailure(row)
        throw staffAccountError(
          'operation_conflict',
          "The email was changed, but the invitation email couldn't be sent. Use Resend.",
        )
      }
      return { changed: true as const }
    })
  }
