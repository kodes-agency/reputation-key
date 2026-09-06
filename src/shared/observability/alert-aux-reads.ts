// BQC-7.4 — auxiliary alert reads the OperationsSnapshot does not carry.
//
// Three cheap aggregate reads, gathered once per health-check run (5-min
// cadence) and fed to the pure alert evaluation as AlertAuxReads:
//
//   - retention_runs latest-per-subject outcome (purge/retention failure) —
//     DISTINCT ON (subject), content-free: subject names + outcome only;
//   - policy_decision_audit denials in the trailing drift window, grouped by
//     stable reason (deployment-drift signal);
//   - delivered, unresolved native-feedback receipts: count and oldest age
//     only. Report text, provider content, identifiers, and attachment bytes
//     are not present in the local triage authority and cannot enter the read.
//
// Same operational-monitoring seam as health-metrics.ts (raw aggregate SQL
// via Drizzle — the eslint exemption sits next to it). Every sub-read
// degrades independently: a failed read logs a warn and falls back to EMPTY
// (never a fabricated breach) so one hiccup cannot mute the snapshot-based
// alerts — the same degraded-section posture as the operations snapshot.

import { sql } from 'drizzle-orm'
import type pino from 'pino'
import type { Database } from '#/shared/db'
import { betaFeedbackTriage } from '#/shared/db/schema/beta-feedback-triage.schema'
import { retentionRuns } from '#/shared/db/schema/review-sync.schema'
import { policyDecisionAudit } from '#/shared/db/schema/policy.schema'
import {
  POLICY_DENIAL_DRIFT_WINDOW_MS,
  type AlertAuxReads,
} from '#/shared/observability/alert-definitions'

export type AlertAuxReader = Readonly<{
  read: () => Promise<AlertAuxReads>
}>

export type AlertAuxReaderDeps = Readonly<{
  db: Database
  logger: pino.Logger
}>

/** retention_runs subjects whose LATEST sweep run failed (DISTINCT ON). */
async function readRetentionFailedSubjects(db: Database): Promise<readonly string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (${retentionRuns.subject})
      ${retentionRuns.subject} AS subject,
      ${retentionRuns.outcome} AS outcome
    FROM ${retentionRuns}
    ORDER BY ${retentionRuns.subject}, ${retentionRuns.startedAt} DESC
  `)
  return result.rows
    .filter((row) => (row as { outcome?: string }).outcome === 'failed')
    .map((row) => String((row as { subject?: string }).subject))
}

/** policy_decision_audit denials in the trailing drift window, by reason. */
async function readPolicyDenialsByReason(
  db: Database,
  windowMs: number,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      reason: policyDecisionAudit.reason,
      cnt: sql<number>`count(*)::int`,
    })
    .from(policyDecisionAudit)
    .where(
      sql`${policyDecisionAudit.decision} = 'deny'
        AND ${policyDecisionAudit.occurredAt} > NOW() - ${windowMs} * INTERVAL '1 millisecond'`,
    )
    .groupBy(policyDecisionAudit.reason)

  const out: Record<string, number> = {}
  for (const row of rows) out[row.reason] = row.cnt
  return out
}

async function readBetaFeedbackTriage(
  db: Database,
): Promise<AlertAuxReads['betaFeedbackTriage']> {
  const [row] = await db
    .select({
      deliveredUnresolvedCount: sql<number>`count(*)::int`,
      oldestDeliveredUnresolvedAgeMs: sql<number | null>`
        CASE
          WHEN count(*) = 0 THEN NULL
          ELSE GREATEST(
            0,
            floor(EXTRACT(EPOCH FROM (NOW() - min(${betaFeedbackTriage.createdAt}))) * 1000)
          )::bigint
        END
      `,
    })
    .from(betaFeedbackTriage)
    .where(
      sql`${betaFeedbackTriage.deliveryState} = 'delivered'
        AND ${betaFeedbackTriage.triageState} <> 'resolved'`,
    )

  if (row == null) throw new Error('beta-feedback triage aggregate returned no row')
  const deliveredUnresolvedCount = Number(row.deliveredUnresolvedCount)
  const oldestDeliveredUnresolvedAgeMs =
    row.oldestDeliveredUnresolvedAgeMs == null
      ? null
      : Number(row.oldestDeliveredUnresolvedAgeMs)
  if (
    !Number.isSafeInteger(deliveredUnresolvedCount) ||
    deliveredUnresolvedCount < 0 ||
    (oldestDeliveredUnresolvedAgeMs != null &&
      (!Number.isSafeInteger(oldestDeliveredUnresolvedAgeMs) ||
        oldestDeliveredUnresolvedAgeMs < 0))
  ) {
    throw new Error('beta-feedback triage aggregate returned an invalid reading')
  }
  return {
    monitorAvailable: true,
    deliveredUnresolvedCount,
    oldestDeliveredUnresolvedAgeMs,
  }
}

export function createAlertAuxReader(deps: AlertAuxReaderDeps): AlertAuxReader {
  return {
    read: async () => {
      const [retentionFailedSubjects, policyDenialsByReason, betaFeedbackTriage] =
        await Promise.all([
          readRetentionFailedSubjects(deps.db).catch((err: unknown) => {
            deps.logger.warn(
              { err },
              '[alert-aux] retention_runs read failed — empty fallback',
            )
            return [] as readonly string[]
          }),
          readPolicyDenialsByReason(deps.db, POLICY_DENIAL_DRIFT_WINDOW_MS).catch(
            (err: unknown) => {
              deps.logger.warn(
                { err },
                '[alert-aux] policy_decision_audit read failed — empty fallback',
              )
              return {} as Record<string, number>
            },
          ),
          readBetaFeedbackTriage(deps.db).catch((err: unknown) => {
            deps.logger.warn(
              { err },
              '[alert-aux] beta-feedback triage read failed — unavailable fallback',
            )
            return {
              monitorAvailable: false,
              deliveredUnresolvedCount: 0,
              oldestDeliveredUnresolvedAgeMs: null,
            } as const
          }),
        ])

      return { retentionFailedSubjects, policyDenialsByReason, betaFeedbackTriage }
    },
  }
}
