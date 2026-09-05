/**
 * LIF-01-T16 — report-only execution of the counsel retention registry.
 *
 * This module is the ONLY thing the registry can currently do. It counts, it
 * never writes: no evidence row is opened (opening one would claim a run
 * happened), no row is deleted, no column is redacted. That is what makes
 * "report-only" a property of the code rather than a promise in a runbook.
 *
 * The output is content-free — rule id, class, owner, source, cutoff, integer
 * count and apply status — so it is safe to attach to a counsel review or an
 * operational ticket.
 */

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  retentionRegistryApprovalBlockers,
  type RetentionHorizon,
  type RetentionRegistryRule,
} from './retention-registry'

const DAY_MS = 24 * 60 * 60 * 1000

export type RetentionRegistryRuleReport = Readonly<{
  ruleId: string
  dataClass: string
  ownerContext: string
  sourceKind: string
  source: string
  operation: 'delete' | 'redact'
  redactColumns: ReadonlyArray<string>
  approvalState: string
  applyBlocked: boolean
  /** ISO cutoff, or null when the class has no countable cutoff. */
  cutoff: string | null
  /** Eligible row count, or null with a reason when the class is not countable. */
  eligibleRows: number | null
  notCountableReason: string | null
  evidenceSubject: string
}>

export type RetentionRegistryReport = Readonly<{
  mode: 'report_only'
  generatedAt: string
  ruleCount: number
  countedRuleCount: number
  totalEligibleRows: number
  applyBlockedRuleIds: ReadonlyArray<string>
  rules: ReadonlyArray<RetentionRegistryRuleReport>
}>

/**
 * Calendar-month subtraction, not 30-day arithmetic: the 24-month Guest fact
 * horizon is stated in calendar months, and `retention_deadline` is computed
 * the same way. Using 730 days here would move the reported cutoff off the
 * stored deadline by up to two days.
 */
function subtractMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime())
  const targetDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() - months)
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth))
  return result
}

type Cutoff =
  | Readonly<{ countable: true; cutoff: Date }>
  | Readonly<{ countable: false; reason: string }>

function resolveCutoff(horizon: RetentionHorizon, generatedAt: Date): Cutoff {
  switch (horizon.kind) {
    case 'days':
      return {
        countable: true,
        cutoff: new Date(generatedAt.getTime() - horizon.days * DAY_MS),
      }
    case 'months':
      return { countable: true, cutoff: subtractMonths(generatedAt, horizon.months) }
    case 'row_deadline':
      // The deadline is stamped on the row, so the cutoff is simply "now".
      return { countable: true, cutoff: generatedAt }
    case 'retained_no_age_expiry':
      return { countable: false, reason: 'retained while its owning aggregate exists' }
    case 'counsel_undecided':
      return { countable: false, reason: 'no counsel-approved horizon exists' }
  }
}

type EligibilityCounter = (
  db: Database,
  table: string,
  anchorColumn: string,
  cutoff: Date,
) => Promise<number>

/**
 * Content-free count. The table and column come only from the static registry,
 * never from operator input, and the cutoff is bound as a parameter.
 */
async function countEligibleRows(
  db: Database,
  table: string,
  anchorColumn: string,
  cutoff: Date,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE ${sql.identifier(anchorColumn)} < ${cutoff}`,
  )
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
}

export async function buildRetentionRegistryReport(
  input: Readonly<{
    db: Database
    registry: ReadonlyArray<RetentionRegistryRule>
    generatedAt: Date
    countEligibleRows?: EligibilityCounter
  }>,
): Promise<RetentionRegistryReport> {
  const count = input.countEligibleRows ?? countEligibleRows
  const rules: RetentionRegistryRuleReport[] = []

  for (const rule of input.registry) {
    const resolved = resolveCutoff(rule.eligibility.horizon, input.generatedAt)
    const anchorColumn = rule.eligibility.anchorColumn
    const countable =
      resolved.countable && rule.sourceKind === 'table' && anchorColumn !== null
    const notCountableReason = countable
      ? null
      : resolved.countable
        ? `${rule.sourceKind} sources are not countable from PostgreSQL`
        : resolved.reason

    rules.push({
      ruleId: rule.id,
      dataClass: rule.dataClass,
      ownerContext: rule.ownerContext,
      sourceKind: rule.sourceKind,
      source: rule.source,
      operation: rule.operation ?? 'delete',
      redactColumns: rule.redactColumns ?? [],
      approvalState: rule.approvalState,
      applyBlocked: rule.approvalState === 'pending_counsel',
      cutoff: resolved.countable ? resolved.cutoff.toISOString() : null,
      eligibleRows:
        countable && resolved.countable
          ? await count(input.db, rule.source, anchorColumn as string, resolved.cutoff)
          : null,
      notCountableReason,
      evidenceSubject: rule.evidenceSubject,
    })
  }

  const counted = rules.filter(({ eligibleRows }) => eligibleRows !== null)
  return Object.freeze({
    mode: 'report_only',
    generatedAt: input.generatedAt.toISOString(),
    ruleCount: rules.length,
    countedRuleCount: counted.length,
    totalEligibleRows: counted.reduce((total, r) => total + (r.eligibleRows ?? 0), 0),
    applyBlockedRuleIds: retentionRegistryApprovalBlockers(input.registry),
    rules: Object.freeze(rules),
  })
}
