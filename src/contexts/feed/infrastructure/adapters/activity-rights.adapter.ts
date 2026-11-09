// Activity's executor for the manual rights script: Property and Organization
// erasure of Recent Activity (the feed, its replay facts and, for an
// Organization, its actor-label redactions).
//
// Operational Action History and its legal holds are independently required
// evidence and are never touched; an unreleased legal hold refuses the erasure
// before anything is written. Every statement is bound to the Organization id,
// and the Property scope also to the Property id.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import {
  eraseActivityOrganizationRows,
  type ActivityLifecycleProjectionCounts,
} from './activity-organization-lifecycle.adapter'

const CONTEXT = 'activity'

const ACTIVITY_RIGHTS_TABLES = Object.freeze({
  organization: [
    'recent_activity_entries',
    'recent_activity_replay_facts',
    'recent_activity_actor_label_redactions',
  ],
  property: ['recent_activity_entries', 'recent_activity_replay_facts'],
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

function propertyOf(plan: { scope: string; propertyId?: string }): string | null {
  if (plan.scope !== 'property') return null
  if (!plan.propertyId) throw new Error('--property is required for a Property erasure')
  return plan.propertyId
}

function total(counts: ActivityLifecycleProjectionCounts): number {
  return counts.entries + counts.replayFacts + counts.actorLabelRedactions
}

async function assertHeld(tx: Tx, organization: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT state FROM organization_lifecycle_authority
    WHERE organization_id = ${organization}
  `)
  const state = (result.rows[0] as { state?: string } | undefined)?.state
  if (state === undefined) throw new Error('Organization has no lifecycle record')
  if (state === 'active') {
    throw new Error('Organization is still active; suspend it before a purge')
  }
}

async function assertNoLegalHold(tx: Tx, organization: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT count(*)::int AS n FROM operational_action_history_legal_holds
    WHERE organization_id = ${organization} AND released_at IS NULL
  `)
  const holds = Number((result.rows[0] as { n?: number }).n ?? 0)
  if (holds > 0) {
    throw new Error(
      `Activity erasure blocked: active_operational_history_legal_holds=${holds}`,
    )
  }
}

async function assertReady(
  tx: Tx,
  organization: string,
  property: string | null,
): Promise<void> {
  if (property === null) await assertHeld(tx, organization)
  await assertNoLegalHold(tx, organization)
}

class RefusalProbeRolledBack extends Error {}

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

async function erasePropertyRows(
  tx: Tx,
  organization: string,
  property: string,
): Promise<ActivityLifecycleProjectionCounts> {
  const entries = await tx.execute(sql`
    DELETE FROM recent_activity_entries
    WHERE organization_id = ${organization} AND property_id = ${property}
    RETURNING 1
  `)
  const replayFacts = await tx.execute(sql`
    DELETE FROM recent_activity_replay_facts
    WHERE organization_id = ${organization} AND property_id = ${property}
    RETURNING 1
  `)
  return {
    entries: entries.rows.length,
    replayFacts: replayFacts.rows.length,
    actorLabelRedactions: 0,
  }
}

/** Exported so replayers and tests run the erasure body inside their own transaction. */
export async function activityRightsEraseInTransaction(
  tx: Tx,
  organization: string,
  property: string | null,
): Promise<number> {
  const counts =
    property === null
      ? await eraseActivityOrganizationRows(tx, organization)
      : await erasePropertyRows(tx, organization, property)
  return total(counts)
}

async function reportCounts(
  db: Database,
  organization: string,
  property: string | null,
): Promise<ReadonlyArray<string>> {
  const scoped = property === null ? sql`` : sql` AND property_id = ${property}`
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM recent_activity_entries
        WHERE organization_id = ${organization}${scoped}) AS entries,
      (SELECT count(*) FROM recent_activity_replay_facts
        WHERE organization_id = ${organization}${scoped}) AS replay_facts,
      (SELECT count(*) FROM recent_activity_actor_label_redactions
        WHERE organization_id = ${organization}) AS redactions
  `)
  const row = result.rows[0] as Record<string, string | number>
  return [
    `recent_activity_entries ${Number(row.entries)}`,
    `recent_activity_replay_facts ${Number(row.replay_facts)}`,
    ...(property === null
      ? [`recent_activity_actor_label_redactions ${Number(row.redactions)}`]
      : []),
  ]
}

/** Re-erases a restored cell: one replayer per subject class the executor journals. */
export function createActivityErasureReplayers(): ReadonlyArray<BackupErasureReplayer> {
  return [
    {
      context: CONTEXT,
      subjectClass: 'organization',
      reErase: (tx, entry) =>
        activityRightsEraseInTransaction(tx, entry.organizationId, null),
    },
    {
      context: CONTEXT,
      subjectClass: 'property',
      reErase(tx, entry) {
        if (!entry.propertyId) throw new Error('property entry has no property id')
        return activityRightsEraseInTransaction(
          tx,
          entry.organizationId,
          entry.propertyId,
        )
      },
    },
  ]
}

export function createActivityRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: CONTEXT,
    scopes: ['property', 'organization'] as const,
    journalContexts: [CONTEXT] as const,
    tables: {
      organization: ACTIVITY_RIGHTS_TABLES.organization,
      property: ACTIVITY_RIGHTS_TABLES.property,
    },
    async preflight(plan) {
      if (plan.scope !== 'organization' && plan.scope !== 'property') {
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      }
      const refusal = await refusalOf(db, plan.organizationId, propertyOf(plan))
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) => reportCounts(db, plan.organizationId, propertyOf(plan)),
    exportFiles: async () => [],
    async apply(plan) {
      if (plan.scope !== 'organization' && plan.scope !== 'property') {
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      }
      try {
        const property = propertyOf(plan)
        const deleted = await db.transaction(async (tx) => {
          await assertReady(tx, plan.organizationId, property)
          return activityRightsEraseInTransaction(tx, plan.organizationId, property)
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
