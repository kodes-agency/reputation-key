import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyIdInScope } from '#/shared/db/property-scope'
import {
  merchantAiDecisionDeferrals,
  merchantAiEnablement,
  portalPublicationActivations,
  portals,
  properties,
  propertyReplyProfiles,
  propertyResponsibleManagers,
  reviewProviderSnapshotRuns,
} from '#/shared/db/schema'
import { propertyId, type OrganizationId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  PropertySetupFacts,
  PropertySetupRepository,
} from '../../application/ports/property-setup.repository'
import type { PropertySetupMerchantAiState } from '../../domain/property-setup'

type FactRow = Readonly<{
  property_id: unknown
  google_binding_active: unknown
  reviews_synced: unknown
  reply_language_chosen: unknown
  merchant_ai_state: unknown
  ai_decision_deferred: unknown
  responsible_manager_assigned: unknown
  reply_voice_configured: unknown
  portal_published: unknown
}>

const MERCHANT_AI_STATES: ReadonlySet<string> = new Set([
  'disabled',
  'enabled',
  'revoked',
])

function readFlag(row: FactRow, column: keyof FactRow): boolean {
  const value = row[column]
  if (typeof value !== 'boolean') {
    throw new Error(`Property setup fact ${column} is unavailable`)
  }
  return value
}

function readMerchantAiState(row: FactRow): PropertySetupMerchantAiState {
  const value = row.merchant_ai_state
  // No authorization head means AI was never authorized for the Property.
  if (value === null) return 'disabled'
  if (typeof value !== 'string' || !MERCHANT_AI_STATES.has(value)) {
    throw new Error('Property setup Merchant AI state is invalid')
  }
  return value as PropertySetupMerchantAiState
}

function toFacts(row: FactRow): PropertySetupFacts {
  if (typeof row.property_id !== 'string') {
    throw new Error('Property setup Property identifier is unavailable')
  }
  return Object.freeze({
    propertyId: propertyId(row.property_id),
    googleBindingActive: readFlag(row, 'google_binding_active'),
    reviewsSyncedForCurrentSource: readFlag(row, 'reviews_synced'),
    replyLanguageChosen: readFlag(row, 'reply_language_chosen'),
    merchantAiState: readMerchantAiState(row),
    aiDecisionDeferred: readFlag(row, 'ai_decision_deferred'),
    responsibleManagerAssigned: readFlag(row, 'responsible_manager_assigned'),
    replyVoiceConfigured: readFlag(row, 'reply_voice_configured'),
    portalPublished: readFlag(row, 'portal_published'),
  })
}

/**
 * One statement, so every fact comes from a single snapshot. Each source is
 * bound to the Organization as well as to the scoped Property rows.
 *
 * - Reviews are synced when a completed provider snapshot run exists for the
 *   Property's current source epoch — the evidence the Organization checklist
 *   reads for its initial review sync. Terminal runs are retained for 30 days
 *   and sync recurs within hours, so a healthy Property keeps it. No index
 *   serves completed runs by Property, so the runs are read once for the whole
 *   scope in a CTE instead of once per Property in a correlated subquery.
 * - A Portal counts as published when the tenant published it and its current
 *   publication activation is still open; Portal health is not a setup step.
 * - The remaining per-Property lookups are index-backed correlated subqueries.
 */
function propertyFactsSql(organizationId: OrganizationId, scope: SQL): SQL {
  return sql`
    WITH scoped_properties AS MATERIALIZED (
      SELECT p.id, p.source_epoch, p.google_binding_state, p.default_reply_language
      FROM ${properties} p
      WHERE p.organization_id = ${organizationId}
        AND p.deleted_at IS NULL
        AND ${scope}
    ), synced_properties AS (
      SELECT DISTINCT run.property_id
      FROM ${reviewProviderSnapshotRuns} run
      JOIN scoped_properties p
        ON p.id = run.property_id
        AND p.source_epoch = run.source_epoch
      WHERE run.organization_id = ${organizationId}
        AND run.state = 'completed'
    )
    SELECT
      p.id::text AS property_id,
      (p.google_binding_state = 'active') AS google_binding_active,
      (synced.property_id IS NOT NULL) AS reviews_synced,
      (p.default_reply_language IS NOT NULL) AS reply_language_chosen,
      enablement.state AS merchant_ai_state,
      EXISTS (
        SELECT 1
        FROM ${merchantAiDecisionDeferrals} deferral
        WHERE deferral.organization_id = ${organizationId}
          AND deferral.property_id = p.id
      ) AS ai_decision_deferred,
      EXISTS (
        SELECT 1
        FROM ${propertyResponsibleManagers} manager
        WHERE manager.organization_id = ${organizationId}
          AND manager.property_id = p.id
          AND manager.effective_to IS NULL
      ) AS responsible_manager_assigned,
      EXISTS (
        SELECT 1
        FROM ${propertyReplyProfiles} profile
        WHERE profile.organization_id = ${organizationId}
          AND profile.property_id = p.id
      ) AS reply_voice_configured,
      EXISTS (
        SELECT 1
        FROM ${portals} portal
        JOIN ${portalPublicationActivations} activation
          ON activation.organization_id = portal.organization_id
          AND activation.property_id = portal.property_id
          AND activation.portal_id = portal.id
          AND activation.deactivated_at IS NULL
        WHERE portal.organization_id = ${organizationId}
          AND portal.property_id = p.id
          AND portal.deleted_at IS NULL
          AND portal.publication_state = 'published'
      ) AS portal_published
    FROM scoped_properties p
    LEFT JOIN synced_properties synced ON synced.property_id = p.id
    LEFT JOIN ${merchantAiEnablement} enablement
      ON enablement.organization_id = ${organizationId}
      AND enablement.property_id = p.id
    ORDER BY p.id
  `
}

/** Reporting-owned read facade over the canonical per-Property setup facts. */
export const createPropertySetupRepository = (db: Database): PropertySetupRepository => ({
  readPropertyFacts: (input) =>
    trace('dashboard.propertySetup.readPropertyFacts', async () => {
      const result = await db.execute<FactRow>(
        propertyFactsSql(
          input.organizationId,
          propertyIdInScope(sql`p.id`, [input.propertyId]),
        ),
      )
      const row = result.rows[0]
      return row ? toFacts(row) : null
    }),

  listPropertyFacts: (input) =>
    trace('dashboard.propertySetup.listPropertyFacts', async () => {
      const result = await db.execute<FactRow>(
        propertyFactsSql(
          input.organizationId,
          propertyIdInScope(sql`p.id`, input.accessiblePropertyIds),
        ),
      )
      return result.rows.map(toFacts)
    }),
})
