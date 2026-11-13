// Activity's executor for the manual rights script: Property and Organization
// erasure of Recent Activity (the feed, its replay facts and, for an
// Organization, its actor-label redactions), and the pseudonymisation of the
// same scope's audit records, which keep the event without the person.
//
// Operational Action History and its legal holds are independently required
// evidence and are never touched; an unreleased legal hold refuses the erasure
// before anything is written. Every statement is bound to the Organization id,
// and the Property scope also to the Property id. Without the audit pseudonym
// secret the erasure refuses at preflight and a replay refuses its entries, so
// no audit record is left half pseudonymised.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import { assertOrganizationHeld } from '#/shared/db/lifecycle/assert-organization-held'
import type { Tx } from '#/shared/outbox/commit'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { rightsJournalEntry } from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import {
  AUDIT_PSEUDONYM_SECRET_MISSING,
  countAuditRecords,
  auditPseudonymKey,
  pseudonymiseAuditRecords,
} from '../../audit/pseudonymise.server'
import {
  eraseActivityOrganizationRows,
  type ActivityLifecycleProjectionCounts,
} from './activity-organization-erasure'

const CONTEXT = 'activity'

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
  if (property === null) assertOrganizationHeld(organization)
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

/**
 * The erasure body inside the caller's transaction. `pseudonymKey` derives from
 * the server secret and the journal entry id, so a replay writes the same
 * pseudonyms as the erasure.
 */
async function activityRightsEraseInTransaction(
  tx: Tx,
  organization: string,
  property: string | null,
  pseudonymKey: string,
): Promise<number> {
  const counts =
    property === null
      ? await eraseActivityOrganizationRows(tx, organization)
      : await erasePropertyRows(tx, organization, property)
  const audit = await pseudonymiseAuditRecords(
    tx,
    property === null
      ? { organizationId: organization }
      : { organizationId: organization, propertyId: property },
    pseudonymKey,
  )
  return total(counts) + audit
}

function pseudonymKeyOf(plan: RightsRequestPlan, secret: string | undefined): string {
  const entry = rightsJournalEntry(plan, CONTEXT)
  if ('error' in entry) throw new Error(entry.error)
  return auditPseudonymKey(secret, entry.id)
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
  const audit = await db.transaction(
    (tx) =>
      countAuditRecords(
        tx,
        property === null
          ? { organizationId: organization }
          : { organizationId: organization, propertyId: property },
      ),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  return [
    `recent_activity_entries ${Number(row.entries)}`,
    `recent_activity_replay_facts ${Number(row.replay_facts)}`,
    ...(property === null
      ? [`recent_activity_actor_label_redactions ${Number(row.redactions)}`]
      : []),
    `audit_events ${audit.events} (pseudonymised, kept)`,
    `audit_logs ${audit.logs} (pseudonymised, kept)`,
  ]
}

/**
 * Why a restore cannot replay these journal entries' Activity erasures, or
 * null: each one pseudonymises the audit records again, which needs the secret
 * the erasure used.
 */
export function activityReplayRefusal(
  entries: ReadonlyArray<Pick<BackupErasureLedgerEntry, 'context'>>,
  pseudonymSecret: string | undefined,
): string | null {
  if (pseudonymSecret) return null
  return entries.some((entry) => entry.context === CONTEXT)
    ? AUDIT_PSEUDONYM_SECRET_MISSING
    : null
}

/** Re-erases a restored cell: one replayer per subject class the executor journals. */
export function createActivityErasureReplayers(
  pseudonymSecret: string | undefined,
): ReadonlyArray<BackupErasureReplayer> {
  return [
    {
      context: CONTEXT,
      subjectClass: 'organization',
      reErase: (tx, entry) =>
        activityRightsEraseInTransaction(
          tx,
          entry.organizationId,
          null,
          auditPseudonymKey(pseudonymSecret, entry.id),
        ),
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
          auditPseudonymKey(pseudonymSecret, entry.id),
        )
      },
    },
  ]
}

export function createActivityRightsExecutor(
  db: Database,
  pseudonymSecret: string | undefined,
): RightsExecutor {
  return Object.freeze({
    name: CONTEXT,
    scopes: ['property', 'organization'] as const,
    tables: {
      organization: [
        'recent_activity_entries',
        'recent_activity_replay_facts',
        'recent_activity_actor_label_redactions',
        'audit_events',
        'audit_logs',
      ],
      property: [
        'recent_activity_entries',
        'recent_activity_replay_facts',
        'audit_events',
        'audit_logs',
      ],
    },
    journalContexts: [CONTEXT] as const,
    async preflight(plan) {
      if (plan.scope !== 'organization' && plan.scope !== 'property') {
        return { ok: false, error: `no ${CONTEXT} erasure for ${plan.scope}` }
      }
      if (!pseudonymSecret) return { ok: false, error: AUDIT_PSEUDONYM_SECRET_MISSING }
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
        const pseudonymKey = pseudonymKeyOf(plan, pseudonymSecret)
        const deleted = await db.transaction(async (tx) => {
          await assertReady(tx, plan.organizationId, property)
          return activityRightsEraseInTransaction(
            tx,
            plan.organizationId,
            property,
            pseudonymKey,
          )
        })
        return {
          ok: true,
          lines: [
            `erasure record org=${plan.organizationId}${property ? ` property=${property}` : ''} ${CONTEXT}:erase:v1:rows_changed:${deleted}`,
          ],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}
