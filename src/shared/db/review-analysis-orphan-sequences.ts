// Find, and record as released, the analysis sequences a past leak left behind
// (ADR 0058 amendment 2026-10-22; `pnpm ops ai release-orphan-sequences`).
//
// Before the Review writer gave back the numbers of replayed and out-of-order
// observations, each of them left a sequence that no Review holds and no event
// announces. Coverage owes it a settlement for ever. An ORPHAN is such a number
// in the current source epoch of an enabled Property:
//
//   - after the authorization's start sequence and up to the review head,
//   - settled by nothing in the current Review Analysis epoch,
//   - held by no Review of the current source epoch (`reviews.analysis_sequence`),
//   - named by no outbox fact of the Property (`payload.analysisSequence`),
//   - not already released.
//
// Content-free end to end: numbers, counts and instants.
//
// It refuses while the head moved in the last QUIET_PERIOD_MINUTES, so work that
// was allocated a number but has not announced it yet can land first. The apply
// runs under the Property fence (`FOR NO KEY UPDATE`, the lock the allocator
// takes), so no number can be allocated, announced or released between the scan
// and the write.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewAiAnalysisReleasedSequences } from '#/shared/db/schema/review-analysis-released-sequences.schema'

/** How long the head must have been still before orphans are recorded. */
export const ORPHAN_QUIET_PERIOD_MINUTES = 15

/** A range wider than this is refused: the scan is meant for a few leaked numbers. */
const MAX_ORPHAN_SCAN_RANGE = 200_000

/** Rows per INSERT, to stay far below the driver's parameter limit. */
const INSERT_CHUNK = 1_000

type Executor = Pick<Database, 'execute'>

export type OrphanSequenceScan =
  | Readonly<{ status: 'property_not_found' }>
  | Readonly<{ status: 'not_enabled' }>
  | Readonly<{ status: 'no_head' }>
  | Readonly<{ status: 'range_too_wide'; range: number }>
  | Readonly<{
      status: 'head_recently_updated'
      headUpdatedAt: Date
      quietAfter: Date
    }>
  | Readonly<{
      status: 'scanned'
      organizationId: string
      propertyId: string
      sourceEpoch: number
      reviewAnalysisEpoch: number
      analysisStartSequence: number
      headSequence: number
      /** How the sequences of the range divide. They sum to the range. */
      breakdown: Readonly<{
        settled: number
        held: number
        announced: number
        released: number
        orphaned: number
      }>
      orphans: readonly number[]
    }>

type ScopeRow = Readonly<{
  organization_id: string
  source_epoch: number | string
  review_analysis_epoch: number | string | null
  analysis_start_sequence: number | string | null
  head_sequence: number | string | null
  head_updated_at: Date | string | null
  quiet_after: Date | string | null
  recently_updated: boolean | null
}>

function toNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Orphan sequence scan returned an invalid ${label}`)
  }
  return parsed
}

function toDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Orphan sequence scan returned an invalid ${label}`)
  }
  return date
}

/** The Property's current epoch, its enabled authorization and its head. */
async function readScope(executor: Executor, propertyId: string) {
  const result = await executor.execute<ScopeRow>(sql`
    SELECT property.organization_id,
           property.source_epoch,
           auth.review_analysis_epoch,
           auth.analysis_start_sequence,
           review_head.head_sequence,
           review_head.updated_at AS head_updated_at,
           review_head.updated_at
             + make_interval(mins => ${ORPHAN_QUIET_PERIOD_MINUTES}) AS quiet_after,
           review_head.updated_at
             > transaction_timestamp()
               - make_interval(mins => ${ORPHAN_QUIET_PERIOD_MINUTES}) AS recently_updated
    FROM properties AS property
    LEFT JOIN merchant_ai_enablement AS auth
      ON auth.organization_id = property.organization_id
     AND auth.property_id = property.id
     AND auth.authorized_source_epoch = property.source_epoch
     AND auth.state = 'enabled'
     AND 'review_analysis' = ANY(auth.capabilities)
    LEFT JOIN review_ai_analysis_heads AS review_head
      ON review_head.organization_id = property.organization_id
     AND review_head.property_id = property.id
     AND review_head.source_epoch = property.source_epoch
    WHERE property.id = ${propertyId}::uuid
  `)
  return result.rows[0]
}

type RangeRow = Readonly<{
  settled: number | string
  held: number | string
  announced: number | string
  released: number | string
  orphaned: number | string
  orphans: ReadonlyArray<number | string> | null
}>

/** Classify every sequence of (start, head] by the first reason it is not an orphan. */
async function classifyRange(
  executor: Executor,
  scope: Readonly<{
    organizationId: string
    propertyId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
    start: number
    head: number
  }>,
) {
  const result = await executor.execute<RangeRow>(sql`
    WITH candidate AS (
      SELECT series.n,
        EXISTS (
          SELECT 1 FROM ai_property_aggregate_settlements AS settlement
          WHERE settlement.organization_id = ${scope.organizationId}
            AND settlement.property_id = ${scope.propertyId}::uuid
            AND settlement.source_epoch = ${scope.sourceEpoch}
            AND settlement.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
            AND settlement.analysis_sequence = series.n
        ) AS is_settled,
        EXISTS (
          SELECT 1 FROM reviews AS review
          WHERE review.organization_id = ${scope.organizationId}
            AND review.property_id = ${scope.propertyId}::uuid
            AND review.source_epoch = ${scope.sourceEpoch}
            AND review.analysis_sequence = series.n
        ) AS is_held,
        EXISTS (
          SELECT 1 FROM outbox_events AS event
          WHERE event.organization_id = ${scope.organizationId}
            AND event.property_id = ${scope.propertyId}
            AND event.payload->>'analysisSequence' ~ '^[1-9][0-9]*$'
            AND (event.payload->>'analysisSequence')::numeric = series.n
            AND (
              event.payload->>'sourceEpoch' !~ '^[0-9]+$'
              OR event.payload->>'sourceEpoch' IS NULL
              OR (event.payload->>'sourceEpoch')::numeric = ${scope.sourceEpoch}
            )
        ) AS is_announced,
        EXISTS (
          SELECT 1 FROM review_ai_analysis_released_sequences AS released_sequence
          WHERE released_sequence.organization_id = ${scope.organizationId}
            AND released_sequence.property_id = ${scope.propertyId}::uuid
            AND released_sequence.source_epoch = ${scope.sourceEpoch}
            AND released_sequence.analysis_sequence = series.n
        ) AS is_released
      FROM generate_series(${scope.start}::bigint + 1, ${scope.head}::bigint)
        AS series(n)
    )
    SELECT count(*) FILTER (WHERE is_settled)::float8 AS settled,
           count(*) FILTER (WHERE NOT is_settled AND is_held)::float8 AS held,
           count(*) FILTER (WHERE NOT is_settled AND NOT is_held AND is_announced)::float8
             AS announced,
           count(*) FILTER (
             WHERE NOT is_settled AND NOT is_held AND NOT is_announced AND is_released
           )::float8 AS released,
           count(*) FILTER (
             WHERE NOT is_settled AND NOT is_held AND NOT is_announced AND NOT is_released
           )::float8 AS orphaned,
           array_agg(n::float8 ORDER BY n) FILTER (
             WHERE NOT is_settled AND NOT is_held AND NOT is_announced AND NOT is_released
           ) AS orphans
    FROM candidate
  `)
  const row = result.rows[0]
  if (!row) throw new Error('Orphan sequence scan returned no row')
  return row
}

/**
 * Scan one Property. Reads only; the apply repeats the scan under the fence.
 * The head's quiet period is judged by the database clock.
 */
export async function scanOrphanSequences(
  executor: Executor,
  propertyId: string,
): Promise<OrphanSequenceScan> {
  const scope = await readScope(executor, propertyId)
  if (!scope) return { status: 'property_not_found' }
  if (scope.review_analysis_epoch == null || scope.analysis_start_sequence == null) {
    return { status: 'not_enabled' }
  }
  if (scope.head_sequence == null) return { status: 'no_head' }
  if (scope.recently_updated === true) {
    return {
      status: 'head_recently_updated',
      headUpdatedAt: toDate(scope.head_updated_at, 'head instant'),
      quietAfter: toDate(scope.quiet_after, 'quiet instant'),
    }
  }
  const start = toNumber(scope.analysis_start_sequence, 'start sequence')
  const head = toNumber(scope.head_sequence, 'head sequence')
  const range = Math.max(0, head - start)
  if (range > MAX_ORPHAN_SCAN_RANGE) return { status: 'range_too_wide', range }

  const sourceEpoch = toNumber(scope.source_epoch, 'source epoch')
  const reviewAnalysisEpoch = toNumber(scope.review_analysis_epoch, 'analysis epoch')
  const row = await classifyRange(executor, {
    organizationId: scope.organization_id,
    propertyId,
    sourceEpoch,
    reviewAnalysisEpoch,
    start,
    head,
  })
  return {
    status: 'scanned',
    organizationId: scope.organization_id,
    propertyId,
    sourceEpoch,
    reviewAnalysisEpoch,
    analysisStartSequence: start,
    headSequence: head,
    breakdown: {
      settled: toNumber(row.settled, 'settled count'),
      held: toNumber(row.held, 'held count'),
      announced: toNumber(row.announced, 'announced count'),
      released: toNumber(row.released, 'released count'),
      orphaned: toNumber(row.orphaned, 'orphan count'),
    },
    orphans: (row.orphans ?? []).map((value) => toNumber(value, 'orphan sequence')),
  }
}

export type OrphanSequenceRelease =
  | Exclude<OrphanSequenceScan, Readonly<{ status: 'scanned' }>>
  | Readonly<{
      status: 'released'
      scan: Extract<OrphanSequenceScan, Readonly<{ status: 'scanned' }>>
      /** Rows this call wrote: the orphans, none of which was released before. */
      recorded: number
    }>

/**
 * Scan again under the Property fence and record what is still an orphan as
 * released (`operator_repair`). Idempotent: a second call finds nothing.
 */
export async function releaseOrphanSequences(
  db: Database,
  propertyId: string,
): Promise<OrphanSequenceRelease> {
  return db.transaction(async (tx) => {
    // The fence the allocator takes, so nothing is allocated, announced or
    // settled between the scan below and the write.
    const fenced = await tx.execute<{
      organization_id: string
      source_epoch: number
    }>(sql`
      SELECT organization_id, source_epoch
      FROM properties
      WHERE id = ${propertyId}::uuid
      FOR NO KEY UPDATE
    `)
    if (!fenced.rows[0]) return { status: 'property_not_found' as const }

    const scan = await scanOrphanSequences(tx, propertyId)
    if (scan.status !== 'scanned') return scan
    if (scan.orphans.length === 0)
      return { status: 'released' as const, scan, recorded: 0 }

    let recorded = 0
    for (let at = 0; at < scan.orphans.length; at += INSERT_CHUNK) {
      const inserted = await tx
        .insert(reviewAiAnalysisReleasedSequences)
        .values(
          scan.orphans.slice(at, at + INSERT_CHUNK).map((analysisSequence) => ({
            organizationId: scan.organizationId,
            propertyId: scan.propertyId,
            sourceEpoch: scan.sourceEpoch,
            analysisSequence,
            reason: 'operator_repair' as const,
          })),
        )
        .onConflictDoNothing()
        .returning({
          analysisSequence: reviewAiAnalysisReleasedSequences.analysisSequence,
        })
      recorded += inserted.length
    }
    return { status: 'released' as const, scan, recorded }
  })
}
