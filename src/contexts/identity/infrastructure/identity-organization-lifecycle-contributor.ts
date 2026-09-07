import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import type {
  OrganizationLifecycleContributionInput,
  OrganizationLifecycleContributor,
} from '../application/ports/organization-lifecycle-contributor.port'

export type IdentityOrganizationLifecyclePhaseWork = (
  tx: Tx,
  input: OrganizationLifecycleContributionInput,
) => Promise<OrganizationLifecyclePhaseOutcome>

export type IdentityOrganizationLifecycleContributorDeps = Readonly<{
  db: Database
  prepareClosing: IdentityOrganizationLifecyclePhaseWork
  verifyPurgeReadiness: IdentityOrganizationLifecyclePhaseWork
  purge: IdentityOrganizationLifecyclePhaseWork
}>

/**
 * Identity uses the same transaction-bound event store as every other owning
 * context. The shared scaffold serializes first attempts, rechecks the live
 * authority, and commits the mutation with one append-only event.
 */
export const createIdentityOrganizationLifecycleContributor = (
  deps: IdentityOrganizationLifecycleContributorDeps,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db: deps.db,
    context: 'identity',
    prepareClosing: (tx, request: OrganizationLifecycleContributionRequest) =>
      deps.prepareClosing(tx, request),
    verifyPurgeReadiness: (tx, request: OrganizationLifecycleContributionRequest) =>
      deps.verifyPurgeReadiness(tx, request),
    purge: (tx, request: OrganizationLifecycleContributionRequest) =>
      deps.purge(tx, request),
  })
