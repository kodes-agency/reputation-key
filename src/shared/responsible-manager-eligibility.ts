import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'

/**
 * Shared selection policy for workflow-notification responsibility.
 *
 * Access and responsibility remain independent authorities: this policy
 * decides only who may be explicitly selected. An AccountAdmin is eligible
 * Organization-wide; a PropertyManager is eligible only at a Property their
 * current PropertyAccessGrants list. Staff participation plays no part. It
 * never grants access or creates an assignment.
 */
export type ResponsibleManagerMembership = Readonly<{
  userId: string
  role: 'AccountAdmin' | 'PropertyManager'
  propertyAccessScope: 'organization' | 'assigned-properties'
}>

export type ResponsibleManagerEligibilityDeps = Readonly<{
  listActiveManagers: (
    organizationId: string,
  ) => Promise<readonly ResponsibleManagerMembership[]>
  getAccessiblePropertyIds: (
    organizationId: OrganizationId,
    userId: UserId,
    organizationWide: boolean,
  ) => Promise<readonly PropertyId[] | null>
}>

export async function listEligibleResponsibleManagers(
  deps: ResponsibleManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
): Promise<readonly ResponsibleManagerMembership[]> {
  const memberships = await deps.listActiveManagers(organizationId)
  const eligible = await Promise.all(
    memberships.map(async (membership) => {
      if (membership.propertyAccessScope === 'organization') return membership
      const managerId = toUserId(membership.userId)
      const accessible = await deps.getAccessiblePropertyIds(
        organizationId,
        managerId,
        false,
      )
      return accessible?.includes(propertyId) ? membership : null
    }),
  )
  return eligible.filter(
    (membership): membership is ResponsibleManagerMembership => !!membership,
  )
}

export async function isEligibleResponsibleManager(
  deps: ResponsibleManagerEligibilityDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  userId: string,
): Promise<boolean> {
  const eligible = await listEligibleResponsibleManagers(deps, organizationId, propertyId)
  return eligible.some((membership) => membership.userId === userId)
}

/**
 * A member whose removal was recorded: `identity.member.removed`, the fact
 * every removal path commits with the membership delete.
 */
export type RemovedMember = Readonly<{
  organizationId: string
  userId: string
  /** Who removed them: never asked to fill the gap they opened. */
  removedBy: string | null
}>

/** Why an interval ended: the same reason the removal's own release records. */
const MANAGER_OFFBOARDED_END_REASON = 'manager_offboarded'

/** When, why and by whom a removed member's responsibilities are ended. */
export type RemovedMemberRelease = Readonly<{
  organizationId: string
  userId: string
  at: Date
  endReason: string
  actorId: string | null
}>

/**
 * Of the Properties a removed member still holds a responsibility at, those
 * where they are not an eligible manager now.
 */
async function listPropertyIdsNoLongerEligible(
  deps: ResponsibleManagerEligibilityDeps,
  member: RemovedMember,
  heldPropertyIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const distinct = [...new Set(heldPropertyIds)]
  const stillEligible = await Promise.all(
    distinct.map((heldPropertyId) =>
      isEligibleResponsibleManager(
        deps,
        toOrganizationId(member.organizationId),
        toPropertyId(heldPropertyId),
        member.userId,
      ),
    ),
  )
  return new Set(distinct.filter((_, index) => !stillEligible[index]))
}

/**
 * End the responsibilities a removed member still holds and may no longer hold.
 *
 * Removing a member releases their responsibilities first and deletes the
 * membership afterwards, in separate commits: the Google fences that share that
 * step cannot join the Identity transaction, and a membership left behind by a
 * crash is repairable while a deleted one with live authorities is not. Until
 * the membership is gone the member is still an eligible manager, so an
 * assignment another admin saves in between is accepted, and the release that
 * already ran cannot see it. This is the release each owner (Property, Portal)
 * makes again from the removal fact.
 *
 * Eligibility is asked now, per Property, and not assumed from the fact: a
 * member invited again before the fact was delivered is a current manager, and
 * what they hold where they may manage is theirs. Safe to repeat: a second run
 * finds nothing.
 */
export const releaseRemovedMemberResponsibilities =
  <Held extends Readonly<{ propertyId: string }>>(
    deps: Readonly<{
      eligibility: ResponsibleManagerEligibilityDeps
      /** What the member holds with this owner, across the Organization. */
      listHeld: (organizationId: string, userId: string) => Promise<readonly Held[]>
      /** End exactly these, recording and announcing each gap they leave. */
      releaseHeld: (
        release: RemovedMemberRelease,
        lost: readonly Held[],
      ) => Promise<Readonly<{ released: number }>>
      clock: () => Date
    }>,
  ) =>
  async (member: RemovedMember): Promise<Readonly<{ released: number }>> => {
    const held = await deps.listHeld(member.organizationId, member.userId)
    const lostAt = await listPropertyIdsNoLongerEligible(
      deps.eligibility,
      member,
      held.map((responsibility) => responsibility.propertyId),
    )
    return deps.releaseHeld(
      {
        organizationId: member.organizationId,
        userId: member.userId,
        at: deps.clock(),
        endReason: MANAGER_OFFBOARDED_END_REASON,
        actorId: member.removedBy,
      },
      held.filter((responsibility) => lostAt.has(responsibility.propertyId)),
    )
  }
