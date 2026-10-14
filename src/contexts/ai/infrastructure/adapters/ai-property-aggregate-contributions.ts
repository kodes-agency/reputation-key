// Daily Property aggregates and the per-review contributions behind them.
//
// A review contributes to the day its date falls on through one stored
// contribution per analysed sequence. The latest one is the review's current
// contribution: applying a newer analysis takes it off the day before adding
// the new one, and a review whose newer sequence settles WITHOUT an analysis
// (deleted at Google, text removed, content expired, the analysis abandoned)
// is withdrawn the same way, so the day never keeps a review the Property no
// longer reports on.

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionAspects,
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
  aiPropertyDailyAggregates,
  aiPropertyDailyAspectAggregates,
} from '#/shared/db/schema'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '#/shared/ai-property-calendar-profile'

export type AggregateTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type AggregateHead = typeof aiPropertyAggregateHeads.$inferSelect
export type AggregateIdentityInput = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  analysisSequence: number
}>
export type DailyRow = typeof aiPropertyDailyAggregates.$inferSelect
export type StoredContribution = typeof aiPropertyAggregateContributions.$inferSelect
export type Contribution = Readonly<{
  status: string
  rating: number
  sentiment: string | null
  primaryCategory: string | null
  attention: string | null
}>
export type ContributionAspect = Readonly<{
  aspect: string
  polarity: string
  intensity: number
}>
/** What a review adds to its day once an analysis is applied. */
export type AnalysisContribution = Readonly<{
  contribution: Contribution
  localDate: string
  aspects: readonly ContributionAspect[]
}>
type AspectDelta = Readonly<{
  localDate: string
  aspect: string
  polarity: string
  delta: number
}>
type ReviewGeneration = AggregateIdentityInput & Readonly<{ reviewId: string }>
type PreviousContribution = Readonly<{
  previous: StoredContribution | undefined
  previousAspects: readonly ContributionAspect[]
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
  next: AnalysisContribution | null
}): readonly AspectDelta[] {
  const deltas = new Map<string, AspectDelta>()
  if (input.previous?.status === 'ready') {
    addAspectDeltas(deltas, input.previous.localDate, input.previousAspects, -1)
  }
  if (input.next?.contribution.status === 'ready') {
    addAspectDeltas(deltas, input.next.localDate, input.next.aspects, 1)
  }
  return [...deltas.values()]
}

async function persistAspectDelta(
  tx: AggregateTransaction,
  input: AggregateIdentityInput,
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

export async function updateDailyAggregates(input: {
  tx: AggregateTransaction
  command: AggregateIdentityInput
  head: AggregateHead
  /** The review's new contribution, or null when it is withdrawn from the day. */
  next: AnalysisContribution | null
  previous: StoredContribution | undefined
  previousAspects: readonly ContributionAspect[]
  aggregateRevision: number
  appliedAt: Date
}): Promise<void> {
  const nextReady = input.next?.contribution.status === 'ready' ? input.next : null
  const dates = Array.from(
    new Set([
      ...(input.previous?.status === 'ready' ? [input.previous.localDate] : []),
      ...(nextReady === null ? [] : [nextReady.localDate]),
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
    if (nextReady?.localDate === row.localDate) {
      next = adjustDaily(next, nextReady.contribution, 1)
    }
    if (![next.reviewCount >= 0, next.ratingSum >= 0].every(Boolean)) {
      throw new Error('Property daily aggregate would become negative')
    }
    await input.tx
      .update(aiPropertyDailyAggregates)
      .set({
        ...next,
        aggregateRevision: input.aggregateRevision,
        terminalAnalysisSequence: Math.max(
          input.head.terminalAnalysisSequence,
          input.command.analysisSequence,
        ),
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
    next: input.next,
  })
  for (const delta of deltas) {
    await persistAspectDelta(input.tx, input.command, delta)
  }
}

/**
 * The review's current contribution to this generation (profile version) and
 * its aspects, or none. The latest sequence is current; earlier rows are
 * history that an applied successor already took off the day.
 */
export async function readPreviousContribution(
  tx: AggregateTransaction,
  input: ReviewGeneration,
): Promise<PreviousContribution> {
  const [previous] = await tx
    .select()
    .from(aiPropertyAggregateContributions)
    .where(reviewGenerationContributions(input))
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
              eq(aiPropertyAggregateContributionAspects.propertyId, previous.propertyId),
              eq(aiPropertyAggregateContributionAspects.reviewId, previous.reviewId),
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
  return { previous, previousAspects }
}

function reviewGenerationContributions(input: ReviewGeneration) {
  return and(
    eq(aiPropertyAggregateContributions.organizationId, input.organizationId),
    eq(aiPropertyAggregateContributions.propertyId, input.propertyId),
    eq(aiPropertyAggregateContributions.reviewId, input.reviewId),
    eq(aiPropertyAggregateContributions.sourceEpoch, input.sourceEpoch),
    eq(aiPropertyAggregateContributions.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
    eq(
      aiPropertyAggregateContributions.propertyProfileVersion,
      input.propertyProfileVersion,
    ),
  )
}

/**
 * Takes a review off its day, for a sequence that settles with no analysis.
 * The contributions are then deleted, not left behind: with none left, a later
 * analysis of the review has nothing to take off the day a second time, and the
 * window reads no analysis for it. Aspect rows go with them (their foreign key
 * cascades). A review that has no contribution is left alone.
 */
export async function withdrawReviewContribution(input: {
  tx: AggregateTransaction
  command: ReviewGeneration
  head: AggregateHead
  aggregateRevision: number
  appliedAt: Date
}): Promise<void> {
  const { previous, previousAspects } = await readPreviousContribution(
    input.tx,
    input.command,
  )
  if (previous === undefined) return
  await updateDailyAggregates({
    tx: input.tx,
    command: input.command,
    head: input.head,
    next: null,
    previous,
    previousAspects,
    aggregateRevision: input.aggregateRevision,
    appliedAt: input.appliedAt,
  })
  await input.tx
    .delete(aiPropertyAggregateContributions)
    .where(reviewGenerationContributions(input.command))
}
