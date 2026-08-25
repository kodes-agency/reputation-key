import type { Database } from '#/shared/db'
import {
  countRetentionRuleCandidates,
  DEFAULT_MAX_BATCHES_PER_RUN,
  type RetentionRule,
} from './execute-retention-rule'

export type RetentionRuleReport = Readonly<{
  subject: string
  operation: 'delete' | 'redact'
  cutoff: string
  eligibleRows: number
  estimatedBatches: number
  wouldReachRunCap: boolean
}>

export type RetentionReport = Readonly<{
  mode: 'report'
  generatedAt: string
  batchSize: number
  maxBatches: number
  maximumRowsPerApply: number
  totalEligibleRows: number
  rules: ReadonlyArray<RetentionRuleReport>
}>

type CandidateCounter = (
  db: Database,
  rule: RetentionRule,
  cutoff: Date,
) => Promise<number>

/**
 * Inspect the exact static retention registry without opening evidence rows or
 * changing business data. Counts and cutoffs are intentionally content-free so
 * the JSON result is safe to attach to an operational ticket.
 *
 * Rules run sequentially to avoid turning a report against a large backlog into
 * an unbounded pool burst. The scheduled/apply path uses the same cutoffs and
 * bounds, so the estimate is directly comparable to the next run.
 */
export async function buildRetentionRuleReport(
  input: Readonly<{
    db: Database
    rules: ReadonlyArray<RetentionRule>
    generatedAt: Date
    batchSize?: number
    maxBatches?: number
    countCandidates?: CandidateCounter
  }>,
): Promise<RetentionReport> {
  const batchSize = input.batchSize ?? 500
  const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES_PER_RUN
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer')
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error('maxBatches must be a positive integer')
  }

  const countCandidates = input.countCandidates ?? countRetentionRuleCandidates
  const rules: RetentionRuleReport[] = []
  for (const rule of input.rules) {
    const cutoff = new Date(input.generatedAt.getTime() - rule.olderThanMs)
    const eligibleRows = await countCandidates(input.db, rule, cutoff)
    const estimatedBatches = Math.ceil(eligibleRows / batchSize)
    rules.push({
      subject: rule.subject,
      operation: rule.operation ?? 'delete',
      cutoff: cutoff.toISOString(),
      eligibleRows,
      estimatedBatches,
      wouldReachRunCap: estimatedBatches >= maxBatches,
    })
  }

  return {
    mode: 'report',
    generatedAt: input.generatedAt.toISOString(),
    batchSize,
    maxBatches,
    maximumRowsPerApply: batchSize * maxBatches,
    totalEligibleRows: rules.reduce((total, rule) => total + rule.eligibleRows, 0),
    rules,
  }
}
