// BQC-3.9 — shadow-compare harness (phase BQC-3 §7 "shadow" state).
//
// For shadow families the durable path and the in-process bus path BOTH
// process the same event. Since the durable consumers and the bus handlers
// write the same projection rows, comparing "outcomes" means comparing the
// resulting inbox_items row state after each path processed the event:
// status, the reply milestone fields, sourceDate, platform, and existence.
// Content (snippet/text/reviewer) is never part of the comparison — inbox
// items carry none (BQC-1.2) and mismatch samples name fields only (ADR 0030).
//
// This module is deliberately pure: it does NOT hook into production code
// paths. The synthetic harness (durable-cutover integration test) drives the
// comparison explicitly — it snapshots the projection after each path, calls
// compareInboxProjection, and records the result on a collector. Production
// stays clean; shadow runs are an operator-driven rehearsal, not a runtime
// branch.

import type { CutoverFamily } from './cutover-flags'

/**
 * Content-free read-back of the projection-owned fields of one inbox item.
 * Timestamps are ISO strings; `exists: false` means no row for the source.
 */
export type InboxProjectionSnapshot = Readonly<{
  exists: boolean
  status?: string
  sourceDate?: string | null
  platform?: string | null
  firstReplySubmittedAt?: string | null
  firstReplyPublishedAt?: string | null
  closedAt?: string | null
}>

export type ShadowCompareResult = Readonly<{
  family: CutoverFamily
  eventId: string
  outcome: 'match' | 'mismatch'
  /** Diverging field NAMES only — never values (ADR 0030 content-free). */
  mismatchFields: ReadonlyArray<string>
}>

/** Projection-owned fields compared between the two paths, in report order. */
const COMPARED_FIELDS = [
  'status',
  'sourceDate',
  'platform',
  'firstReplySubmittedAt',
  'firstReplyPublishedAt',
  'closedAt',
] as const

/**
 * Compare the bus-path projection against the durable-path projection for the
 * same event. Existence dominates: when one path produced a row and the other
 * did not, the only meaningful divergence is 'exists'.
 */
export function compareInboxProjection(args: {
  family: CutoverFamily
  eventId: string
  bus: InboxProjectionSnapshot
  durable: InboxProjectionSnapshot
}): ShadowCompareResult {
  const { family, eventId, bus, durable } = args
  if (bus.exists !== durable.exists) {
    return { family, eventId, outcome: 'mismatch', mismatchFields: ['exists'] }
  }
  if (!bus.exists) {
    return { family, eventId, outcome: 'match', mismatchFields: [] }
  }
  const mismatchFields = COMPARED_FIELDS.filter(
    (field) => (bus[field] ?? null) !== (durable[field] ?? null),
  )
  return {
    family,
    eventId,
    outcome: mismatchFields.length === 0 ? 'match' : 'mismatch',
    mismatchFields,
  }
}

export type ShadowCompareSummary = Readonly<{
  compared: number
  matched: number
  mismatched: number
  results: ReadonlyArray<ShadowCompareResult>
}>

export type ShadowCompareCollector = Readonly<{
  /** Record one comparison: structured 'shadow.compare' log line + summary. */
  record: (result: ShadowCompareResult) => void
  summary: () => ShadowCompareSummary
}>

/** Minimal logging surface (pino satisfies this). */
export type ShadowCompareLogger = Readonly<{
  info(obj: Readonly<Record<string, unknown>>, msg: string): void
  warn(obj: Readonly<Record<string, unknown>>, msg: string): void
}>

/**
 * Accumulate comparison results and emit one structured 'shadow.compare' log
 * line each (info on match, warn on mismatch). The store is the logger plus
 * this in-memory summary — per the slice decision, no new table.
 */
export function createShadowCompareCollector(deps: {
  logger: ShadowCompareLogger
}): ShadowCompareCollector {
  const results: ShadowCompareResult[] = []
  return {
    record(result) {
      results.push(result)
      const line = {
        family: result.family,
        eventId: result.eventId,
        outcome: result.outcome,
        mismatchFields: result.mismatchFields,
      }
      if (result.outcome === 'match') deps.logger.info(line, 'shadow.compare')
      else deps.logger.warn(line, 'shadow.compare')
    },
    summary() {
      const mismatched = results.filter((r) => r.outcome === 'mismatch').length
      return {
        compared: results.length,
        matched: results.length - mismatched,
        mismatched,
        results: [...results],
      }
    },
  }
}
