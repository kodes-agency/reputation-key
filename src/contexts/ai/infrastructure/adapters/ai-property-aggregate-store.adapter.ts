import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyDailyAggregates,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { OPENAI_MODEL_SNAPSHOT } from '#/shared/ai-openai-request-contract'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '#/shared/ai-property-calendar-profile'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../../application/ports/ai-property-aggregate-store.port'
import { reviewId } from '#/shared/domain/ids'

type DailyRow = typeof aiPropertyDailyAggregates.$inferSelect

type Contribution = Readonly<{
  status: string
  rating: number
  sentiment: string | null
  primaryCategory: string | null
  attention: string | null
}>

const SENTIMENT_COLUMNS = {
  positive: 'positiveCount',
  neutral: 'neutralCount',
  negative: 'negativeCount',
  mixed: 'mixedCount',
} as const
const CATEGORY_COLUMNS = {
  service: 'serviceCount',
  staff: 'staffCount',
  quality: 'qualityCount',
  value: 'valueCount',
  cleanliness: 'cleanlinessCount',
  wait_time: 'waitTimeCount',
  atmosphere: 'atmosphereCount',
  location: 'locationCount',
  accessibility: 'accessibilityCount',
  other: 'otherCount',
} as const
const ATTENTION_COLUMNS = {
  urgent: 'urgentCount',
  high: 'highCount',
  medium: 'mediumCount',
  low: 'lowCount',
} as const

function safeSequence(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

function counterColumn<T extends Readonly<Record<string, keyof DailyRow>>>(
  mapping: T,
  value: string,
): T[keyof T] | null {
  return Object.hasOwn(mapping, value) ? mapping[value as keyof T] : null
}

const zeroDailyValues = (
  input: Readonly<{
    organizationId: string
    propertyId: string
    localDate: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
    propertyProfileVersion: number
    aggregateRevision: number
    terminalAnalysisSequence: number
    updatedAt: Date
  }>,
) => ({
  ...input,
  calendarProfileVersion: AI_PROPERTY_CALENDAR_PROFILE_V1.profileVersion,
  reviewCount: 0,
  ratingSum: 0,
  positiveCount: 0,
  neutralCount: 0,
  negativeCount: 0,
  mixedCount: 0,
  serviceCount: 0,
  staffCount: 0,
  qualityCount: 0,
  valueCount: 0,
  cleanlinessCount: 0,
  waitTimeCount: 0,
  atmosphereCount: 0,
  locationCount: 0,
  accessibilityCount: 0,
  otherCount: 0,
  urgentCount: 0,
  highCount: 0,
  mediumCount: 0,
  lowCount: 0,
})

function adjustDaily(
  row: DailyRow,
  contribution: Contribution,
  direction: 1 | -1,
): DailyRow {
  if (
    contribution.status !== 'ready' ||
    contribution.sentiment === null ||
    contribution.primaryCategory === null ||
    contribution.attention === null
  ) {
    return row
  }
  const next = { ...row }
  next.reviewCount += direction
  next.ratingSum += direction * contribution.rating
  const sentimentColumn = counterColumn(SENTIMENT_COLUMNS, contribution.sentiment)
  const categoryColumn = counterColumn(CATEGORY_COLUMNS, contribution.primaryCategory)
  const attentionColumn = counterColumn(ATTENTION_COLUMNS, contribution.attention)
  if (!sentimentColumn || !categoryColumn || !attentionColumn) {
    throw new Error('Property aggregate contribution is invalid')
  }
  next[sentimentColumn] += direction
  next[categoryColumn] += direction
  next[attentionColumn] += direction
  return next
}

function mapDaily(row: DailyRow): AiPropertyDailyAggregate {
  return {
    localDate: row.localDate,
    reviewCount: row.reviewCount,
    ratingSum: row.ratingSum,
    sentimentCounts: {
      positive: row.positiveCount,
      neutral: row.neutralCount,
      negative: row.negativeCount,
      mixed: row.mixedCount,
    },
    categoryCounts: {
      service: row.serviceCount,
      staff: row.staffCount,
      quality: row.qualityCount,
      value: row.valueCount,
      cleanliness: row.cleanlinessCount,
      wait_time: row.waitTimeCount,
      atmosphere: row.atmosphereCount,
      location: row.locationCount,
      accessibility: row.accessibilityCount,
      other: row.otherCount,
    },
    attentionCounts: {
      urgent: row.urgentCount,
      high: row.highCount,
      medium: row.mediumCount,
      low: row.lowCount,
    },
  }
}

const SENTIMENT_VALUES = new Set(['positive', 'neutral', 'negative', 'mixed'])
const CATEGORY_VALUES = new Set([
  'service',
  'staff',
  'quality',
  'value',
  'cleanliness',
  'wait_time',
  'atmosphere',
  'location',
  'accessibility',
  'other',
])
const ATTENTION_VALUES = new Set(['urgent', 'high', 'medium', 'low'])

function mapAnalyzedReview(
  row: Readonly<{
    reviewId: string
    sourceRevision: number | string
    analysisSequence: number | string
    localDate: string
    sentiment: string
    primaryCategory: string
    attention: string
    analysisProfileVersion: string
    providerDeploymentProfileVersion: string
    modelSnapshot: string
  }>,
): AiPropertyAnalyzedReview {
  const sourceRevision = safeSequence(row.sourceRevision)
  const analysisSequence = safeSequence(row.analysisSequence)
  if (
    sourceRevision === null ||
    sourceRevision < 1 ||
    analysisSequence === null ||
    analysisSequence < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) ||
    !SENTIMENT_VALUES.has(row.sentiment) ||
    !CATEGORY_VALUES.has(row.primaryCategory) ||
    !ATTENTION_VALUES.has(row.attention) ||
    row.analysisProfileVersion.length === 0 ||
    row.providerDeploymentProfileVersion.length === 0 ||
    row.modelSnapshot.length === 0
  ) {
    throw new Error('Property analyzed Review evidence is invalid')
  }
  return Object.freeze({
    reviewId: reviewId(row.reviewId),
    sourceRevision,
    analysisSequence,
    localDate: row.localDate,
    sentiment: row.sentiment as AiPropertyAnalyzedReview['sentiment'],
    primaryCategory: row.primaryCategory as AiPropertyAnalyzedReview['primaryCategory'],
    attention: row.attention as AiPropertyAnalyzedReview['attention'],
    analysisProfileVersion: row.analysisProfileVersion,
    providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
    modelSnapshot: row.modelSnapshot,
  })
}

export const createAiPropertyAggregateStoreAdapter = (
  db: Database,
): AiPropertyAggregateStorePort => {
  return {
    async applyReviewAnalysis(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.organizationId} || ':' || ${input.propertyId}::text, 0)
          )
        `)
        const [replayed] = await tx
          .select()
          .from(aiPropertyAggregateContributions)
          .where(
            and(
              eq(aiPropertyAggregateContributions.organizationId, input.organizationId),
              eq(aiPropertyAggregateContributions.propertyId, input.propertyId),
              eq(aiPropertyAggregateContributions.reviewId, input.reviewId),
              eq(aiPropertyAggregateContributions.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateContributions.sourceRevision, input.sourceRevision),
              eq(
                aiPropertyAggregateContributions.analysisSequence,
                input.analysisSequence,
              ),
            ),
          )
          .limit(1)
        if (replayed) {
          return {
            status: 'replayed',
            aggregateRevision: replayed.appliedAggregateRevision,
          }
        }

        const [analysis] = await tx
          .select({
            reviewAnalysisEpoch: aiReviewAnalyses.reviewAnalysisEpoch,
            propertyProfileVersion: aiReviewAnalyses.propertyProfileVersion,
            status: aiReviewAnalyses.status,
            sentiment: aiReviewAnalyses.sentiment,
            primaryCategory: aiReviewAnalyses.primaryCategory,
            attention: aiReviewAnalyses.attention,
            rating: sql<number>`${reviews.rating}`,
            localDate: sql<string | null>`ai_property_local_date_v1(
              ${reviews.reviewedAt}, ${aiPropertyProcessingProfiles.timezone}
            )::text`,
          })
          .from(aiReviewAnalyses)
          .innerJoin(
            reviews,
            and(
              eq(reviews.organizationId, aiReviewAnalyses.organizationId),
              eq(reviews.propertyId, aiReviewAnalyses.propertyId),
              eq(reviews.id, aiReviewAnalyses.reviewId),
              eq(reviews.sourceEpoch, input.sourceEpoch),
              eq(reviews.sourceRevision, input.sourceRevision),
              eq(reviews.analysisSequence, input.analysisSequence),
              eq(reviews.sourceContentState, 'active'),
              isNotNull(reviews.rating),
              isNotNull(reviews.reviewedAt),
            ),
          )
          .innerJoin(
            aiPropertyProcessingProfiles,
            and(
              eq(
                aiPropertyProcessingProfiles.organizationId,
                aiReviewAnalyses.organizationId,
              ),
              eq(aiPropertyProcessingProfiles.propertyId, aiReviewAnalyses.propertyId),
              eq(aiPropertyProcessingProfiles.sourceEpoch, input.sourceEpoch),
              eq(
                aiPropertyProcessingProfiles.profileVersion,
                input.propertyProfileVersion,
              ),
              eq(aiPropertyProcessingProfiles.lifecycleState, 'active'),
            ),
          )
          .where(
            and(
              eq(aiReviewAnalyses.organizationId, input.organizationId),
              eq(aiReviewAnalyses.propertyId, input.propertyId),
              eq(aiReviewAnalyses.reviewId, input.reviewId),
              eq(aiReviewAnalyses.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalyses.sourceRevision, input.sourceRevision),
              eq(aiReviewAnalyses.analysisSequence, input.analysisSequence),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !analysis ||
          analysis.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          analysis.propertyProfileVersion !== input.propertyProfileVersion
        ) {
          return { status: 'stale' }
        }
        if (analysis.localDate === null) return { status: 'unavailable' }

        await tx
          .insert(aiPropertyAggregateHeads)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            aggregateRevision: 0,
            terminalAnalysisSequence: input.analysisSequence - 1,
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
        const [head] = await tx
          .select()
          .from(aiPropertyAggregateHeads)
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .limit(1)
          .for('update')
        if (!head) return { status: 'stale' }
        const expectedAnalysisSequence = head.terminalAnalysisSequence + 1
        if (input.analysisSequence > expectedAnalysisSequence) {
          return { status: 'gap', expectedAnalysisSequence }
        }
        if (input.analysisSequence < expectedAnalysisSequence) return { status: 'stale' }

        const [previous] = await tx
          .select()
          .from(aiPropertyAggregateContributions)
          .where(
            and(
              eq(aiPropertyAggregateContributions.organizationId, input.organizationId),
              eq(aiPropertyAggregateContributions.propertyId, input.propertyId),
              eq(aiPropertyAggregateContributions.reviewId, input.reviewId),
              eq(aiPropertyAggregateContributions.sourceEpoch, input.sourceEpoch),
              eq(
                aiPropertyAggregateContributions.reviewAnalysisEpoch,
                input.reviewAnalysisEpoch,
              ),
              eq(
                aiPropertyAggregateContributions.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .orderBy(desc(aiPropertyAggregateContributions.analysisSequence))
          .limit(1)
        const aggregateRevision = head.aggregateRevision + 1
        const appliedAt = new Date()
        const [inserted] = await tx
          .insert(aiPropertyAggregateContributions)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reviewId: input.reviewId,
            sourceEpoch: input.sourceEpoch,
            sourceRevision: input.sourceRevision,
            analysisSequence: input.analysisSequence,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            calendarProfileVersion: AI_PROPERTY_CALENDAR_PROFILE_V1.profileVersion,
            localDate: analysis.localDate,
            status: analysis.status,
            rating: analysis.rating,
            sentiment: analysis.sentiment,
            primaryCategory: analysis.primaryCategory,
            attention: analysis.attention,
            appliedAggregateRevision: aggregateRevision,
            appliedAt,
          })
          .onConflictDoNothing()
          .returning({
            analysisSequence: aiPropertyAggregateContributions.analysisSequence,
          })
        if (!inserted) throw new Error('Property aggregate contribution conflict')

        const dates = Array.from(
          new Set([
            ...(previous?.status === 'ready' ? [previous.localDate] : []),
            ...(analysis.status === 'ready' ? [analysis.localDate] : []),
          ]),
        ).sort()
        if (dates.length > 0) {
          await tx
            .insert(aiPropertyDailyAggregates)
            .values(
              dates.map((localDate) =>
                zeroDailyValues({
                  organizationId: input.organizationId,
                  propertyId: input.propertyId,
                  localDate,
                  sourceEpoch: input.sourceEpoch,
                  reviewAnalysisEpoch: input.reviewAnalysisEpoch,
                  propertyProfileVersion: input.propertyProfileVersion,
                  aggregateRevision: head.aggregateRevision,
                  terminalAnalysisSequence: head.terminalAnalysisSequence,
                  updatedAt: appliedAt,
                }),
              ),
            )
            .onConflictDoNothing()
          const rows = await tx
            .select()
            .from(aiPropertyDailyAggregates)
            .where(
              and(
                eq(aiPropertyDailyAggregates.organizationId, input.organizationId),
                eq(aiPropertyDailyAggregates.propertyId, input.propertyId),
                eq(aiPropertyDailyAggregates.sourceEpoch, input.sourceEpoch),
                eq(
                  aiPropertyDailyAggregates.reviewAnalysisEpoch,
                  input.reviewAnalysisEpoch,
                ),
                eq(
                  aiPropertyDailyAggregates.propertyProfileVersion,
                  input.propertyProfileVersion,
                ),
                inArray(aiPropertyDailyAggregates.localDate, dates),
              ),
            )
            .orderBy(aiPropertyDailyAggregates.localDate)
            .for('update')
          if (rows.length !== dates.length)
            throw new Error('Property daily aggregate is missing')
          for (const row of rows) {
            let next = row
            if (previous?.localDate === row.localDate)
              next = adjustDaily(next, previous, -1)
            if (analysis.localDate === row.localDate)
              next = adjustDaily(next, analysis, 1)
            if (next.reviewCount < 0 || next.ratingSum < 0) {
              throw new Error('Property daily aggregate would become negative')
            }
            await tx
              .update(aiPropertyDailyAggregates)
              .set({
                ...next,
                aggregateRevision,
                terminalAnalysisSequence: input.analysisSequence,
                updatedAt: appliedAt,
              })
              .where(
                and(
                  eq(aiPropertyDailyAggregates.organizationId, input.organizationId),
                  eq(aiPropertyDailyAggregates.propertyId, input.propertyId),
                  eq(aiPropertyDailyAggregates.localDate, row.localDate),
                  eq(aiPropertyDailyAggregates.sourceEpoch, input.sourceEpoch),
                  eq(
                    aiPropertyDailyAggregates.reviewAnalysisEpoch,
                    input.reviewAnalysisEpoch,
                  ),
                  eq(
                    aiPropertyDailyAggregates.propertyProfileVersion,
                    input.propertyProfileVersion,
                  ),
                ),
              )
          }
        }

        const [updatedHead] = await tx
          .update(aiPropertyAggregateHeads)
          .set({
            aggregateRevision,
            terminalAnalysisSequence: input.analysisSequence,
            updatedAt: appliedAt,
          })
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              eq(aiPropertyAggregateHeads.aggregateRevision, head.aggregateRevision),
            ),
          )
          .returning({ aggregateRevision: aiPropertyAggregateHeads.aggregateRevision })
        if (updatedHead?.aggregateRevision !== aggregateRevision) {
          throw new Error('Property aggregate head update failed')
        }
        return { status: 'applied', aggregateRevision }
      })
    },

    async advanceWithoutAnalysis(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.organizationId} || ':' || ${input.propertyId}::text, 0)
          )
        `)
        await tx
          .insert(aiPropertyAggregateHeads)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            sourceEpoch: input.sourceEpoch,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            aggregateRevision: 0,
            terminalAnalysisSequence: input.analysisSequence - 1,
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
        const [head] = await tx
          .select()
          .from(aiPropertyAggregateHeads)
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .limit(1)
          .for('update')
        if (!head) return { status: 'stale' }
        if (input.analysisSequence <= head.terminalAnalysisSequence) {
          return { status: 'replayed', aggregateRevision: head.aggregateRevision }
        }
        const expectedAnalysisSequence = head.terminalAnalysisSequence + 1
        if (input.analysisSequence > expectedAnalysisSequence) {
          return { status: 'gap', expectedAnalysisSequence }
        }
        const aggregateRevision = head.aggregateRevision + 1
        const [updatedHead] = await tx
          .update(aiPropertyAggregateHeads)
          .set({
            aggregateRevision,
            terminalAnalysisSequence: input.analysisSequence,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              eq(aiPropertyAggregateHeads.aggregateRevision, head.aggregateRevision),
            ),
          )
          .returning({ aggregateRevision: aiPropertyAggregateHeads.aggregateRevision })
        if (updatedHead?.aggregateRevision !== aggregateRevision) {
          throw new Error('Property aggregate head update failed')
        }
        return { status: 'applied', aggregateRevision }
      })
    },

    async readWindow(input) {
      return db.transaction(async (tx) => {
        const [reviewHead] = await tx
          .select({ headSequence: reviewAiAnalysisHeads.headSequence })
          .from(reviewAiAnalysisHeads)
          .where(
            and(
              eq(reviewAiAnalysisHeads.organizationId, input.organizationId),
              eq(reviewAiAnalysisHeads.propertyId, input.propertyId),
              eq(reviewAiAnalysisHeads.sourceEpoch, input.sourceEpoch),
            ),
          )
          .limit(1)
          .for('share')
        const [head] = await tx
          .select()
          .from(aiPropertyAggregateHeads)
          .where(
            and(
              eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
              eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
              eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(
                aiPropertyAggregateHeads.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
            ),
          )
          .limit(1)
          .for('share')
        if (
          !reviewHead ||
          !head ||
          reviewHead.headSequence !== head.terminalAnalysisSequence
        ) {
          return null
        }
        const days = await tx
          .select()
          .from(aiPropertyDailyAggregates)
          .where(
            and(
              eq(aiPropertyDailyAggregates.organizationId, input.organizationId),
              eq(aiPropertyDailyAggregates.propertyId, input.propertyId),
              eq(aiPropertyDailyAggregates.sourceEpoch, input.sourceEpoch),
              eq(
                aiPropertyDailyAggregates.reviewAnalysisEpoch,
                input.reviewAnalysisEpoch,
              ),
              eq(
                aiPropertyDailyAggregates.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              gte(aiPropertyDailyAggregates.localDate, input.startLocalDate),
              lte(aiPropertyDailyAggregates.localDate, input.endLocalDate),
            ),
          )
          .orderBy(aiPropertyDailyAggregates.localDate)
        const analyzed = await tx.execute<{
          reviewId: string
          sourceRevision: number | string
          analysisSequence: number | string
          localDate: string
          sentiment: string
          primaryCategory: string
          attention: string
          analysisProfileVersion: string
          providerDeploymentProfileVersion: string
          modelSnapshot: string
        }>(sql`
          WITH latest AS (
            SELECT DISTINCT ON (contribution.review_id) contribution.*
            FROM ai_property_aggregate_contributions AS contribution
            WHERE contribution.organization_id = ${input.organizationId}
              AND contribution.property_id = ${input.propertyId}::uuid
              AND contribution.source_epoch = ${input.sourceEpoch}
              AND contribution.review_analysis_epoch = ${input.reviewAnalysisEpoch}
              AND contribution.property_profile_version = ${input.propertyProfileVersion}
            ORDER BY contribution.review_id, contribution.analysis_sequence DESC
          )
          SELECT
            latest.review_id::text AS "reviewId",
            latest.source_revision::float8 AS "sourceRevision",
            latest.analysis_sequence::float8 AS "analysisSequence",
            latest.local_date::text AS "localDate",
            latest.sentiment AS sentiment,
            latest.primary_category AS "primaryCategory",
            latest.attention AS attention,
            ${'review-analysis-v1'}::text AS "analysisProfileVersion",
            ${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}::text AS "providerDeploymentProfileVersion",
            ${OPENAI_MODEL_SNAPSHOT}::text AS "modelSnapshot"
          FROM latest
          INNER JOIN ai_review_analyses AS analysis
            ON analysis.organization_id = latest.organization_id
           AND analysis.property_id = latest.property_id
           AND analysis.review_id = latest.review_id
           AND analysis.source_epoch = latest.source_epoch
           AND analysis.source_revision = latest.source_revision
           AND analysis.analysis_sequence = latest.analysis_sequence
          INNER JOIN ai_operations AS operation ON operation.id = analysis.operation_id
          WHERE latest.status = 'ready'
            AND latest.local_date BETWEEN ${input.startLocalDate}::date AND ${input.endLocalDate}::date
            AND analysis.status = 'ready'
            AND operation.state IN ('succeeded_pending_delivery', 'succeeded')
          ORDER BY latest.local_date, latest.review_id
        `)
        return {
          head: {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            sourceEpoch: head.sourceEpoch,
            reviewAnalysisEpoch: head.reviewAnalysisEpoch,
            propertyProfileVersion: head.propertyProfileVersion,
            aggregateRevision: head.aggregateRevision,
            terminalAnalysisSequence: head.terminalAnalysisSequence,
          },
          days: days.map(mapDaily),
          analyzedReviews: Object.freeze(analyzed.rows.map(mapAnalyzedReview)),
        }
      })
    },
  }
}
