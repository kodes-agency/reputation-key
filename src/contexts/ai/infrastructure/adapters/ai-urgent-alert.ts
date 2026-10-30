// The Urgent alert's fact: written in the transaction that stores the Urgent analysis.
//
// A review analysis v3 that finds a review Urgent (a reported risk to safety or health,
// discrimination or a legal threat) raises one identifier-only fact, and Feed turns it
// into the one notice an AI finding may start (AI invariant 5; ADR 0031 and ADR 0046,
// amended 2026-10-30). The fact names the review revision and the analysis that found it
// and says nothing of why: the reason is stored beside the analysis and read in the app.
//
// ONE ALERT PER REVIEW REVISION. A review can be analysed again at the same revision (a
// new epoch after a re-consent, a reopened analysis, a replay of history), and each of
// those would find it Urgent again. Two things make that one alert and not several:
//
//  1. The fact's id is derived from the revision (organization, Property, review, source
//     epoch, source revision) and an existing fact is not written again, so the outbox
//     itself refuses a second one.
//  2. An earlier ready analysis of the same revision that was already Urgent means the
//     alert has been raised, even when its fact has since left the outbox (the retention
//     sweep deletes a published fact 30 days after publication); that is read here from
//     the analyses themselves, which live for 24 months.
//
// A new revision of the review is a new alert: the guest wrote something else.
import { createHash } from 'node:crypto'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiReviewAnalyses } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { insertOutboxRowIfNew } from '#/shared/outbox/commit'
import { aiReviewUrgentDetected } from '../../domain/events'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** The analysis that found the review Urgent, as the store has just written it. */
export type UrgentAnalysisFacts = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  /** When the provider's answer was completed: the instant the fact is recorded at. */
  occurredAt: Date
  /** The operation the analysis came from, so the alert is traceable to it. */
  operationId: string
}>

/**
 * A UUID derived from the review revision, so the same revision always has the same
 * fact id. Shaped as a version-5 UUID (RFC 9562) over SHA-256, the way a name-based id
 * is, with its own namespace so no other derived id can collide with it.
 */
export function urgentAlertEventId(
  revision: Pick<
    UrgentAnalysisFacts,
    'organizationId' | 'propertyId' | 'reviewId' | 'sourceEpoch' | 'sourceRevision'
  >,
): string {
  const hex = createHash('sha256')
    .update(
      [
        'repkey:ai.review_analysis.urgent_detected:v1',
        revision.organizationId,
        revision.propertyId,
        revision.reviewId,
        revision.sourceEpoch,
        revision.sourceRevision,
      ].join('\u0000'),
    )
    .digest('hex')
  // Version 5 in the third group; the variant bits (10xx) on the fourth.
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

/** Whether another ready analysis of this very revision was already Urgent. */
async function revisionAlreadyUrgent(
  tx: Transaction,
  facts: UrgentAnalysisFacts,
): Promise<boolean> {
  const earlier = await tx
    .select({ analysisSequence: aiReviewAnalyses.analysisSequence })
    .from(aiReviewAnalyses)
    .where(
      and(
        eq(aiReviewAnalyses.organizationId, facts.organizationId),
        eq(aiReviewAnalyses.propertyId, facts.propertyId),
        eq(aiReviewAnalyses.reviewId, facts.reviewId),
        eq(aiReviewAnalyses.sourceEpoch, facts.sourceEpoch),
        eq(aiReviewAnalyses.sourceRevision, facts.sourceRevision),
        ne(aiReviewAnalyses.analysisSequence, facts.analysisSequence),
        eq(aiReviewAnalyses.status, 'ready'),
        isNotNull(aiReviewAnalyses.urgentReason),
      ),
    )
    .limit(1)
  return earlier.length > 0
}

/**
 * Records that this analysis found the review Urgent, once for its revision. Returns
 * whether it recorded a new alert; false is "already raised", never an error.
 */
export async function raiseUrgentAlert(
  tx: Transaction,
  facts: UrgentAnalysisFacts,
): Promise<boolean> {
  if (await revisionAlreadyUrgent(tx, facts)) return false
  return insertOutboxRowIfNew(
    tx,
    aiReviewUrgentDetected({
      eventId: urgentAlertEventId(facts),
      organizationId: organizationId(facts.organizationId),
      propertyId: propertyId(facts.propertyId),
      reviewId: reviewId(facts.reviewId),
      sourceEpoch: facts.sourceEpoch,
      sourceRevision: facts.sourceRevision,
      analysisSequence: facts.analysisSequence,
      occurredAt: facts.occurredAt,
      correlationId: facts.operationId,
    }),
    { recordedAt: facts.occurredAt },
  )
}
