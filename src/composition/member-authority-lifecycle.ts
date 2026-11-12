// Composition — the Identity/Property, Identity/Portal and Identity/Inbox
// member-authority seam.
//
// ARC-03-T9. This adapter is the ONE place that knows a member's role change
// can end three independent responsibilities. It consumes named context
// capabilities (Property/Portal responsibility runtimes, the Inbox assignment
// runtime) — never a repository — and provides the callback Identity runs
// once a role change commits. A removal's releases run from its fact.
//
// WHY a deferred binding still exists: Identity is constructed before the three
// downstream contexts, so the adapter cannot be built at the moment Identity
// needs the callbacks. The difference from the previous `let x = throwing` pattern
// is that the deferral is now a named, single-assignment seam whose unresolved
// state is a documented error rather than a mutable module-order accident.

import type { PropertyResponsibilityRuntime } from '#/contexts/property/application/property-responsibility-runtime'
import type { PortalResponsibilityRuntime } from '#/contexts/portal/application/portal-responsibility-runtime'
import type { InboxAssignmentRuntime } from '#/contexts/inbox/application/inbox-assignment-runtime'
import type { Clock } from '#/shared/domain/clock'
import { organizationId, userId } from '#/shared/domain/ids'
import {
  listPropertyIdsNoLongerEligible,
  MANAGER_BECAME_INELIGIBLE_END_REASON,
  type ResponsibleManagerEligibilityDeps,
} from '#/shared/responsible-manager-eligibility'

type MemberAuthorityLifecycle = Readonly<{
  reconcileResponsibleManagerEligibility: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

export type MemberAuthorityLifecycleDeps = Readonly<{
  clock: Clock
  propertyResponsibility: PropertyResponsibilityRuntime
  portalResponsibility: PortalResponsibilityRuntime
  inboxAssignments: InboxAssignmentRuntime
  eligibility: ResponsibleManagerEligibilityDeps
}>

export function createMemberAuthorityLifecycle(
  deps: MemberAuthorityLifecycleDeps,
): MemberAuthorityLifecycle {
  const reconcileResponsibleManagerEligibility = async (
    orgId: string,
    memberId: string,
    actorId: string,
  ): Promise<void> => {
    const [propertyAssignments, portalAssignments] = await Promise.all([
      deps.propertyResponsibility.listActiveForUser(orgId, memberId),
      deps.portalResponsibility.listActiveForUser(orgId, memberId),
    ])
    const lostAt = await listPropertyIdsNoLongerEligible(
      deps.eligibility,
      organizationId(orgId),
      memberId,
      [...propertyAssignments, ...portalAssignments].map(
        (assignment) => assignment.propertyId,
      ),
    )
    const isIneligible = (assignmentPropertyId: string): boolean =>
      lostAt.has(assignmentPropertyId)
    const propertyIdsToRelease = propertyAssignments
      .filter((assignment) => isIneligible(assignment.propertyId))
      .map((assignment) => assignment.propertyId)
    const portalIdsToRelease = portalAssignments
      .filter((assignment) => isIneligible(assignment.propertyId))
      .map((assignment) => assignment.portalId)
    const at = deps.clock()
    await Promise.all([
      deps.propertyResponsibility.releaseForUser({
        organizationId: orgId,
        userId: memberId,
        propertyIds: propertyIdsToRelease,
        at,
        endReason: MANAGER_BECAME_INELIGIBLE_END_REASON,
        actorId,
      }),
      deps.portalResponsibility.releaseForUser({
        organizationId: orgId,
        userId: memberId,
        portalIds: portalIdsToRelease,
        at,
        endReason: MANAGER_BECAME_INELIGIBLE_END_REASON,
        actorId,
      }),
      // Assignment is operational metadata, never an authority. Inbox
      // re-proves each review/feedback requirement in its own transaction and
      // durably clears only the properties that are no longer eligible.
      deps.inboxAssignments.releaseIneligibleAssignmentsForUser({
        organizationId: organizationId(orgId),
        userId: userId(memberId),
        actorId: userId(actorId),
        at,
      }),
    ])
  }

  return Object.freeze({
    reconcileResponsibleManagerEligibility,
  })
}

/**
 * One-shot deferred binding for a build-order seam.
 *
 * `port` is safe to hand to an upstream context immediately; calling it before
 * `provide` names the seam in the error instead of failing somewhere inside a
 * repository. `provide` refuses a second implementation so a container can
 * never end up with two competing member-authority lifecycles.
 */
export type DeferredMemberAuthorityLifecycle = Readonly<{
  port: MemberAuthorityLifecycle
  provide: (implementation: MemberAuthorityLifecycle) => void
}>

export function createDeferredMemberAuthorityLifecycle(): DeferredMemberAuthorityLifecycle {
  const bound: { implementation?: MemberAuthorityLifecycle } = {}
  const resolve = (): MemberAuthorityLifecycle => {
    if (!bound.implementation) {
      throw new Error(
        '[COMPOSITION] member authority lifecycle seam is not bound yet — the container is still composing',
      )
    }
    return bound.implementation
  }
  return Object.freeze({
    port: Object.freeze({
      // Async so an unbound seam REJECTS rather than throwing synchronously —
      // identical to the throwing placeholders this replaced, so every caller's
      // error handling keeps working.
      reconcileResponsibleManagerEligibility: async (
        orgId: string,
        memberId: string,
        actorId: string,
      ) => resolve().reconcileResponsibleManagerEligibility(orgId, memberId, actorId),
    }),
    provide: (implementation) => {
      if (bound.implementation) {
        throw new Error(
          '[COMPOSITION] member authority lifecycle seam is already bound in this container',
        )
      }
      bound.implementation = implementation
    },
  })
}
