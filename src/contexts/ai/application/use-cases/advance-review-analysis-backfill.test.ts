import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewAnalysisBackfillRun,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../ports/ai-review-analysis-backfill.port'
import type { AiPropertyAggregateStorePort } from '../ports/ai-property-aggregate-store.port'
import type { AiReviewEventStorePort } from '../ports/ai-review-event-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { createAdvanceReviewAnalysisBackfill } from './advance-review-analysis-backfill'

const ORGANIZATION_ID = organizationId('ai-backfill-membership-test')
const PROPERTY_ID = propertyId('70000000-0000-4000-8000-000000000001')
const RUN_ID = '70000000-0000-4000-8000-000000000002'
const FIRST_REVIEW_ID = reviewId('70000000-0000-4000-8000-000000000004')
const THIRD_REVIEW_ID = reviewId('70000000-0000-4000-8000-000000000005')
const NOW = new Date('2026-08-26T10:00:00.000Z')

describe('advance review-analysis backfill — durable membership', () => {
  it('resumes from the exact relational ordinal without reconstructing the pinned set', async () => {
    const run: ReviewAnalysisBackfillRun = {
      id: RUN_ID,
      sourceEpoch: 3,
      reviewAnalysisEpoch: 4,
      analysisStartSequence: 12,
      requestedReviewCount: 3,
      emittedReviewCount: 1,
      skippedReviewCount: 1,
      recoveredReviewCount: 0,
      currentAnalysisSequence: 13,
      currentReviewId: FIRST_REVIEW_ID,
      currentEmittedAtEpochMillis: NOW.getTime() - 1_000,
      correlationId: '70000000-0000-4000-8000-000000000003',
    }
    const membershipReads: Array<{ runId: string; ordinal: number }> = []
    const emitted: string[] = []
    const session: ReviewAnalysisBackfillSession = {
      readContext: async () => ({
        propertySourceEpoch: 3,
        propertyActive: true,
        enablement: {
          state: 'enabled',
          capabilities: ['review_analysis'],
          authorizedSourceEpoch: 3,
          reviewAnalysisEpoch: 4,
          analysisStartSequence: 12,
          stateVersion: 2,
          authorizationLineageId: '70000000-0000-4000-8000-000000000006',
          consentActor: null,
        },
        analysisHeadSequence: 13,
        eligibleReviewCount: 3,
        existingDailyAggregateRowCount: 0,
      }),
      listCandidates: async () => [],
      repositionWatermark: async () => {
        throw new Error('not used')
      },
      allocateAnalysisSequence: async () => 14,
      emitBackfillEvent: async ({ reviewId: id }) => {
        emitted.push(id)
      },
      readActiveRun: async () => run,
      openRun: async () => {
        throw new Error('not used')
      },
      readRunMember: async (input) => {
        membershipReads.push(input)
        return input.ordinal === 2 ? THIRD_REVIEW_ID : null
      },
      readEligibleCandidate: async (id) =>
        id === THIRD_REVIEW_ID
          ? { reviewId: id, sourceRevision: 7, storedAnalysisSequence: 4 }
          : null,
      readOutcomeState: async () => 'ready',
      advanceRun: async () => {},
      skipRunCandidate: async () => {},
      recordRunRecovery: async () => {},
      closeRun: async () => {},
    }
    const backfillStore: ReviewAnalysisBackfillStorePort = {
      runExclusive: (_input, work) => work(session),
      listRunningRuns: async () => [],
    }
    const reviewEvents: AiReviewEventStorePort = {
      consumeNext: async () => {
        throw new Error('not used')
      },
      settleOutcome: async () => {
        throw new Error('not used')
      },
    }
    const aggregates: AiPropertyAggregateStorePort = {
      applyReviewAnalysis: async () => {
        throw new Error('not used')
      },
      advanceWithoutAnalysis: async () => {
        throw new Error('not used')
      },
      readWindow: async () => {
        throw new Error('not used')
      },
    }
    const processingProfiles: PropertyProcessingProfilePort = {
      readForAi: async () => {
        throw new Error('not used')
      },
      refreshForAi: async () => {
        throw new Error('not used')
      },
    }

    const outcome = await createAdvanceReviewAnalysisBackfill({
      backfillStore,
      reviewEvents,
      aggregates,
      processingProfiles,
      nowEpochMillis: () => NOW.getTime(),
    }).advanceProperty({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID })

    expect(outcome).toBe('emitted')
    expect(membershipReads).toEqual([{ runId: RUN_ID, ordinal: 2 }])
    expect(emitted).toEqual([THIRD_REVIEW_ID])
  })
})
