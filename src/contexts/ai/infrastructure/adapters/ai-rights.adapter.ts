// AI's executor for the manual rights script: Property and Organization
// erasure of the retained AI derivatives.
//
// The Organization body is the lifecycle purge's own delete loop. The Property
// body retires every derivative the Property holds (the same erasure an
// authorization change runs) and then deletes the Property's remaining AI
// rows. Every statement is bound to the Organization id, and the Property
// scope also to the Property id. The merchant consent evidence and the
// authorization head stay, as in the lifecycle purge.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { assertOrganizationHeld } from '#/shared/db/lifecycle/assert-organization-held'
import type { Tx } from '#/shared/outbox/commit'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import type { AiAuthorizationLifecycleTrigger } from '../../replay/contracts'
import {
  AI_PURGE_DELETE_TABLES,
  eraseAiOrganizationRows,
} from './ai-organization-lifecycle.adapter'
import { eraseRetiredDerivatives } from './ai-review-analysis-erasure'

const CONTEXT = 'ai'
const LOCK_TIMEOUT = '5s'

/** Held by the Organization's own cost windows rather than a Property. */
const ORGANIZATION_ONLY_TABLES: ReadonlySet<string> = new Set([
  'ai_organization_cost_windows',
])

/** Rows that go with their parent by cascade; the report counts them too. */
const CASCADE_TABLES = Object.freeze([
  'ai_draft_measurement_links',
  'ai_review_analysis_aspects',
  'ai_review_analysis_mentions',
  'ai_review_analysis_mention_sentences',
  'ai_review_analysis_mention_corrections',
  'ai_property_aggregate_contribution_aspects',
  'ai_property_aggregate_contribution_mentions',
  'ai_property_daily_aspect_aggregates',
] as const)

/** The tables the AI report counts and erasure changes, per request scope. */
const AI_RIGHTS_TABLES = Object.freeze({
  organization: [...AI_PURGE_DELETE_TABLES, ...CASCADE_TABLES],
  property: [...AI_PURGE_DELETE_TABLES, ...CASCADE_TABLES].filter(
    (table) => !ORGANIZATION_ONLY_TABLES.has(table),
  ),
})

type CountRow = Record<string, unknown>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

function count(value: unknown): number {
  return Number((value as string | number | null | undefined) ?? 0)
}

function propertyOf(plan: { propertyId?: string }): string {
  if (!plan.propertyId) throw new Error('--property is required for a Property erasure')
  return plan.propertyId
}

/** Authorizations, enrollments and operations that would outlive or rebuild the erasure. */
async function assertNothingLive(
  tx: Tx,
  organization: string,
  property: string | null,
): Promise<void> {
  const scoped = (column: string) =>
    property === null ? sql`` : sql` AND ${sql.raw(column)} = ${property}::uuid`
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM merchant_ai_enablement
        WHERE organization_id = ${organization} AND state = 'enabled'
        ${scoped('property_id')}) AS enabled_authorizations,
      (SELECT count(*) FROM ai_review_analysis_enrollments
        WHERE organization_id = ${organization}
          AND state IN ('awaiting_assisted_approval', 'queued', 'running')
          ${scoped('property_id')}) AS active_enrollments,
      (SELECT count(*) FROM ai_operations
        WHERE organization_id = ${organization}
          AND state IN ('pending', 'executing', 'succeeded_pending_delivery')
          ${scoped('property_id')}) AS in_flight_operations
  `)
  const row = result.rows[0] as CountRow
  const blockers = (
    ['enabled_authorizations', 'active_enrollments', 'in_flight_operations'] as const
  )
    .map((code) => `${code}=${count(row[code])}`)
    .filter((entry) => !entry.endsWith('=0'))
  if (blockers.length > 0)
    throw new Error(`AI work is outstanding: ${blockers.join(',')}`)
}

async function assertReady(
  tx: Tx,
  organization: string,
  property: string | null,
): Promise<void> {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`))
  if (property === null) await assertOrganizationHeld(tx, organization)
  await assertNothingLive(tx, organization, property)
}

class RefusalProbeRolledBack extends Error {}

/** The reason an erasure would be refused, or null; the probe rolls back. */
async function refusalOf(
  db: Database,
  organization: string,
  property: string | null,
): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await assertReady(tx, organization, property)
      throw new RefusalProbeRolledBack()
    })
    return null
  } catch (error) {
    return error instanceof RefusalProbeRolledBack ? null : errorMessage(error)
  }
}

/** Retires the Property's derivatives as a revoked authorization would. */
function revokedTrigger(
  organization: string,
  property: string,
  at: Date,
): AiAuthorizationLifecycleTrigger {
  return {
    eventEnvelopeId: '00000000-0000-4000-8000-000000000000',
    organizationId: toOrganizationId(organization),
    propertyId: toPropertyId(property),
    authorizationState: 'revoked',
    fence: {
      authorizationLineageId: '00000000-0000-4000-8000-000000000000',
      authorizationStateVersion: 0,
      sourceEpoch: -1,
      reviewAnalysisEpoch: -1,
      propertyTrendsEpoch: -1,
      analysisStartSequence: 0,
    } as AiAuthorizationLifecycleTrigger['fence'],
    correlationId: null,
    occurredAt: at,
  }
}

async function erasePropertyRows(
  tx: Tx,
  organization: string,
  property: string,
  at: Date,
): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext(${organization}))`,
  )
  await eraseRetiredDerivatives(tx, revokedTrigger(organization, property, at), [])
  let deleted = 0
  for (const table of AI_PURGE_DELETE_TABLES) {
    if (ORGANIZATION_ONLY_TABLES.has(table)) continue
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE organization_id = ${organization}
            AND property_id = ${property}::uuid
          RETURNING 1`,
    )
    deleted += result.rows.length
  }
  return deleted
}

/** Exported so replayers and tests run the erasure body inside their own transaction. */
async function aiRightsEraseInTransaction(
  tx: Tx,
  organization: string,
  property: string | null,
  at: Date,
): Promise<number> {
  return property === null
    ? eraseAiOrganizationRows(tx, organization)
    : erasePropertyRows(tx, organization, property, at)
}

async function reportCounts(
  db: Database,
  organization: string,
  property: string | null,
): Promise<ReadonlyArray<string>> {
  const lines: string[] = []
  await db.transaction(
    async (tx) => {
      for (const table of AI_PURGE_DELETE_TABLES) {
        if (property !== null && ORGANIZATION_ONLY_TABLES.has(table)) continue
        const result = await tx.execute(
          property === null
            ? sql`SELECT count(*) AS n FROM ${sql.identifier(table)}
                  WHERE organization_id = ${organization}`
            : sql`SELECT count(*) AS n FROM ${sql.identifier(table)}
                  WHERE organization_id = ${organization}
                    AND property_id = ${property}::uuid`,
        )
        lines.push(`${table} ${count((result.rows[0] as CountRow).n)}`)
      }
      for (const table of CASCADE_TABLES) {
        const result = await tx.execute(
          table === 'ai_draft_measurement_links'
            ? sql`SELECT count(*) AS n FROM ai_draft_measurement_links
                  WHERE generation_id IN (
                    SELECT id FROM ai_draft_measurements
                    WHERE organization_id = ${organization}
                    ${property === null ? sql`` : sql`AND property_id = ${property}::uuid`})`
            : property === null
              ? sql`SELECT count(*) AS n FROM ${sql.identifier(table)}
                    WHERE organization_id = ${organization}`
              : sql`SELECT count(*) AS n FROM ${sql.identifier(table)}
                    WHERE organization_id = ${organization}
                      AND property_id = ${property}::uuid`,
        )
        lines.push(`${table} ${count((result.rows[0] as CountRow).n)}`)
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  return lines
}

/** Re-erases a restored cell: one replayer per subject class the executor journals. */
export function createAiErasureReplayers(
  now: () => Date,
): ReadonlyArray<BackupErasureReplayer> {
  return [
    {
      context: CONTEXT,
      subjectClass: 'organization',
      reErase: (tx, entry) =>
        aiRightsEraseInTransaction(tx, entry.organizationId, null, now()),
    },
    {
      context: CONTEXT,
      subjectClass: 'property',
      reErase(tx, entry) {
        if (!entry.propertyId) throw new Error('property entry has no property id')
        return aiRightsEraseInTransaction(
          tx,
          entry.organizationId,
          entry.propertyId,
          now(),
        )
      },
    },
  ]
}

export function createAiRightsExecutor(db: Database, now: () => Date): RightsExecutor {
  const propertyScope = (plan: { scope: string; propertyId?: string }) =>
    plan.scope === 'property' ? propertyOf(plan) : null
  return Object.freeze({
    name: CONTEXT,
    scopes: ['property', 'organization'] as const,
    tables: AI_RIGHTS_TABLES,
    journalContexts: [CONTEXT] as const,
    async preflight(plan) {
      if (plan.scope !== 'organization' && plan.scope !== 'property') {
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      }
      const refusal = await refusalOf(db, plan.organizationId, propertyScope(plan))
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) => reportCounts(db, plan.organizationId, propertyScope(plan)),
    exportFiles: async () => [],
    async apply(plan) {
      if (plan.scope !== 'organization' && plan.scope !== 'property') {
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      }
      try {
        const property = propertyScope(plan)
        const deleted = await db.transaction(async (tx) => {
          await assertReady(tx, plan.organizationId, property)
          return aiRightsEraseInTransaction(tx, plan.organizationId, property, now())
        })
        return {
          ok: true,
          lines: [
            `erasure record org=${plan.organizationId}${property ? ` property=${property}` : ''} ${CONTEXT}:erase:v1:rows_deleted:${deleted}`,
          ],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}
