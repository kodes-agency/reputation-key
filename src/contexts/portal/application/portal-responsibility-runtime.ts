// Portal context — responsible-manager lifecycle runtime.
//
// ARC-03-T11: replaces the composition root's reach-through into the Portal
// responsible-manager repository. The member-authority seam consumes this named capability;
// the repository itself never leaves the Portal build.

import type { PortalResponsibleManagerRepository } from './ports/portal-responsible-manager.repository'

export type PortalResponsibilityRuntime = Readonly<{
  /** Active Portal responsibilities held by one user across the organization. */
  listActiveForUser: PortalResponsibleManagerRepository['listActiveForUser']
  /** End the user's intervals (all, or the named portals) and return the facts. */
  releaseForUser: PortalResponsibleManagerRepository['releaseForUser']
}>

export function createPortalResponsibilityRuntime(
  repo: PortalResponsibleManagerRepository,
): PortalResponsibilityRuntime {
  return Object.freeze({
    listActiveForUser: (organizationId, userId) =>
      repo.listActiveForUser(organizationId, userId),
    releaseForUser: (input) => repo.releaseForUser(input),
  })
}
