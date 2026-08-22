import { describe, it, expect } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewAnalysisBackfillCandidate,
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillEnablement,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../ports/ai-review-analysis-backfill.port'
import {
  createBackfillReviewAnalysis,
  type BackfillReviewAnalysisInput,
} from './backfill-review-analysis'

const ORG = organizationId('org-hotel')
const PROPERTY = propertyId('071b20fe-2598-4f63-a2a1-b9ac2f959575')
const NOW = new Date('2026-08-22T09:00:00.000Z')

const LINEAGE = '26a69a51-ce4b-4d28-a61c-f1f5931e52ee'
/** A real `member."userId"`, which is what the consent ledger's actor column is. */
const CONSENT_ACTOR = 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD'

const ENABLED: ReviewAnalysisBackfillEnablement = {
  state: 'enabled',
  capabilities: ['review_analysis', 'reply_drafting'],
  authorizedSourceEpoch: 3,
  reviewAnalysisEpoch: 2,
  analysisStartSequence: 40,
  stateVersion: 7,
  authorizationLineageId: LINEAGE,
  consentActor: { userId: CONSENT_ACTOR, hasPropertyAuthority: true },
}

/** `n` candidates whose STORED sequences are whatever the caller says. */
function candidates(
  storedSequences: ReadonlyArray<number>,
): ReadonlyArray<ReviewAnalysisBackfillCandidate> {
  return storedSequences.map((storedAnalysisSequence, index) => ({
    reviewId: reviewId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    sourceRevision: index + 1,
    storedAnalysisSequence,
  }))
}

type Recorded = Readonly<{
  repositions: number
  allocations: number
  emitted: ReadonlyArray<
    Readonly<{ reviewId: string; analysisSequence: number; sourceRevision: number }>
  >
}>

type Harness = Readonly<{
  store: ReviewAnalysisBackfillStorePort
  recorded: Recorded
}>

function harness(
  overrides: Readonly<{
    context?: Partial<ReviewAnalysisBackfillContext>
    candidates?: ReadonlyArray<ReviewAnalysisBackfillCandidate>
    /** Sequences the allocator hands out, in order. Defaults to head + 1, +2, … */
    allocate?: ReadonlyArray<number>
  }> = {},
): Harness {
  const context: ReviewAnalysisBackfillContext = {
    propertySourceEpoch: 3,
    propertyActive: true,
    enablement: ENABLED,
    analysisHeadSequence: 256,
    eligibleReviewCount: overrides.candidates?.length ?? 0,
    existingDailyAggregateRowCount: 0,
    ...overrides.context,
  }
  const pool = overrides.candidates ?? []
  const state = { repositions: 0, allocations: 0 }
  const emitted: Array<{
    reviewId: string
    analysisSequence: number
    sourceRevision: number
  }> = []

  const session: ReviewAnalysisBackfillSession = {
    readContext: async () => context,
    listCandidates: async (limit) => pool.slice(0, limit),
    repositionWatermark: async () => {
      state.repositions += 1
      return {
        sourceEpoch: context.propertySourceEpoch,
        analysisStartSequence: context.analysisHeadSequence,
        reviewAnalysisEpoch: (context.enablement?.reviewAnalysisEpoch ?? 0) + 1,
        stateVersion: (context.enablement?.stateVersion ?? 0) + 1,
        // The SQL derives this from the consent it replays.
        consentActorUserId: context.enablement?.consentActor?.userId ?? '',
      }
    },
    allocateAnalysisSequence: async () => {
      const next =
        overrides.allocate?.[state.allocations] ??
        context.analysisHeadSequence + state.allocations + 1
      state.allocations += 1
      return next
    },
    emitBackfillEvent: async (input) => {
      emitted.push({
        reviewId: input.reviewId,
        analysisSequence: input.analysisSequence,
        sourceRevision: input.sourceRevision,
      })
    },
  }

  return {
    store: { runExclusive: (_input, run) => run(session) },
    recorded: {
      get repositions() {
        return state.repositions
      },
      get allocations() {
        return state.allocations
      },
      emitted,
    },
  }
}

function input(
  overrides: Partial<BackfillReviewAnalysisInput> = {},
): BackfillReviewAnalysisInput {
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    limit: 500,
    dryRun: false,
    reasonCode: 'operator_review_analysis_backfill',
    idempotencyKey: 'ops-ai-reanalyze:abc',
    requestHash: 'a'.repeat(64),
    correlationId: 'corr-1',
    occurredAt: NOW,
    ...overrides,
  }
}

describe('backfillReviewAnalysis — contiguity', () => {
  it('emits exactly H+1..H+N however non-contiguous the stored sequences are', async () => {
    // 0 is what a review that predates the allocator carries and the allocator
    // can never emit; 5 twice is a review upserted twice; 900 is far past the
    // head. None of them may reach an event.
    const stored = [0, 5, 5, 900, 256, 1]
    const h = harness({
      candidates: candidates(stored),
      context: { analysisHeadSequence: 256, eligibleReviewCount: stored.length },
    })
    const backfill = createBackfillReviewAnalysis({ backfillStore: h.store })

    const result = await backfill(input())

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.emittedAnalysisSequences).toEqual([257, 258, 259, 260, 261, 262])
    expect(result.plan.firstAnalysisSequence).toBe(257)
    expect(result.plan.lastAnalysisSequence).toBe(262)
    // The load-bearing property: no hole anywhere in the emitted run.
    const emitted = h.recorded.emitted.map((e) => e.analysisSequence)
    expect(emitted).toEqual([257, 258, 259, 260, 261, 262])
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]! - emitted[i - 1]!).toBe(1)
    }
    // And no stored sequence leaked into an event.
    expect(emitted.some((sequence) => stored.includes(sequence))).toBe(false)
  })

  it('emits one event per allocated sequence, in ascending order', async () => {
    const h = harness({
      candidates: candidates([9, 9, 9]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 3 },
    })

    await createBackfillReviewAnalysis({ backfillStore: h.store })(input())

    expect(h.recorded.allocations).toBe(3)
    expect(h.recorded.emitted).toHaveLength(3)
    expect(h.recorded.emitted.map((e) => e.analysisSequence)).toEqual([11, 12, 13])
  })

  it('aborts without emitting when the allocator would skip a sequence', async () => {
    const h = harness({
      candidates: candidates([1, 2, 3]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 3 },
      // A hole: 11, then 13.
      allocate: [11, 13, 14],
    })

    await expect(
      createBackfillReviewAnalysis({ backfillStore: h.store })(input()),
    ).rejects.toThrow(/would create a hole: allocated 13, expected 12/)
    // The first event is written inside the same transaction the throw rolls
    // back; what matters is that the out-of-order one never reached the outbox.
    expect(h.recorded.emitted.map((e) => e.analysisSequence)).toEqual([11])
  })

  it('aborts when the repositioned watermark is not the observed head', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })
    // A replayed reposition returns the START RECORDED EARLIER, not the head
    // observed now — the retry guard that stops a second backfill on one ticket.
    const store: ReviewAnalysisBackfillStorePort = {
      runExclusive: (arg, run) =>
        h.store.runExclusive(arg, (session) =>
          run({
            ...session,
            repositionWatermark: async () => ({
              sourceEpoch: 3,
              analysisStartSequence: 4,
              reviewAnalysisEpoch: 3,
              stateVersion: 8,
              consentActorUserId: CONSENT_ACTOR,
            }),
          }),
        ),
    }

    await expect(
      createBackfillReviewAnalysis({ backfillStore: store })(input()),
    ).rejects.toThrow(/watermark moved to 4, expected the observed head 10/)
    expect(h.recorded.emitted).toEqual([])
  })

  it('caps the run at the limit and reports the range it would cover', async () => {
    const h = harness({
      candidates: candidates([1, 2, 3, 4, 5]),
      context: { analysisHeadSequence: 100, eligibleReviewCount: 5 },
    })

    const result = await createBackfillReviewAnalysis({ backfillStore: h.store })(
      input({ limit: 2 }),
    )

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.emittedAnalysisSequences).toEqual([101, 102])
    expect(result.plan.capped).toBe(true)
    expect(result.plan.selectedReviewCount).toBe(2)
    expect(result.plan.eligibleReviewCount).toBe(5)
  })
})

describe('backfillReviewAnalysis — dry run', () => {
  it('writes nothing and prints the plan with the count and sequence range', async () => {
    const h = harness({
      candidates: candidates([0, 5, 900]),
      context: {
        analysisHeadSequence: 256,
        eligibleReviewCount: 3,
        existingDailyAggregateRowCount: 12,
      },
    })

    const result = await createBackfillReviewAnalysis({ backfillStore: h.store })(
      input({ dryRun: true }),
    )

    expect(result).toEqual({
      status: 'planned',
      plan: {
        sourceEpoch: 3,
        headSequence: 256,
        eligibleReviewCount: 3,
        selectedReviewCount: 3,
        capped: false,
        firstAnalysisSequence: 257,
        lastAnalysisSequence: 259,
        currentReviewAnalysisEpoch: 2,
        nextReviewAnalysisEpoch: 3,
        currentAnalysisStartSequence: 40,
        nextAnalysisStartSequence: 256,
        supersededDailyAggregateRows: 12,
      },
    })
    expect(h.recorded.repositions).toBe(0)
    expect(h.recorded.allocations).toBe(0)
    expect(h.recorded.emitted).toEqual([])
  })
})

describe('backfillReviewAnalysis — refusals', () => {
  const cases = [
    {
      name: 'no enablement at all',
      context: { enablement: null },
      refusal: 'authorization_absent',
      message: /no merchant AI authorization exists/,
    },
    {
      name: 'enablement present but revoked',
      context: { enablement: { ...ENABLED, state: 'revoked' } },
      refusal: 'authorization_not_enabled',
      message: /state is 'revoked', not 'enabled'/,
    },
    {
      name: 'review_analysis not in capabilities',
      context: { enablement: { ...ENABLED, capabilities: ['reply_drafting'] } },
      refusal: 'review_analysis_not_authorized',
      message: /\[reply_drafting\] do not include 'review_analysis'/,
    },
    {
      name: 'authorized source epoch behind the property',
      context: {
        propertySourceEpoch: 1,
        enablement: { ...ENABLED, authorizedSourceEpoch: 0 },
      },
      refusal: 'authorized_source_epoch_stale',
      // Both numbers, so the operator can act without hunting through SQL.
      message: /authorized_source_epoch 0 does not equal properties\.source_epoch 1/,
    },
    {
      name: 'property no longer active',
      context: { propertyActive: false },
      refusal: 'property_inactive',
      message: /property is not active/,
    },
    {
      // The live shape of the ops:ai-reanalyze failure: the operator's email
      // went into a column admission resolves as a member."userId", so every
      // backfilled review was denied. Refusing needs the lineage and the state
      // version in the message, because that is what an operator has to look up.
      name: 'no consent-evidence row to carry the actor forward from',
      context: { enablement: { ...ENABLED, consentActor: null } },
      refusal: 'consent_actor_absent',
      message:
        /no consent-evidence row exists for authorization lineage 26a69a51-ce4b-4d28-a61c-f1f5931e52ee at state_version 7/,
    },
    {
      name: 'the member who consented no longer has authority over the property',
      context: {
        enablement: {
          ...ENABLED,
          consentActor: { userId: CONSENT_ACTOR, hasPropertyAuthority: false },
        },
      },
      refusal: 'consent_actor_unauthorized',
      // Names the actor it tried, so the operator can act without reading SQL.
      message:
        /consent-evidence actor 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD' for authorization lineage 26a69a51-ce4b-4d28-a61c-f1f5931e52ee at state_version 7/,
    },
  ] as const

  for (const testCase of cases) {
    it(`refuses and writes nothing: ${testCase.name}`, async () => {
      const h = harness({
        candidates: candidates([1, 2, 3]),
        context: { eligibleReviewCount: 3, ...testCase.context },
      })

      const result = await createBackfillReviewAnalysis({ backfillStore: h.store })(
        input(),
      )

      expect(result.status).toBe('refused')
      if (result.status !== 'refused') return
      expect(result.refusal).toBe(testCase.refusal)
      expect(result.message).toMatch(testCase.message)
      expect(h.recorded.repositions).toBe(0)
      expect(h.recorded.allocations).toBe(0)
      expect(h.recorded.emitted).toEqual([])
    })
  }

  it('refuses when nothing is eligible rather than burning an epoch', async () => {
    const h = harness({ candidates: [], context: { eligibleReviewCount: 0 } })

    const result = await createBackfillReviewAnalysis({ backfillStore: h.store })(input())

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal).toBe('no_eligible_reviews')
    expect(h.recorded.repositions).toBe(0)
    expect(h.recorded.emitted).toEqual([])
  })

  it('aborts when the ledger recorded an actor other than the one it validated', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })
    // The SQL derives the actor independently of the context read. If the two
    // disagree the lineage head moved, so the ledger names someone whose
    // authority was never checked — roll back rather than record it.
    const store: ReviewAnalysisBackfillStorePort = {
      runExclusive: (arg, run) =>
        h.store.runExclusive(arg, (session) =>
          run({
            ...session,
            repositionWatermark: async () => ({
              sourceEpoch: 3,
              analysisStartSequence: 10,
              reviewAnalysisEpoch: 3,
              stateVersion: 8,
              consentActorUserId: 'someone-else',
            }),
          }),
        ),
    }

    await expect(
      createBackfillReviewAnalysis({ backfillStore: store })(input()),
    ).rejects.toThrow(
      /recorded consent actor 'someone-else', expected the validated 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD'/,
    )
    expect(h.recorded.emitted).toEqual([])
  })

  it('reports the member whose consent it replayed, never an operator', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })

    const result = await createBackfillReviewAnalysis({ backfillStore: h.store })(input())

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.consentActorUserId).toBe(CONSENT_ACTOR)
  })
})
