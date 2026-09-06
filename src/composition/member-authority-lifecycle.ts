// Composition — the Identity/Property, Identity/Portal and Identity/Inbox
// member-authority seam.
//
// ARC-03-T9. This adapter is the ONE place that knows a departing member holds
// four independent authorities. It consumes named context capabilities
// (Property/Portal responsibility runtimes, the Inbox assignment runtime,
// Identity's grant revocation) — never a repository — and satisfies the
// Identity-owned MemberAuthorityLifecyclePort.
//
// WHY a deferred binding still exists: Identity is constructed before the three
// downstream contexts, so the adapter cannot be built at the moment Identity
// needs the port. The difference from the previous `let x = throwing` pattern
// is that the deferral is now a named, single-assignment seam whose unresolved
// state is a documented error rather than a mutable module-order accident.

import type { MemberAuthorityLifecyclePort } from '#/contexts/identity/application/ports/member-authority-lifecycle.port'
import type { PropertyResponsibilityRuntime } from '#/contexts/property/application/property-responsibility-runtime'
import type { PortalResponsibilityRuntime } from '#/contexts/portal/application/portal-responsibility-runtime'
import type { InboxAssignmentRuntime } from '#/contexts/inbox/application/inbox-assignment-runtime'
import type { Clock } from '#/shared/domain/clock'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  type ResponsibleManagerEligibilityDeps,
} from '#/shared/responsible-manager-eligibility'

/** Identity's own authority over a member's property access grants. */
export type MemberPropertyAccessRevocation = Readonly<{
  revokeAllPropertyAccessForUser: (
    organizationId: string,
    userId: string,
  ) => Promise<unknown>
}>

export type MemberAuthorityLifecycleDeps = Readonly<{
  clock: Clock
  propertyResponsibility: PropertyResponsibilityRuntime
  portalResponsibility: PortalResponsibilityRuntime
  inboxAssignments: InboxAssignmentRuntime
  propertyAccess: MemberPropertyAccessRevocation
  eligibility: ResponsibleManagerEligibilityDeps
}>

export function createMemberAuthorityLifecycle(
  deps: MemberAuthorityLifecycleDeps,
): MemberAuthorityLifecyclePort {
  const releaseMemberAuthorities = async (
    orgId: string,
    memberId: string,
    actorId: string | null,
  ): Promise<void> => {
    const at = deps.clock()
    // Each release records its own responsibility_became_needed facts in the
    // outbox inside its transaction; nothing is announced here.
    await Promise.all([
      deps.propertyResponsibility.releaseForUser({
        organizationId: orgId,
        userId: memberId,
        at,
        endReason: 'manager_offboarded',
      }),
      deps.portalResponsibility.releaseForUser({
        organizationId: orgId,
        userId: memberId,
        at,
        endReason: 'manager_offboarded',
      }),
      deps.inboxAssignments.releaseAssignmentsForUser({
        organizationId: organizationId(orgId),
        userId: userId(memberId),
        actorId: actorId ? userId(actorId) : null,
        at,
      }),
    ])
    await deps.propertyAccess.revokeAllPropertyAccessForUser(orgId, memberId)
  }

  const reconcileResponsibleManagerEligibility = async (
    orgId: string,
    memberId: string,
    actorId: string,
  ): Promise<void> => {
    const [propertyAssignments, portalAssignments] = await Promise.all([
      deps.propertyResponsibility.listActiveForUser(orgId, memberId),
      deps.portalResponsibility.listActiveForUser(orgId, memberId),
    ])
    const assignedPropertyIds = [
      ...new Set([
        ...propertyAssignments.map((assignment) => assignment.propertyId),
        ...portalAssignments.map((assignment) => assignment.propertyId),
      ]),
    ]
    const eligibility = new Map(
      await Promise.all(
        assignedPropertyIds.map(
          async (assignedPropertyId) =>
            [
              assignedPropertyId,
              await isEligibleResponsibleManager(
                deps.eligibility,
                organizationId(orgId),
                propertyId(assignedPropertyId),
                memberId,
              ),
            ] as const,
        ),
      ),
    )
    const isIneligible = (assignmentPropertyId: string): boolean =>
      eligibility.get(assignmentPropertyId) === false
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
        endReason: 'manager_became_ineligible',
      }),
      deps.portalResponsibility.releaseForUser({
        organizationId: orgId,
        userId: memberId,
        portalIds: portalIdsToRelease,
        at,
        endReason: 'manager_became_ineligible',
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
    releaseMemberAuthorities,
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
  port: MemberAuthorityLifecyclePort
  provide: (implementation: MemberAuthorityLifecyclePort) => void
}>

export function createDeferredMemberAuthorityLifecycle(): DeferredMemberAuthorityLifecycle {
  const bound: { implementation?: MemberAuthorityLifecyclePort } = {}
  const resolve = (): MemberAuthorityLifecyclePort => {
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
      releaseMemberAuthorities: async (
        orgId: string,
        memberId: string,
        actorId: string | null,
      ) => resolve().releaseMemberAuthorities(orgId, memberId, actorId),
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
