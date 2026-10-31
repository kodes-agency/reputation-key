import { sql } from 'drizzle-orm'
import { purgeProductUpdates } from './product-updates-purge'
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
    purge: async (tx, request: OrganizationLifecycleContributionRequest) => {
      const result = await deps.purge(tx, request)
      const aiNoticeReceipts =
        await tx.execute(sql`DELETE FROM merchant_ai_notice_update_receipts
        WHERE organization_id = ${request.organizationId} RETURNING user_id`)
      const productUpdates = await purgeProductUpdates(tx, request.organizationId)
      if (aiNoticeReceipts.rows.length === 0 && productUpdates === 0) return result
      return {
        outcome: 'complete' as const,
        evidenceRef:
          productUpdates === 0
            ? result.evidenceRef
            : `${result.evidenceRef}:product-updates-${productUpdates}`,
      }
    },
  })
