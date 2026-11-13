import type { Database } from '#/shared/db'
import {
  readRetentionRuleCandidateStats,
  type RetentionRule,
} from './execute-retention-rule'
import { retentionRuleCutoff } from './retention-cutoff'

export type RetentionDryRunRule = Readonly<{
  subject: string
  action: 'delete' | 'redact'
  cutoff: string
  rows: number
  oldest: string | null
}>

export type RetentionDryRun = Readonly<{
  mode: 'dry-run'
  generatedAt: string
  totalRows: number
  rules: ReadonlyArray<RetentionDryRunRule>
}>

/**
 * What the retention sweep would do right now, per rule: the action, the rows
 * it reaches and the oldest of them. The cutoff and predicate are the sweep's
 * own (`retentionRuleCutoff`, the executor's predicate). Every statement runs
 * in one READ ONLY transaction, so the database refuses a write whatever a
 * rule's predicate contains. Output is subjects, counts and instants only.
 */
export async function runRetentionDryRun(
  input: Readonly<{
    db: Database
    rules: ReadonlyArray<RetentionRule>
    now: Date
  }>,
): Promise<RetentionDryRun> {
  const rules = await input.db.transaction(
    async (tx) => {
      const reached: RetentionDryRunRule[] = []
      for (const rule of input.rules) {
        const cutoff = retentionRuleCutoff(rule, input.now)
        const stats = await readRetentionRuleCandidateStats(tx, rule, cutoff)
        reached.push({
          subject: rule.subject,
          action: rule.operation ?? 'delete',
          cutoff: cutoff.toISOString(),
          rows: stats.count,
          oldest: stats.oldest ? stats.oldest.toISOString() : null,
        })
      }
      return reached
    },
    { accessMode: 'read only' },
  )
  return {
    mode: 'dry-run',
    generatedAt: input.now.toISOString(),
    totalRows: rules.reduce((total, rule) => total + rule.rows, 0),
    rules,
  }
}

/** One line per rule for the terminal; the JSON carries the same fields. */
export function formatRetentionDryRun(run: RetentionDryRun): string {
  const lines = run.rules.map(
    (rule) =>
      `${rule.action.padEnd(6)} ${String(rule.rows).padStart(9)}  oldest ${rule.oldest ?? '-'}  ${rule.subject}`,
  )
  return [...lines, `total ${run.totalRows} rows across ${run.rules.length} rules`].join(
    '\n',
  )
}
