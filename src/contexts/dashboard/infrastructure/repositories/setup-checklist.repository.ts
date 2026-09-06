import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleConnections,
  portalHealthIntervals,
  portalPublicationActivations,
  portalResponsibleManagers,
  portals,
  properties,
  propertyResponsibleManagers,
  reviewProviderSnapshotRuns,
  setupChecklistMilestones,
} from '#/shared/db/schema'
import { propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import {
  SETUP_CHECKLIST_STEP_KEYS,
  type SetupChecklistFact,
  type SetupChecklistFacts,
  type SetupChecklistRepository,
  type SetupChecklistStepKey,
} from '../../application/ports/setup-checklist.repository'

type CanonicalFactRow = Readonly<{
  anchor_property_id: string | null
  google_connection_completed_at: Date | string | null
  initial_review_sync_completed_at: Date | string | null
  published_portal_completed_at: Date | string | null
  responsible_managers_completed_at: Date | string | null
}>

const timestampFromDriver = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value)

const completionByKey = (
  row: CanonicalFactRow,
): Readonly<Record<SetupChecklistStepKey, Date | null>> => ({
  google_connection: timestampFromDriver(row.google_connection_completed_at),
  initial_review_sync: timestampFromDriver(row.initial_review_sync_completed_at),
  published_portal: timestampFromDriver(row.published_portal_completed_at),
  responsible_managers: timestampFromDriver(row.responsible_managers_completed_at),
})

function propertyScopeSql(propertyIds: readonly string[] | null) {
  if (propertyIds === null) return sql`true`
  if (propertyIds.length === 0) return sql`false`
  return sql`p.id IN (${sql.join(
    propertyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`
}

/**
 * Dashboard-owned read facade for the four EXP-01 setup facts. It stores no
 * source state: only the first time a fully canonical fact was observed true.
 */
export const createSetupChecklistRepository = (
  db: Database,
): SetupChecklistRepository => ({
  readAndRecord: (input) =>
    trace('dashboard.setupChecklist.readAndRecord', () =>
      db.transaction(async (tx) => {
        const scope = propertyScopeSql(input.accessiblePropertyIds)
        const canonicalResult = await tx.execute<CanonicalFactRow>(sql`
          WITH scoped_properties AS MATERIALIZED (
            SELECT p.*
            FROM ${properties} p
            WHERE p.organization_id = ${input.organizationId}
              AND p.deleted_at IS NULL
              AND p.lifecycle_state = 'active'
              AND ${scope}
          ), qualified_properties AS MATERIALIZED (
            SELECT
              p.id,
              p.source_epoch,
              GREATEST(
                p.profile_confirmed_at,
                p.timezone_resolved_at
              ) AS completed_at
            FROM scoped_properties p
            WHERE p.google_binding_state = 'active'
              AND p.google_connection_id IS NOT NULL
              AND p.gbp_account_id IS NOT NULL
              AND p.gbp_location_id IS NOT NULL
              AND p.profile_source = 'tenant_confirmed'
              AND p.profile_confirmed_at IS NOT NULL
              AND p.country_code IS NOT NULL
              AND p.country_source = 'tenant_confirmed'
              AND p.timezone_source = 'tenant_confirmed'
              AND p.timezone_resolved_at IS NOT NULL
          ), healthy_connection AS (
            SELECT MIN(COALESCE(c.credential_authorized_at, c.created_at)) AS completed_at
            FROM ${googleConnections} c
            WHERE c.organization_id = ${input.organizationId}
              AND c.visibility = 'organization'
              AND c.status = 'active'
              AND c.credential_use_state = 'active'
          ), latest_sync_terminal AS MATERIALIZED (
            SELECT DISTINCT ON (r.property_id)
              r.property_id,
              r.state,
              r.terminal_at
            FROM ${reviewProviderSnapshotRuns} r
            JOIN qualified_properties p
              ON p.id = r.property_id
              AND p.source_epoch = r.source_epoch
            WHERE r.organization_id = ${input.organizationId}
              AND r.state IN ('completed', 'failed')
            ORDER BY r.property_id, r.terminal_at DESC, r.id DESC
          ), healthy_sync AS (
            SELECT MIN(r.terminal_at) AS completed_at
            FROM latest_sync_terminal r
            WHERE r.state = 'completed'
          ), healthy_portal AS (
            SELECT MIN(a.activated_at) AS completed_at
            FROM ${portals} portal
            JOIN qualified_properties p ON p.id = portal.property_id
            JOIN ${portalPublicationActivations} a
              ON a.organization_id = portal.organization_id
              AND a.property_id = portal.property_id
              AND a.portal_id = portal.id
              AND a.deactivated_at IS NULL
            JOIN ${portalHealthIntervals} health
              ON health.organization_id = portal.organization_id
              AND health.property_id = portal.property_id
              AND health.portal_id = portal.id
              AND health.effective_to IS NULL
              AND health.status = 'healthy'
            WHERE portal.organization_id = ${input.organizationId}
              AND portal.deleted_at IS NULL
              AND portal.publication_state = 'published'
          ), manager_ready AS (
            SELECT MIN(GREATEST(
              property_manager.effective_from,
              portal_manager.effective_from,
              activation.activated_at
            )) AS completed_at
            FROM qualified_properties p
            JOIN ${propertyResponsibleManagers} property_manager
              ON property_manager.organization_id = ${input.organizationId}
              AND property_manager.property_id = p.id
              AND property_manager.effective_to IS NULL
            JOIN ${portals} portal
              ON portal.organization_id = ${input.organizationId}
              AND portal.property_id = p.id
              AND portal.deleted_at IS NULL
              AND portal.publication_state = 'published'
            JOIN ${portalPublicationActivations} activation
              ON activation.organization_id = portal.organization_id
              AND activation.property_id = portal.property_id
              AND activation.portal_id = portal.id
              AND activation.deactivated_at IS NULL
            JOIN ${portalResponsibleManagers} portal_manager
              ON portal_manager.organization_id = portal.organization_id
              AND portal_manager.property_id = portal.property_id
              AND portal_manager.portal_id = portal.id
              AND portal_manager.effective_to IS NULL
          )
          SELECT
            COALESCE(
              (SELECT id::text FROM qualified_properties ORDER BY completed_at, id LIMIT 1),
              (SELECT id::text FROM scoped_properties ORDER BY created_at, id LIMIT 1)
            ) AS anchor_property_id,
            (SELECT completed_at FROM healthy_connection)
              AS google_connection_completed_at,
            (SELECT completed_at FROM healthy_sync)
              AS initial_review_sync_completed_at,
            (SELECT completed_at FROM healthy_portal)
              AS published_portal_completed_at,
            (SELECT completed_at FROM manager_ready)
              AS responsible_managers_completed_at
        `)
        const canonical = canonicalResult.rows[0] ?? {
          anchor_property_id: null,
          google_connection_completed_at: null,
          initial_review_sync_completed_at: null,
          published_portal_completed_at: null,
          responsible_managers_completed_at: null,
        }
        const currentCompletion = completionByKey(canonical)

        for (const step of SETUP_CHECKLIST_STEP_KEYS) {
          const completedAt = currentCompletion[step]
          if (completedAt === null) continue
          await tx
            .insert(setupChecklistMilestones)
            .values({
              organizationId: input.organizationId,
              step,
              firstCompletedAt: completedAt,
            })
            .onConflictDoNothing()
        }

        const milestones = await tx
          .select({
            step: setupChecklistMilestones.step,
            firstCompletedAt: setupChecklistMilestones.firstCompletedAt,
          })
          .from(setupChecklistMilestones)
          .where(
            sql`${setupChecklistMilestones.organizationId} = ${input.organizationId}`,
          )
        const firstCompletion = new Map(
          milestones.map((milestone) => [milestone.step, milestone.firstCompletedAt]),
        )
        const fact = (step: SetupChecklistStepKey): SetupChecklistFact => ({
          currentlySatisfied: currentCompletion[step] !== null,
          firstCompletedAt: firstCompletion.get(step) ?? null,
        })

        return {
          anchorPropertyId:
            canonical.anchor_property_id === null
              ? null
              : propertyId(canonical.anchor_property_id),
          googleConnection: fact('google_connection'),
          initialReviewSync: fact('initial_review_sync'),
          publishedPortal: fact('published_portal'),
          responsibleManagers: fact('responsible_managers'),
        } satisfies SetupChecklistFacts
      }),
    ),
})
