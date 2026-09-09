import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionAspects,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyDailyAspectAggregates,
  aiPropertyDailyAggregates,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisAspects,
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
  AiPropertyDailyAspectCount,
} from '../../application/ports/ai-property-aggregate-store.port'
import { reviewId } from '#/shared/domain/ids'
import { isAspectTaxonomyV1Id, type AspectPolarityV1 } from '#/shared/aspect-taxonomy'
import { isAiIssueLabel } from '#/shared/ai-issue-label'

type DailyRow = typeof aiPropertyDailyAggregates.$inferSelect

type Contribution = Readonly<{
  status: string
  rating: number
  sentiment: string | null
  primaryCategory: string | null
  attention: string | null
}>
type ContributionAspect = Readonly<{
  aspect: string
  polarity: string
  intensity: number
}>

const SENTIMENT_COLUMNS = {
  positive: 'positiveCount',
  neutral: 'neutralCount',
  negative: 'negativeCount',
  mixed: 'mixedCount',
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
    contribution.attention === null
  ) {
    return row
  }
  const next = { ...row }
  next.reviewCount += direction
  next.ratingSum += direction * contribution.rating
  const sentimentColumn = counterColumn(SENTIMENT_COLUMNS, contribution.sentiment)
  const attentionColumn = counterColumn(ATTENTION_COLUMNS, contribution.attention)
  if (!sentimentColumn || !attentionColumn) {
    throw new Error('Property aggregate contribution is invalid')
  }
  next[sentimentColumn] += direction
  next[attentionColumn] += direction
  return next
}

function mapDaily(
  row: DailyRow,
  aspectCounts: readonly AiPropertyDailyAspectCount[],
): AiPropertyDailyAggregate {
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
    aspectCounts,
    attentionCounts: {
      urgent: row.urgentCount,
      high: row.highCount,
      medium: row.mediumCount,
      low: row.lowCount,
    },
  }
}

const SENTIMENT_VALUES: Readonly<Record<AiPropertyAnalyzedReview['sentiment'], true>> =
  Object.freeze({
    positive: true,
    neutral: true,
    negative: true,
    mixed: true,
  })
const ATTENTION_VALUES: Readonly<Record<AiPropertyAnalyzedReview['attention'], true>> =
  Object.freeze({
    urgent: true,
    high: true,
    medium: true,
    low: true,
  })

function isAnalyzedReviewAspect(
  value: unknown,
): value is AiPropertyAnalyzedReview['aspects'][number] {
  if (typeof value !== 'object' || value === null) return false
  const aspect = Reflect.get(value, 'aspect')
  const polarity = Reflect.get(value, 'polarity')
  const intensity = Reflect.get(value, 'intensity')
  if (
    typeof aspect !== 'string' ||
    !isAspectTaxonomyV1Id(aspect) ||
    (polarity !== 'positive' && polarity !== 'neutral' && polarity !== 'negative') ||
    typeof intensity !== 'number' ||
    !Number.isInteger(intensity)
  ) {
    return false
  }
  return (
    (polarity === 'positive' && intensity >= 20 && intensity <= 100) ||
    (polarity === 'neutral' && intensity >= -19 && intensity <= 19) ||
    (polarity === 'negative' && intensity >= -100 && intensity <= -20)
  )
}

function mapAnalyzedReview(
  row: Readonly<{
    reviewId: string
    sourceRevision: number | string
    analysisSequence: number | string
    localDate: string
    rating: number
    sentiment: string
    attention: string
    aspects: unknown
    issueLabel: string | null
    analysisProfileVersion: string
    providerDeploymentProfileVersion: string
    modelSnapshot: string
  }>,
): AiPropertyAnalyzedReview {
  const aspects =
    Array.isArray(row.aspects) &&
    row.aspects.length >= 1 &&
    row.aspects.length <= 5 &&
    row.aspects.every(isAnalyzedReviewAspect)
      ? row.aspects
      : null
  const sourceRevision = safeSequence(row.sourceRevision)
  const analysisSequence = safeSequence(row.analysisSequence)
  if (
    sourceRevision === null ||
    sourceRevision < 1 ||
    analysisSequence === null ||
    analysisSequence < 1 ||
    aspects === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.localDate) ||
    !Number.isInteger(row.rating) ||
    row.rating < 1 ||
    row.rating > 5 ||
    !Object.hasOwn(SENTIMENT_VALUES, row.sentiment) ||
    !Object.hasOwn(ATTENTION_VALUES, row.attention) ||
    (row.issueLabel !== null && !isAiIssueLabel(row.issueLabel)) ||
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
    rating: row.rating,
    sentiment: row.sentiment as AiPropertyAnalyzedReview['sentiment'],
    attention: row.attention as AiPropertyAnalyzedReview['attention'],
    aspects: Object.freeze(aspects.map((aspect) => Object.freeze({ ...aspect }))),
    issueLabel: row.issueLabel,
    analysisProfileVersion: row.analysisProfileVersion,
    providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
    modelSnapshot: row.modelSnapshot,
  })
}

type AggregateTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ApplyReviewAnalysisInput = Parameters<
  AiPropertyAggregateStorePort['applyReviewAnalysis']
>[0]
type AggregateHead = typeof aiPropertyAggregateHeads.$inferSelect
type StoredContribution = typeof aiPropertyAggregateContributions.$inferSelect
type AspectDelta = Readonly<{
  localDate: string
  aspect: string
  polarity: string
  delta: number
}>

function addAspectDeltas(
  deltas: Map<string, AspectDelta>,
  localDate: string,
  aspects: readonly ContributionAspect[],
  direction: 1 | -1,
): void {
  for (const aspect of aspects) {
    const key = `${localDate}\u0000${aspect.aspect}\u0000${aspect.polarity}`
    const current = deltas.get(key)
    deltas.set(key, {
      localDate,
      aspect: aspect.aspect,
      polarity: aspect.polarity,
      delta: (current?.delta ?? 0) + direction,
    })
  }
}

function collectAspectDeltas(input: {
  previous: StoredContribution | undefined
  previousAspects: readonly ContributionAspect[]
  analysis: Contribution
  analysisLocalDate: string
  analysisAspects: readonly ContributionAspect[]
}): readonly AspectDelta[] {
  const deltas = new Map<string, AspectDelta>()
  if (input.previous?.status === 'ready') {
    addAspectDeltas(deltas, input.previous.localDate, input.previousAspects, -1)
  }
  if (input.analysis.status === 'ready') {
    addAspectDeltas(deltas, input.analysisLocalDate, input.analysisAspects, 1)
  }
  return [...deltas.values()]
}

async function persistAspectDelta(
  tx: AggregateTransaction,
  input: ApplyReviewAnalysisInput,
  delta: AspectDelta,
): Promise<void> {
  if (delta.delta === 0) return
  const rowKey = and(
    eq(aiPropertyDailyAspectAggregates.organizationId, input.organizationId),
    eq(aiPropertyDailyAspectAggregates.propertyId, input.propertyId),
    eq(aiPropertyDailyAspectAggregates.localDate, delta.localDate),
    eq(aiPropertyDailyAspectAggregates.sourceEpoch, input.sourceEpoch),
    eq(aiPropertyDailyAspectAggregates.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
    eq(
      aiPropertyDailyAspectAggregates.propertyProfileVersion,
      input.propertyProfileVersion,
    ),
    eq(aiPropertyDailyAspectAggregates.aspect, delta.aspect),
    eq(aiPropertyDailyAspectAggregates.polarity, delta.polarity),
  )
  if (delta.delta > 0) {
    await tx
      .insert(aiPropertyDailyAspectAggregates)
      .values({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        localDate: delta.localDate,
        sourceEpoch: input.sourceEpoch,
        reviewAnalysisEpoch: input.reviewAnalysisEpoch,
        propertyProfileVersion: input.propertyProfileVersion,
        aspect: delta.aspect,
        polarity: delta.polarity,
        mentionCount: delta.delta,
      })
      .onConflictDoUpdate({
        target: [
          aiPropertyDailyAspectAggregates.organizationId,
          aiPropertyDailyAspectAggregates.propertyId,
          aiPropertyDailyAspectAggregates.localDate,
          aiPropertyDailyAspectAggregates.sourceEpoch,
          aiPropertyDailyAspectAggregates.reviewAnalysisEpoch,
          aiPropertyDailyAspectAggregates.propertyProfileVersion,
          aiPropertyDailyAspectAggregates.aspect,
          aiPropertyDailyAspectAggregates.polarity,
        ],
        set: {
          mentionCount: sql`${aiPropertyDailyAspectAggregates.mentionCount} + ${delta.delta}`,
        },
      })
    return
  }
  const [updatedAspect] = await tx
    .update(aiPropertyDailyAspectAggregates)
    .set({
      mentionCount: sql`${aiPropertyDailyAspectAggregates.mentionCount} + ${delta.delta}`,
    })
    .where(rowKey)
    .returning({ mentionCount: aiPropertyDailyAspectAggregates.mentionCount })
  if (!updatedAspect || !(updatedAspect.mentionCount >= 0)) {
    throw new Error('Property daily aspect aggregate would become negative')
  }
  if (updatedAspect.mentionCount === 0) {
    await tx.delete(aiPropertyDailyAspectAggregates).where(rowKey)
  }
}

async function updateDailyAggregates(input: {
  tx: AggregateTransaction
  command: ApplyReviewAnalysisInput
  head: AggregateHead
  analysis: Contribution
  analysisLocalDate: string
  analysisAspects: readonly ContributionAspect[]
  previous: StoredContribution | undefined
  previousAspects: readonly ContributionAspect[]
  aggregateRevision: number
  appliedAt: Date
}): Promise<void> {
  const dates = Array.from(
    new Set([
      ...(input.previous?.status === 'ready' ? [input.previous.localDate] : []),
      ...(input.analysis.status === 'ready' ? [input.analysisLocalDate] : []),
    ]),
  ).sort()
  if (dates.length === 0) return

  await input.tx
    .insert(aiPropertyDailyAggregates)
    .values(
      dates.map((localDate) =>
        zeroDailyValues({
          organizationId: input.command.organizationId,
          propertyId: input.command.propertyId,
          localDate,
          sourceEpoch: input.command.sourceEpoch,
          reviewAnalysisEpoch: input.command.reviewAnalysisEpoch,
          propertyProfileVersion: input.command.propertyProfileVersion,
          aggregateRevision: input.head.aggregateRevision,
          terminalAnalysisSequence: input.head.terminalAnalysisSequence,
          updatedAt: input.appliedAt,
        }),
      ),
    )
    .onConflictDoNothing()
  const rows = await input.tx
    .select()
    .from(aiPropertyDailyAggregates)
    .where(
      and(
        eq(aiPropertyDailyAggregates.organizationId, input.command.organizationId),
        eq(aiPropertyDailyAggregates.propertyId, input.command.propertyId),
        eq(aiPropertyDailyAggregates.sourceEpoch, input.command.sourceEpoch),
        eq(
          aiPropertyDailyAggregates.reviewAnalysisEpoch,
          input.command.reviewAnalysisEpoch,
        ),
        eq(
          aiPropertyDailyAggregates.propertyProfileVersion,
          input.command.propertyProfileVersion,
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
    let next = row
    if (input.previous?.localDate === row.localDate) {
      next = adjustDaily(next, input.previous, -1)
    }
    if (input.analysisLocalDate === row.localDate) {
      next = adjustDaily(next, input.analysis, 1)
    }
    if (![next.reviewCount >= 0, next.ratingSum >= 0].every(Boolean)) {
      throw new Error('Property daily aggregate would become negative')
    }
    await input.tx
      .update(aiPropertyDailyAggregates)
      .set({
        ...next,
        aggregateRevision: input.aggregateRevision,
        terminalAnalysisSequence: input.command.analysisSequence,
        updatedAt: input.appliedAt,
      })
      .where(
        and(
          eq(aiPropertyDailyAggregates.organizationId, input.command.organizationId),
          eq(aiPropertyDailyAggregates.propertyId, input.command.propertyId),
          eq(aiPropertyDailyAggregates.localDate, row.localDate),
          eq(aiPropertyDailyAggregates.sourceEpoch, input.command.sourceEpoch),
          eq(
            aiPropertyDailyAggregates.reviewAnalysisEpoch,
            input.command.reviewAnalysisEpoch,
          ),
          eq(
            aiPropertyDailyAggregates.propertyProfileVersion,
            input.command.propertyProfileVersion,
          ),
        ),
      )
  }

  const deltas = collectAspectDeltas({
    previous: input.previous,
    previousAspects: input.previousAspects,
    analysis: input.analysis,
    analysisLocalDate: input.analysisLocalDate,
    analysisAspects: input.analysisAspects,
  })
  for (const delta of deltas) {
    await persistAspectDelta(input.tx, input.command, delta)
  }
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
            analysisProfileVersion: aiReviewAnalyses.analysisProfileVersion,
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
        if (!analysis) return { status: 'stale' }
        if (
          ![
            analysis.reviewAnalysisEpoch === input.reviewAnalysisEpoch,
            analysis.propertyProfileVersion === input.propertyProfileVersion,
          ].every(Boolean)
        ) {
          return { status: 'stale' }
        }
        if (analysis.localDate === null) return { status: 'unavailable' }
        const analysisAspects: readonly ContributionAspect[] =
          analysis.status === 'ready'
            ? await tx
                .select({
                  aspect: aiReviewAnalysisAspects.aspect,
                  polarity: aiReviewAnalysisAspects.polarity,
                  intensity: aiReviewAnalysisAspects.intensity,
                })
                .from(aiReviewAnalysisAspects)
                .where(
                  and(
                    eq(aiReviewAnalysisAspects.organizationId, input.organizationId),
                    eq(aiReviewAnalysisAspects.propertyId, input.propertyId),
                    eq(aiReviewAnalysisAspects.reviewId, input.reviewId),
                    eq(aiReviewAnalysisAspects.sourceEpoch, input.sourceEpoch),
                    eq(aiReviewAnalysisAspects.sourceRevision, input.sourceRevision),
                    eq(aiReviewAnalysisAspects.analysisSequence, input.analysisSequence),
                  ),
                )
                .orderBy(aiReviewAnalysisAspects.aspect)
                .for('share')
            : []
        const validAnalysisAspectCount =
          analysis.status === 'ready'
            ? analysisAspects.length >= 1 && analysisAspects.length <= 5
            : analysisAspects.length === 0
        if (!validAnalysisAspectCount) {
          throw new Error('Property analysis aspect rows are invalid')
        }

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
        const previousAspects: readonly ContributionAspect[] =
          previous?.status === 'ready'
            ? await tx
                .select({
                  aspect: aiPropertyAggregateContributionAspects.aspect,
                  polarity: aiPropertyAggregateContributionAspects.polarity,
                  intensity: aiPropertyAggregateContributionAspects.intensity,
                })
                .from(aiPropertyAggregateContributionAspects)
                .where(
                  and(
                    eq(
                      aiPropertyAggregateContributionAspects.organizationId,
                      previous.organizationId,
                    ),
                    eq(
                      aiPropertyAggregateContributionAspects.propertyId,
                      previous.propertyId,
                    ),
                    eq(
                      aiPropertyAggregateContributionAspects.reviewId,
                      previous.reviewId,
                    ),
                    eq(
                      aiPropertyAggregateContributionAspects.sourceEpoch,
                      previous.sourceEpoch,
                    ),
                    eq(
                      aiPropertyAggregateContributionAspects.sourceRevision,
                      previous.sourceRevision,
                    ),
                    eq(
                      aiPropertyAggregateContributionAspects.analysisSequence,
                      previous.analysisSequence,
                    ),
                  ),
                )
                .orderBy(aiPropertyAggregateContributionAspects.aspect)
                .for('share')
            : []
        const validPreviousAspectCount =
          previous?.status !== 'ready' ||
          (previousAspects.length >= 1 && previousAspects.length <= 5)
        if (!validPreviousAspectCount) {
          throw new Error('Previous aggregate contribution aspects are invalid')
        }

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
        if (analysisAspects.length > 0) {
          await tx.insert(aiPropertyAggregateContributionAspects).values(
            analysisAspects.map((aspect) => ({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              reviewId: input.reviewId,
              sourceEpoch: input.sourceEpoch,
              sourceRevision: input.sourceRevision,
              analysisSequence: input.analysisSequence,
              aspect: aspect.aspect,
              polarity: aspect.polarity,
              intensity: aspect.intensity,
            })),
          )
        }

        await updateDailyAggregates({
          tx,
          command: input,
          head,
          analysis,
          analysisLocalDate: analysis.localDate,
          analysisAspects,
          previous,
          previousAspects,
          aggregateRevision,
          appliedAt,
        })

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
        const dailyAspects = await tx
          .select({
            localDate: aiPropertyDailyAspectAggregates.localDate,
            aspect: aiPropertyDailyAspectAggregates.aspect,
            polarity: aiPropertyDailyAspectAggregates.polarity,
            mentionCount: aiPropertyDailyAspectAggregates.mentionCount,
          })
          .from(aiPropertyDailyAspectAggregates)
          .where(
            and(
              eq(aiPropertyDailyAspectAggregates.organizationId, input.organizationId),
              eq(aiPropertyDailyAspectAggregates.propertyId, input.propertyId),
              eq(aiPropertyDailyAspectAggregates.sourceEpoch, input.sourceEpoch),
              eq(
                aiPropertyDailyAspectAggregates.reviewAnalysisEpoch,
                input.reviewAnalysisEpoch,
              ),
              eq(
                aiPropertyDailyAspectAggregates.propertyProfileVersion,
                input.propertyProfileVersion,
              ),
              gte(aiPropertyDailyAspectAggregates.localDate, input.startLocalDate),
              lte(aiPropertyDailyAspectAggregates.localDate, input.endLocalDate),
            ),
          )
          .orderBy(
            aiPropertyDailyAspectAggregates.localDate,
            aiPropertyDailyAspectAggregates.aspect,
            aiPropertyDailyAspectAggregates.polarity,
          )
        const aspectCountsByDate = new Map<string, AiPropertyDailyAspectCount[]>()
        for (const row of dailyAspects) {
          if (
            !isAspectTaxonomyV1Id(row.aspect) ||
            (row.polarity !== 'positive' &&
              row.polarity !== 'neutral' &&
              row.polarity !== 'negative') ||
            !Number.isSafeInteger(row.mentionCount) ||
            row.mentionCount < 0
          ) {
            throw new Error('Property daily aspect aggregate is invalid')
          }
          const counts = aspectCountsByDate.get(row.localDate) ?? []
          counts.push({
            aspect: row.aspect,
            polarity: row.polarity as AspectPolarityV1,
            count: row.mentionCount,
          })
          aspectCountsByDate.set(row.localDate, counts)
        }
        const analyzed = await tx.execute<{
          reviewId: string
          sourceRevision: number | string
          analysisSequence: number | string
          localDate: string
          rating: number
          sentiment: string
          attention: string
          aspects: unknown
          issueLabel: string | null
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
            latest.rating AS rating,
            latest.sentiment AS sentiment,
            latest.attention AS attention,
            analysis.issue_label AS "issueLabel",
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'aspect', contribution_aspect.aspect,
                  'polarity', contribution_aspect.polarity,
                  'intensity', contribution_aspect.intensity
                )
                ORDER BY contribution_aspect.aspect
              )
              FROM ai_property_aggregate_contribution_aspects AS contribution_aspect
              WHERE contribution_aspect.organization_id = latest.organization_id
                AND contribution_aspect.property_id = latest.property_id
                AND contribution_aspect.review_id = latest.review_id
                AND contribution_aspect.source_epoch = latest.source_epoch
                AND contribution_aspect.source_revision = latest.source_revision
                AND contribution_aspect.analysis_sequence = latest.analysis_sequence
            ), '[]'::jsonb) AS aspects,
            analysis.analysis_profile_version AS "analysisProfileVersion",
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
          days: days.map((day) =>
            mapDaily(day, Object.freeze(aspectCountsByDate.get(day.localDate) ?? [])),
          ),
          analyzedReviews: Object.freeze(analyzed.rows.map(mapAnalyzedReview)),
        }
      })
    },
  }
}
