import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiReviewAnalysisBacklog } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogOrigin,
  AiReviewAnalysisBacklogPort,
} from '../../application/ports/ai-review-analysis-backlog.port'
import type { AiAdmissionLane } from '../../domain/admission-lanes'

type BacklogRow = Readonly<{
  event_envelope_id: string
  organization_id: string
  property_id: string
  review_id: string
  source_epoch: number | string
  source_revision: number | string
  analysis_sequence: number | string
  origin: string
  priority: string
  attempts: number | string
  first_started_at: Date | string
}>

const ORIGINS: ReadonlySet<string> = new Set<AiReviewAnalysisBacklogOrigin>([
  'historical_onboarding',
  'backfill',
  'deferred_live',
])
const PRIORITIES: ReadonlySet<string> = new Set<AiAdmissionLane>([
  'background',
  'interactive',
])

function safeInteger(value: number | string, field: string, minimum = 0): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`AI review analysis backlog ${field} is invalid`)
  }
  return parsed
}

function instant(value: Date | string, field: string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`AI review analysis backlog ${field} is invalid`)
  }
  return parsed
}

function mapEntry(row: BacklogRow): AiReviewAnalysisBacklogEntry {
  if (!ORIGINS.has(row.origin) || !PRIORITIES.has(row.priority)) {
    throw new Error('AI review analysis backlog row has an unknown classification')
  }
  return {
    eventEnvelopeId: row.event_envelope_id,
    organizationId: organizationId(row.organization_id),
    propertyId: propertyId(row.property_id),
    reviewId: reviewId(row.review_id),
    sourceEpoch: safeInteger(row.source_epoch, 'source epoch'),
    sourceRevision: safeInteger(row.source_revision, 'source revision', 1),
    analysisSequence: safeInteger(row.analysis_sequence, 'analysis sequence', 1),
    origin: row.origin as AiReviewAnalysisBacklogOrigin,
    priority: row.priority as AiAdmissionLane,
    attempts: safeInteger(row.attempts, 'attempts'),
    firstStartedAtEpochMillis: instant(row.first_started_at, 'first start'),
  }
}

/**
 * The newest review first: a manager is likelier to answer a recent review, so
 * its analysis is the one worth having early. The review's own publication time
 * orders the queue; its local creation time stands in once source content has
 * been cleared. The sequence breaks ties deterministically.
 */
const NEWEST_FIRST = sql`
  (backlog.priority = 'interactive') DESC,
  COALESCE(review.reviewed_at, review.created_at) DESC NULLS LAST,
  backlog.analysis_sequence DESC,
  backlog.event_envelope_id
`

export const createAiReviewAnalysisBacklogAdapter = (
  db: Database,
): AiReviewAnalysisBacklogPort =>
  Object.freeze({
    async enqueue(input) {
      const now = new Date(input.nowEpochMillis)
      await db
        .insert(aiReviewAnalysisBacklog)
        .values({
          eventEnvelopeId: input.eventEnvelopeId,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          reviewId: input.reviewId,
          sourceEpoch: input.sourceEpoch,
          sourceRevision: input.sourceRevision,
          analysisSequence: input.analysisSequence,
          origin: input.origin,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: aiReviewAnalysisBacklog.eventEnvelopeId })
    },

    async claimReady(input) {
      if (
        !Number.isSafeInteger(input.perProperty) ||
        input.perProperty < 1 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1
      ) {
        return []
      }
      const now = new Date(input.nowEpochMillis)
      const claimedUntil = new Date(input.nowEpochMillis + input.leaseMillis)
      const propertyCount = Math.max(1, Math.ceil(input.limit / input.perProperty))
      return db.transaction(async (tx) => {
        // Properties with ready work, in random order: every property with a
        // backlog gets its turn without a fairness ledger, however many there are.
        const ready = await tx.execute(sql`
          SELECT property_id
          FROM ai_review_analysis_backlog
          WHERE (state = 'queued' AND next_attempt_at <= ${now})
             OR (state = 'claimed' AND claimed_until <= ${now})
          GROUP BY property_id
          ORDER BY random()
          LIMIT ${propertyCount}
        `)
        const claimed: AiReviewAnalysisBacklogEntry[] = []
        for (const row of ready.rows as unknown as ReadonlyArray<
          Readonly<{ property_id: string }>
        >) {
          if (claimed.length >= input.limit) break
          const take = Math.min(input.perProperty, input.limit - claimed.length)
          const result = await tx.execute(sql`
            WITH candidates AS (
              SELECT backlog.event_envelope_id
              FROM ai_review_analysis_backlog AS backlog
              LEFT JOIN reviews AS review
                ON review.id = backlog.review_id
               AND review.organization_id = backlog.organization_id
               AND review.property_id = backlog.property_id
              WHERE backlog.property_id = ${row.property_id}::uuid
                AND (
                  (backlog.state = 'queued' AND backlog.next_attempt_at <= ${now})
                  OR (backlog.state = 'claimed' AND backlog.claimed_until <= ${now})
                )
              ORDER BY ${NEWEST_FIRST}
              LIMIT ${take}
              FOR UPDATE OF backlog SKIP LOCKED
            )
            UPDATE ai_review_analysis_backlog AS target
            SET state = 'claimed',
                claimed_until = ${claimedUntil},
                first_started_at = COALESCE(target.first_started_at, ${now}),
                updated_at = ${now}
            FROM candidates
            WHERE target.event_envelope_id = candidates.event_envelope_id
            RETURNING target.event_envelope_id, target.organization_id,
              target.property_id, target.review_id, target.source_epoch,
              target.source_revision, target.analysis_sequence, target.origin,
              target.priority, target.attempts, target.first_started_at
          `)
          claimed.push(...(result.rows as unknown as BacklogRow[]).map(mapEntry))
        }
        return claimed
      })
    },

    async claimForReview(input) {
      const now = new Date(input.nowEpochMillis)
      const claimedUntil = new Date(input.nowEpochMillis + input.leaseMillis)
      const result = await db.execute(sql`
        WITH candidate AS (
          SELECT event_envelope_id
          FROM ai_review_analysis_backlog
          WHERE organization_id = ${input.organizationId}
            AND property_id = ${input.propertyId}::uuid
            AND review_id = ${input.reviewId}::uuid
            AND (state = 'queued' OR claimed_until <= ${now})
          ORDER BY analysis_sequence DESC, event_envelope_id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ai_review_analysis_backlog AS target
        SET state = 'claimed',
            priority = 'interactive',
            claimed_until = ${claimedUntil},
            first_started_at = COALESCE(target.first_started_at, ${now}),
            updated_at = ${now}
        FROM candidate
        WHERE target.event_envelope_id = candidate.event_envelope_id
        RETURNING target.event_envelope_id, target.organization_id, target.property_id,
          target.review_id, target.source_epoch, target.source_revision,
          target.analysis_sequence, target.origin, target.priority, target.attempts,
          target.first_started_at
      `)
      const row = result.rows[0] as BacklogRow | undefined
      return row ? mapEntry(row) : null
    },

    async complete(input) {
      await db
        .delete(aiReviewAnalysisBacklog)
        .where(
          and(
            eq(aiReviewAnalysisBacklog.eventEnvelopeId, input.eventEnvelopeId),
            eq(aiReviewAnalysisBacklog.organizationId, input.organizationId),
          ),
        )
    },

    async reschedule(input) {
      const now = new Date(input.nowEpochMillis)
      await db
        .update(aiReviewAnalysisBacklog)
        .set({
          state: 'queued',
          claimedUntil: null,
          nextAttemptAt: new Date(
            Math.max(input.nextAttemptAtEpochMillis, input.nowEpochMillis),
          ),
          attempts: sql`LEAST(${aiReviewAnalysisBacklog.attempts} + 1, 2147483647)`,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiReviewAnalysisBacklog.eventEnvelopeId, input.eventEnvelopeId),
            eq(aiReviewAnalysisBacklog.organizationId, input.organizationId),
          ),
        )
    },

    async readProgress(input) {
      const result = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM ai_review_analysis_backlog
            WHERE organization_id = ${input.organizationId}
              AND property_id = ${input.propertyId}::uuid
              AND state = 'queued') AS queued,
          (SELECT count(*)::int FROM ai_review_analysis_backlog
            WHERE organization_id = ${input.organizationId}
              AND property_id = ${input.propertyId}::uuid
              AND state = 'claimed') AS in_progress,
          (SELECT count(DISTINCT review_id)::int FROM ai_review_analyses
            WHERE organization_id = ${input.organizationId}
              AND property_id = ${input.propertyId}::uuid
              AND source_epoch = ${input.sourceEpoch}
              AND review_analysis_epoch = ${input.reviewAnalysisEpoch}
              AND status = 'ready') AS analysed,
          (SELECT count(DISTINCT review_id)::int FROM ai_property_aggregate_settlements
            WHERE organization_id = ${input.organizationId}
              AND property_id = ${input.propertyId}::uuid
              AND source_epoch = ${input.sourceEpoch}
              AND review_analysis_epoch = ${input.reviewAnalysisEpoch}) AS settled
      `)
      const row = result.rows[0] as
        | Readonly<
            Record<'queued' | 'in_progress' | 'analysed' | 'settled', number | string>
          >
        | undefined
      return {
        queued: safeInteger(row?.queued ?? 0, 'queued count'),
        inProgress: safeInteger(row?.in_progress ?? 0, 'in-progress count'),
        analysed: safeInteger(row?.analysed ?? 0, 'analysed count'),
        settled: safeInteger(row?.settled ?? 0, 'settled count'),
      }
    },

    async hasPendingForReview(input) {
      const [row] = await db
        .select({ eventEnvelopeId: aiReviewAnalysisBacklog.eventEnvelopeId })
        .from(aiReviewAnalysisBacklog)
        .where(
          and(
            eq(aiReviewAnalysisBacklog.organizationId, input.organizationId),
            eq(aiReviewAnalysisBacklog.propertyId, input.propertyId),
            eq(aiReviewAnalysisBacklog.reviewId, input.reviewId),
          ),
        )
        .limit(1)
      return row !== undefined
    },
  })
