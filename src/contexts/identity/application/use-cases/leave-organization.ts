// LIF-01-T21 — voluntary departure, transfer first.
//
// Program bullet 3 asks for "user leave/removal with responsibility/assignment
// transfer and session revocation; sole AccountAdmin cannot leave". The two
// halves of that sentence pull in opposite directions and the order matters:
//
//   * TRANSFER FIRST. `removeMember` releases what the departing user held,
//     because an AccountAdmin performing a removal is present to reassign. A
//     voluntary leave has no such supervisor, so an unfenced leave would strand
//     Portals and Properties with no Responsible Manager and Inbox items with
//     no assignee. This command therefore REFUSES until every outstanding
//     responsibility has been explicitly handed to a named, currently eligible
//     manager — no auto-assignment, because picking a successor by algorithm is
//     an accountability decision a machine must not make.
//   * SOLE ACCOUNTADMIN CANNOT LEAVE. Checked here for a good message, and
//     re-checked under the Organization advisory lock inside the command store,
//     which is what actually closes the race between two admins leaving at once.
//
// Everything durable — session deletion, binding release, grant revocation,
// membership deletion and the removal fact — commits in the single command-store
// transaction. Google connector and import fencing CANNOT join that transaction
// (they belong to Integration), so they run BEFORE it: a fenced connector with
// a surviving membership is a repairable state, while a deleted membership with
// a live provider grant is not. `repairPartialOffboarding` converges the former.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { isOwnerToken } from '#/shared/domain/roles'
import { userId as toUserId, type OrganizationId } from '#/shared/domain/ids'
import { identityError } from '../../domain/errors'
import { identityMemberRemoved } from '../../domain/events'
import type { IdentityPort } from '../ports/identity.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type {
  MemberOffboardingPort,
  OutstandingResponsibility,
  ResponsibilityTransfer,
} from '../ports/member-offboarding.port'

export type LeaveOrganizationInput = Readonly<{
  /**
   * The explicit hand-offs. Every outstanding responsibility must appear
   * exactly once; an omitted one is a refusal, not an implicit release.
   */
  transfers: readonly ResponsibilityTransfer[]
}>

export type LeaveOrganizationOutput = Readonly<{
  success: true
  transferred: number
}>

export type LeaveOrganizationDeps = Readonly<{
  identity: IdentityPort
  commandStore: IdentityCommandStore
  offboarding: MemberOffboardingPort
  clock: () => Date
  /** Fail-closed import lifecycle fence, run before the Identity commit. */
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
}>

/**
 * Refusal names the machine kind and resource id of what is still held and
 * nothing else. A transfer UI can render it; it leaks no tenant content.
 */
export class OutstandingResponsibilitiesError extends Error {
  readonly outstanding: readonly OutstandingResponsibility[]

  constructor(outstanding: readonly OutstandingResponsibility[]) {
    super(
      'Transfer every responsibility before leaving: ' +
        outstanding.map((item) => `${item.kind}:${item.resourceId}`).join(','),
    )
    this.name = 'OutstandingResponsibilitiesError'
    this.outstanding = outstanding
  }
}

const key = (item: Readonly<{ kind: string; resourceId: string }>): string =>
  `${item.kind}:${item.resourceId}`

export type LeaveOrganization = ReturnType<typeof leaveOrganization>

export const leaveOrganization =
  (deps: LeaveOrganizationDeps) =>
  async (
    input: LeaveOrganizationInput,
    ctx: AuthContext,
  ): Promise<LeaveOrganizationOutput> => {
    // 1. Authorize — leaving is its own permission, not member.delete.
    if (!canForContext(ctx, 'identity.leave_org')) {
      throw identityError('forbidden', 'This role cannot leave the Organization')
    }

    const members = await deps.identity.listMembers(ctx)
    const self = members.find((member) => member.userId === (ctx.userId as string))
    if (!self) {
      throw identityError('member_not_found', 'Member not found in this organization')
    }

    // 2. The sole AccountAdmin cannot leave. Leaving would produce an
    //    Organization nobody can administer — including nobody who could
    //    close it — so this is refused rather than warned about.
    if (isOwnerToken(self.rawRole)) {
      const owners = members.filter((member) => isOwnerToken(member.rawRole))
      if (owners.length <= 1) {
        throw identityError(
          'last_owner',
          'Appoint another AccountAdmin before leaving the Organization',
        )
      }
    }

    // 3. Transfer first. Each transfer must name a currently eligible
    //    recipient, checked per resource: eligibility for a Property is not
    //    eligibility for a Portal.
    const organizationId = ctx.organizationId as string
    const outstanding = await deps.offboarding.listOutstanding(
      organizationId,
      self.userId,
    )
    const outstandingKeys = new Set(outstanding.map(key))
    const supplied = new Map(input.transfers.map((transfer) => [key(transfer), transfer]))
    if (supplied.size !== input.transfers.length) {
      throw identityError(
        'validation_error',
        'Each responsibility may be transferred exactly once',
      )
    }
    for (const transfer of input.transfers) {
      if (!outstandingKeys.has(key(transfer))) {
        throw identityError(
          'validation_error',
          'A transfer names a responsibility this member does not hold',
        )
      }
      if (transfer.toUserId === self.userId) {
        throw identityError(
          'validation_error',
          'A responsibility cannot be transferred to the departing member',
        )
      }
      if (
        !(await deps.offboarding.isEligibleRecipient({
          organizationId,
          userId: transfer.toUserId,
          kind: transfer.kind,
          resourceId: transfer.resourceId,
        }))
      ) {
        throw identityError(
          'forbidden',
          'A transfer recipient is not an eligible current manager',
        )
      }
    }
    const missing = outstanding.filter((item) => !supplied.has(key(item)))
    if (missing.length > 0) throw new OutstandingResponsibilitiesError(missing)

    for (const transfer of input.transfers) {
      await deps.offboarding.transfer({
        organizationId,
        fromUserId: self.userId,
        actorUserId: self.userId,
        transfer,
      })
    }

    // 4. Re-read. A responsibility created while the transfers were being
    //    applied must block the leave rather than be silently abandoned.
    const remaining = await deps.offboarding.listOutstanding(organizationId, self.userId)
    if (remaining.length > 0) throw new OutstandingResponsibilitiesError(remaining)

    // 5. Pre-fence the provider authorities that cannot join the transaction.
    await deps.prepareGoogleConnectorDeparture?.(
      ctx.organizationId,
      self.userId,
      'member_removed',
    )
    await deps.cancelGoogleImportsForUser?.(ctx.organizationId, self.userId)

    // 6. Sessions, binding release, grant revocation, membership deletion and
    //    the durable fact — one transaction, re-checking last-owner under the
    //    Organization advisory lock.
    await deps.commandStore.removeMember({
      organizationId: ctx.organizationId,
      memberId: self.id,
      event: identityMemberRemoved({
        organizationId: ctx.organizationId,
        userId: toUserId(self.userId),
        removedBy: ctx.userId,
        occurredAt: deps.clock(),
      }),
    })

    return { success: true, transferred: input.transfers.length }
  }
