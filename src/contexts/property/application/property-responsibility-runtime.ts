// Property context — responsible-manager lifecycle runtime.
//
// ARC-03-T11: the composition root used to reach
// the Property responsible-manager repository to release and reconcile a
// departing member's Property responsibilities. That made the repository part
// of the root's vocabulary. This named capability is the ONLY Property surface
// the member-authority seam consumes; the repository stays context-private.

import type { PropertyResponsibleManagerRepository } from './ports/property-responsible-manager.repository'

export type PropertyResponsibilityRuntime = Readonly<{
  /** Active Property responsibilities held by one user across the organization. */
  listActiveForUser: PropertyResponsibleManagerRepository['listActiveForUser']
  /** End the user's intervals (all, or the named properties) and return the facts. */
  releaseForUser: PropertyResponsibleManagerRepository['releaseForUser']
}>

export function createPropertyResponsibilityRuntime(
  repo: PropertyResponsibleManagerRepository,
): PropertyResponsibilityRuntime {
  return Object.freeze({
    listActiveForUser: (organizationId, userId) =>
      repo.listActiveForUser(organizationId, userId),
    releaseForUser: (input) => repo.releaseForUser(input),
  })
}
