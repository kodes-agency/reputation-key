import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateHeads,
} from '#/shared/db/schema'

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
export type Contribution = Readonly<{
  status: string
  rating: number
  sentiment: string | null
  primaryCategory: string | null
  attention: string | null
}>

// A later no-result settlement removes the review from every profile of this
// epoch, including a profile whose rebuild has not reached the review yet.
export async function withdrawReviewContribution(input: {
  tx: AggregateTransaction
  command: AggregateIdentityInput & Readonly<{ reviewId: string }>
  head: AggregateHead
  aggregateRevision: number
  appliedAt: Date
}): Promise<void> {
  const { tx, command } = input
  await tx
    .delete(aiPropertyAggregateContributions)
    .where(
      and(
        eq(aiPropertyAggregateContributions.organizationId, command.organizationId),
        eq(aiPropertyAggregateContributions.propertyId, command.propertyId),
        eq(aiPropertyAggregateContributions.reviewId, command.reviewId),
        eq(aiPropertyAggregateContributions.sourceEpoch, command.sourceEpoch),
        eq(
          aiPropertyAggregateContributions.reviewAnalysisEpoch,
          command.reviewAnalysisEpoch,
        ),
      ),
    )
}
