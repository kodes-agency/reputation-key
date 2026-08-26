import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyDailyAggregates,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisOutcomes,
  aiReviewEventCursors,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../../application/ports/ai-property-aggregate-store.port'

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

function parseAdvance(
  row: Readonly<Record<string, unknown>> | undefined,
): Readonly<{ aggregateRevision: number; appliedAt: Date }> | null {
  if (!row) return null
  const aggregateRevision = safeSequence(row.aggregate_revision)
  const appliedAt = new Date(String(row.applied_at))
  return aggregateRevision === null || !Number.isFinite(appliedAt.getTime())
    ? null
    : { aggregateRevision, appliedAt }
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
    calendarProfileVersion: string
    aggregateRevision: number
    terminalAnalysisSequence: number
    updatedAt: Date
  }>,
) => ({
  ...input,
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

export function createAiPropertyAggregateStoreAdapter(
  db: Database,
): AiPropertyAggregateStorePort {
  return {
    async applyReviewAnalysis(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${input.organizationId} || ':' || ${input.propertyId}::text,
              0
            )
          )
        `)
        const [cursor] = await tx
          .select({
            analysisStartSequence: aiReviewEventCursors.analysisStartSequence,
            terminalAnalysisSequence: aiReviewEventCursors.terminalAnalysisSequence,
            aggregateRevision: aiReviewEventCursors.aggregateRevision,
          })
          .from(aiReviewEventCursors)
          .where(
            and(
              eq(aiReviewEventCursors.organizationId, input.organizationId),
              eq(aiReviewEventCursors.propertyId, input.propertyId),
              eq(aiReviewEventCursors.sourceEpoch, input.sourceEpoch),
              eq(aiReviewEventCursors.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
            ),
          )
          .limit(1)
          .for('update')
        const [outcome] = await tx
          .select()
          .from(aiReviewAnalysisOutcomes)
          .where(
            and(
              eq(aiReviewAnalysisOutcomes.organizationId, input.organizationId),
              eq(aiReviewAnalysisOutcomes.propertyId, input.propertyId),
              eq(aiReviewAnalysisOutcomes.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalysisOutcomes.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(aiReviewAnalysisOutcomes.analysisSequence, input.analysisSequence),
            ),
          )
          .limit(1)
          .for('update')
        if (
          !cursor ||
          !outcome ||
          outcome.state !== 'ready' ||
          input.analysisSequence > cursor.terminalAnalysisSequence
        ) {
          return { status: 'stale' }
        }

        const [analysis] = await tx
          .select({
            operationId: aiReviewAnalyses.operationId,
            reviewAnalysisEpoch: aiReviewAnalyses.reviewAnalysisEpoch,
            propertyProfileVersion: aiReviewAnalyses.propertyProfileVersion,
            status: aiReviewAnalyses.status,
            sentiment: aiReviewAnalyses.sentiment,
            primaryCategory: aiReviewAnalyses.primaryCategory,
            attention: aiReviewAnalyses.attention,
            rating: sql<number>`${reviews.rating}`,
            localDate: sql<string | null>`resolve_ai_property_local_date_v1(
              ${reviews.reviewedAt},
              ${aiPropertyProcessingProfiles.timezone},
              ${input.calendarProfileVersion}
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
          outcome.operationId !== analysis.operationId ||
          analysis.reviewAnalysisEpoch !== input.reviewAnalysisEpoch ||
          analysis.propertyProfileVersion !== input.propertyProfileVersion
        ) {
          return { status: 'stale' }
        }
        if (analysis.localDate === null) return { status: 'unavailable' }
        const localDate = analysis.localDate

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
        if (outcome.appliedAggregateRevision !== null) {
          if (
            !replayed ||
            replayed.appliedAggregateRevision !== outcome.appliedAggregateRevision ||
            replayed.calendarProfileVersion !== input.calendarProfileVersion ||
            replayed.localDate !== localDate ||
            replayed.rating !== analysis.rating
          ) {
            throw new Error('Applied property aggregate outcome is inconsistent')
          }
          return {
            status: 'replayed',
            aggregateRevision: outcome.appliedAggregateRevision,
          }
        }
        if (replayed) throw new Error('Unapplied property aggregate contribution exists')

        if (cursor.aggregateRevision === 0) {
          await tx
            .insert(aiPropertyAggregateHeads)
            .values({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              sourceEpoch: input.sourceEpoch,
              reviewAnalysisEpoch: input.reviewAnalysisEpoch,
              propertyProfileVersion: input.propertyProfileVersion,
              aggregateRevision: 0,
              terminalAnalysisSequence: cursor.analysisStartSequence,
              updatedAt: outcome.updatedAt,
            })
            .onConflictDoNothing()
        }
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
        if (
          !head ||
          head.aggregateRevision !== cursor.aggregateRevision ||
          head.terminalAnalysisSequence > cursor.terminalAnalysisSequence
        ) {
          throw new Error('Property aggregate head is inconsistent')
        }
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

        const advanceResult = await tx.execute(sql`
          SELECT *
          FROM advance_ai_aggregate_revision_v1(
            ${input.organizationId},
            ${input.propertyId}::uuid,
            ${input.sourceEpoch},
            ${input.reviewAnalysisEpoch},
            ${input.analysisSequence},
            ${head.aggregateRevision}
          )
        `)
        const advance = parseAdvance(
          advanceResult.rows[0] as Readonly<Record<string, unknown>> | undefined,
        )
        if (!advance || advance.aggregateRevision !== head.aggregateRevision + 1) {
          throw new Error('Property aggregate revision advance failed')
        }
        const { aggregateRevision, appliedAt } = advance
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
            calendarProfileVersion: input.calendarProfileVersion,
            localDate,
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
            ...(analysis.status === 'ready' ? [localDate] : []),
          ]),
        ).sort()
        if (dates.length > 0) {
          await tx
            .insert(aiPropertyDailyAggregates)
            .values(
              dates.map((date) =>
                zeroDailyValues({
                  organizationId: input.organizationId,
                  propertyId: input.propertyId,
                  localDate: date,
                  sourceEpoch: input.sourceEpoch,
                  reviewAnalysisEpoch: input.reviewAnalysisEpoch,
                  propertyProfileVersion: input.propertyProfileVersion,
                  calendarProfileVersion: input.calendarProfileVersion,
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
          if (rows.length !== dates.length) {
            throw new Error('Property daily aggregate is missing')
          }
          for (const row of rows) {
            if (row.calendarProfileVersion !== input.calendarProfileVersion) {
              throw new Error('Property calendar authority changed within a profile')
            }
            let next = row
            if (previous?.localDate === row.localDate) {
              next = adjustDaily(next, previous, -1)
            }
            if (localDate === row.localDate) next = adjustDaily(next, analysis, 1)
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
            hashtextextended(
              ${input.organizationId} || ':' || ${input.propertyId}::text,
              0
            )
          )
        `)
        const [cursor] = await tx
          .select({
            analysisStartSequence: aiReviewEventCursors.analysisStartSequence,
            terminalAnalysisSequence: aiReviewEventCursors.terminalAnalysisSequence,
            aggregateRevision: aiReviewEventCursors.aggregateRevision,
          })
          .from(aiReviewEventCursors)
          .where(
            and(
              eq(aiReviewEventCursors.organizationId, input.organizationId),
              eq(aiReviewEventCursors.propertyId, input.propertyId),
              eq(aiReviewEventCursors.sourceEpoch, input.sourceEpoch),
              eq(aiReviewEventCursors.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
            ),
          )
          .limit(1)
          .for('update')
        const [outcome] = await tx
          .select()
          .from(aiReviewAnalysisOutcomes)
          .where(
            and(
              eq(aiReviewAnalysisOutcomes.organizationId, input.organizationId),
              eq(aiReviewAnalysisOutcomes.propertyId, input.propertyId),
              eq(aiReviewAnalysisOutcomes.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalysisOutcomes.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
              eq(aiReviewAnalysisOutcomes.analysisSequence, input.analysisSequence),
            ),
          )
          .limit(1)
          .for('update')
        if (
          !cursor ||
          !outcome ||
          outcome.state !== 'terminal_no_result' ||
          outcome.dispositionCode !== input.dispositionCode ||
          input.analysisSequence > cursor.terminalAnalysisSequence
        ) {
          return { status: 'stale' }
        }

        if (cursor.aggregateRevision === 0) {
          await tx
            .insert(aiPropertyAggregateHeads)
            .values({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              sourceEpoch: input.sourceEpoch,
              reviewAnalysisEpoch: input.reviewAnalysisEpoch,
              propertyProfileVersion: input.propertyProfileVersion,
              aggregateRevision: 0,
              terminalAnalysisSequence: cursor.analysisStartSequence,
              updatedAt: outcome.updatedAt,
            })
            .onConflictDoNothing()
        }
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
        if (outcome.appliedAggregateRevision !== null) {
          if (
            head.aggregateRevision < outcome.appliedAggregateRevision ||
            head.terminalAnalysisSequence < input.analysisSequence
          ) {
            throw new Error('Applied property aggregate outcome is inconsistent')
          }
          return {
            status: 'replayed',
            aggregateRevision: outcome.appliedAggregateRevision,
          }
        }
        if (
          head.aggregateRevision !== cursor.aggregateRevision ||
          head.terminalAnalysisSequence > cursor.terminalAnalysisSequence
        ) {
          throw new Error('Property aggregate head is inconsistent')
        }
        const expectedAnalysisSequence = head.terminalAnalysisSequence + 1
        if (input.analysisSequence > expectedAnalysisSequence) {
          return { status: 'gap', expectedAnalysisSequence }
        }
        if (input.analysisSequence < expectedAnalysisSequence) return { status: 'stale' }

        const advanceResult = await tx.execute(sql`
          SELECT *
          FROM advance_ai_aggregate_revision_v1(
            ${input.organizationId},
            ${input.propertyId}::uuid,
            ${input.sourceEpoch},
            ${input.reviewAnalysisEpoch},
            ${input.analysisSequence},
            ${head.aggregateRevision}
          )
        `)
        const advance = parseAdvance(
          advanceResult.rows[0] as Readonly<Record<string, unknown>> | undefined,
        )
        if (!advance || advance.aggregateRevision !== head.aggregateRevision + 1) {
          throw new Error('Property aggregate revision advance failed')
        }
        const [updatedHead] = await tx
          .update(aiPropertyAggregateHeads)
          .set({
            aggregateRevision: advance.aggregateRevision,
            terminalAnalysisSequence: input.analysisSequence,
            updatedAt: advance.appliedAt,
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
        if (updatedHead?.aggregateRevision !== advance.aggregateRevision) {
          throw new Error('Property aggregate head update failed')
        }
        return { status: 'applied', aggregateRevision: advance.aggregateRevision }
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
        const [cursor] = await tx
          .select({
            terminalAnalysisSequence: aiReviewEventCursors.terminalAnalysisSequence,
            aggregateRevision: aiReviewEventCursors.aggregateRevision,
            consumedSequence: aiReviewEventCursors.consumedSequence,
          })
          .from(aiReviewEventCursors)
          .where(
            and(
              eq(aiReviewEventCursors.organizationId, input.organizationId),
              eq(aiReviewEventCursors.propertyId, input.propertyId),
              eq(aiReviewEventCursors.sourceEpoch, input.sourceEpoch),
              eq(aiReviewEventCursors.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
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
          !cursor ||
          !head ||
          reviewHead.headSequence !== cursor.consumedSequence ||
          cursor.consumedSequence !== cursor.terminalAnalysisSequence ||
          head.aggregateRevision !== cursor.aggregateRevision ||
          head.terminalAnalysisSequence !== cursor.terminalAnalysisSequence
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
        }
      })
    },
  }
}
