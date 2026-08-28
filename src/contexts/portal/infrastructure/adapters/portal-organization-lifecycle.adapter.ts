// LIF-01 bullets 4 and 5 — the Portal context's Organization lifecycle
// contribution (LIF-01-T12/T13/T14).
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header). Authority
// binding, the advisory lock, the request fingerprint and the append-only
// receipt all live in the shared store; the three phase bodies below are the
// only Portal-specific decisions.
//
// Reading order: the closing fence (why an activation, not the Portal row),
// then PORTAL_PURGE_PLAN, then the phases.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import {
  portalAccessArtifacts,
  portalApprovedDestinations,
  portalGroupMembers,
  portalHealthIntervals,
  portalLinkCategories,
  portalLinks,
  portalLocalizedOverrides,
  portalPendingContentChanges,
  portalPublicationActivations,
  portalPublicationSnapshots,
  portalResponsibleManagers,
  portalTokens,
  portalUploadIssuances,
  portals,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import type { Tx } from '#/shared/outbox/commit'

/**
 * The only `deactivation_reason` the append-only activation guard accepts for
 * a Portal that is being taken off the air without being archived or replaced.
 */
const CLOSING_DEACTIVATION_REASON = 'disabled'

/**
 * The explicit, static Portal purge plan, innermost dependency first.
 *
 * Deliberately NOT here:
 * - `portal_group_memberships`, `portal_responsibilities`, `team_*`: people
 *   and Staff rows whose data-fate owner is Staff, not Portal.
 * - `portal_metric_lifetime_aggregates`: the anonymous lifetime aggregate is
 *   Metric's row and Metric's receipt. Portal never edits or counts it.
 * - `properties`: Property's row; Portal only references it.
 *
 * `portal_group_members` IS in the plan, as a ROW delete. It is a
 * physical-drop-blocked compatibility mirror: the rows are tenant content and
 * must go, the table must not. Nothing in this plan is ever a DROP or a
 * TRUNCATE — physical contraction is a separate expand/backfill/contract
 * decision, never a lifecycle phase.
 */
export const PORTAL_PURGE_PLAN = Object.freeze([
  'portal_access_artifacts',
  'portal_upload_issuances',
  'portal_pending_content_changes',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_links',
  'portal_link_categories',
  'portal_approved_destinations',
  'portal_responsible_managers',
  'portal_tokens',
  'portal_group_members',
  'portal_localized_overrides',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portals',
  'portal_groups',
] as const)

export type PortalLifecycleWorkbench = Readonly<{
  /** Closing: take every live publication off the air. Returns rows fenced. */
  withdrawPublicAvailability(
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<number>
  /** Readiness: publications still resolvable to the public. READ ONLY. */
  countLivePublications(tx: Tx, organizationId: string): Promise<number>
  /** Presence: does this Organization own any Portal-context row at all? */
  countTenantRows(tx: Tx, organizationId: string): Promise<number>
  /** Purge: irreversible, content-free scrub of the plan above. */
  scrubTenantRows(tx: Tx, organizationId: string): Promise<void>
}>

function count(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0)
}

export const drizzlePortalLifecycleWorkbench: PortalLifecycleWorkbench = Object.freeze({
  withdrawPublicAvailability: async (tx, request) => {
    // Public resolution requires BOTH a published Portal row AND an activation
    // with `deactivated_at IS NULL`. Deactivating the activation is therefore a
    // complete stop, and it is the reversible half: the immutable snapshot
    // survives untouched and `portals.publication_state` keeps the tenant's own
    // published/draft intent, so reactivation re-points a new activation at the
    // same snapshot instead of guessing what each Portal used to be.
    //
    // GREATEST keeps the `deactivated_at >= activated_at` check satisfied
    // without reading a clock: the supplied `occurredAt` is the only time
    // source, and an activation stamped after it still closes at its own start.
    const fenced = await tx.execute(sql`
      UPDATE ${portalPublicationActivations}
      SET deactivated_at = GREATEST(activated_at, ${request.occurredAt}),
          deactivation_reason = ${CLOSING_DEACTIVATION_REASON}
      WHERE organization_id = ${request.organizationId}
        AND deactivated_at IS NULL
      RETURNING 1 AS "fenced"
    `)
    return fenced.rows.length
  },

  countLivePublications: async (tx, organizationId) => {
    const live = await tx
      .select({ id: portalPublicationActivations.id })
      .from(portalPublicationActivations)
      .where(
        and(
          eq(portalPublicationActivations.organizationId, organizationId),
          isNull(portalPublicationActivations.deactivatedAt),
        ),
      )
    return live.length
  },

  countTenantRows: async (tx, organizationId) => {
    // The four roots of the plan. Every other Portal table is a foreign-key
    // child of one of them, so a non-zero count here is exactly "this
    // Organization owns Portal-context rows".
    const result = await tx.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int FROM ${portals}
          WHERE ${portals.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${portalGroups}
          WHERE ${portalGroups.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${propertyPortalBrandProfiles}
          WHERE ${propertyPortalBrandProfiles.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${portalApprovedDestinations}
          WHERE ${portalApprovedDestinations.organizationId} = ${organizationId}
        ) AS "rows"
    `)
    return count(result.rows[0], 'rows')
  },

  scrubTenantRows: async (tx, organizationId) => {
    // Order is the FK order. Guest rows RESTRICT `portals` and the publication
    // snapshots until Guest has purged; that failure is honest — the phase
    // throws, the state stays `purging`, other contexts keep their receipts,
    // and the next pass converges once Guest's own receipt exists.
    await tx
      .delete(portalAccessArtifacts)
      .where(eq(portalAccessArtifacts.organizationId, organizationId))
    await tx
      .delete(portalUploadIssuances)
      .where(eq(portalUploadIssuances.organizationId, organizationId))
    await tx
      .delete(portalPendingContentChanges)
      .where(eq(portalPendingContentChanges.organizationId, organizationId))
    await tx
      .delete(portalPublicationActivations)
      .where(eq(portalPublicationActivations.organizationId, organizationId))
    await tx
      .delete(portalPublicationSnapshots)
      .where(eq(portalPublicationSnapshots.organizationId, organizationId))
    await tx
      .delete(portalHealthIntervals)
      .where(eq(portalHealthIntervals.organizationId, organizationId))
    await tx.delete(portalLinks).where(eq(portalLinks.organizationId, organizationId))
    await tx
      .delete(portalLinkCategories)
      .where(eq(portalLinkCategories.organizationId, organizationId))
    await tx
      .delete(portalApprovedDestinations)
      .where(eq(portalApprovedDestinations.organizationId, organizationId))
    await tx
      .delete(portalResponsibleManagers)
      .where(eq(portalResponsibleManagers.organizationId, organizationId))
    await tx.delete(portalTokens).where(eq(portalTokens.organizationId, organizationId))
    // Compatibility mirror: rows are deleted, the table is never dropped.
    await tx
      .delete(portalGroupMembers)
      .where(eq(portalGroupMembers.organizationId, organizationId))
    await tx
      .delete(portalLocalizedOverrides)
      .where(eq(portalLocalizedOverrides.organizationId, organizationId))
    await tx
      .delete(propertyPortalBrandContents)
      .where(eq(propertyPortalBrandContents.organizationId, organizationId))
    await tx
      .delete(propertyPortalBrandProfiles)
      .where(eq(propertyPortalBrandProfiles.organizationId, organizationId))
    await tx.delete(portals).where(eq(portals.organizationId, organizationId))
    await tx.delete(portalGroups).where(eq(portalGroups.organizationId, organizationId))
  },
})

function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  request: OrganizationLifecycleContributionRequest,
): string {
  // Identifiers, enums and a revision only. No Portal name, slug, link URL,
  // token material or count reaches the receipt.
  return validateContentFreeEvidenceRef(
    `portal:${phase}:${outcome}:${request.closureLineageId}:r${request.lifecycleRevision}`,
  )
}

export const PORTAL_PURGE_READINESS_BLOCKED =
  'portal purge readiness blocked: Portal publications are still resolvable'

export const createPortalOrganizationLifecycleContributor = (
  db: Database,
  workbench: PortalLifecycleWorkbench = drizzlePortalLifecycleWorkbench,
) => {
  /**
   * Closing — STOP EFFECTS, KEEP DATA.
   *
   * Portals become unavailable; that is a stop, not a delete. No Portal, link,
   * token, access artifact, snapshot or brand row is removed or edited, so a
   * cancelled closure has an intact Portal to bring back.
   *
   * Portal upload issuance is deliberately untouched. It is a dark capability
   * with no public issuance surface, so there is no live effect to cancel, and
   * writing to its rows here would be lifecycle code reaching into a capability
   * that has not been activated.
   */
  const prepareClosing = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    // Idempotent by construction: a second run matches zero live activations.
    await workbench.withdrawPublicAvailability(tx, request)
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('closing', outcome, request) }
  }

  /**
   * Purge readiness — READ ONLY.
   *
   * The only way this contract can say "blocked" is to fail, which leaves the
   * Organization in `closing` for the next pass. Reporting ready while a
   * printed Portal address still resolves would put the irreversible boundary
   * in front of a live public surface.
   */
  const verifyPurgeReadiness = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const live = await workbench.countLivePublications(tx, request.organizationId)
    if (live > 0) throw new Error(PORTAL_PURGE_READINESS_BLOCKED)
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('purge_readiness', outcome, request) }
  }

  /**
   * Purge — IRREVERSIBLE, reached only after readiness passed.
   *
   * Idempotent: presence is read first, so a replay over an already-scrubbed
   * Organization deletes nothing and still answers.
   */
  const purge = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    if (owned === 0) {
      return { outcome: 'no_data', evidenceRef: evidenceRef('purge', 'no_data', request) }
    }
    await workbench.scrubTenantRows(tx, request.organizationId)
    return { outcome: 'complete', evidenceRef: evidenceRef('purge', 'complete', request) }
  }

  return createOrganizationLifecycleContributorScaffold({
    db,
    context: 'portal',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
}
