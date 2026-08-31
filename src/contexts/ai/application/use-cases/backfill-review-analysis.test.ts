import { describe, it, expect } from 'vitest'
import { organizationId, propertyId, reviewId, type ReviewId } from '#/shared/domain/ids'
import type {
  PropertyAuthorityLookup,
  ReviewAnalysisBackfillCandidate,
  ReviewAnalysisBackfillContext,
  ReviewAnalysisBackfillEnablement,
  ReviewAnalysisBackfillRun,
  ReviewAnalysisBackfillSession,
  ReviewAnalysisBackfillStorePort,
} from '../ports/ai-review-analysis-backfill.port'
import {
  createBackfillReviewAnalysis,
  type BackfillReviewAnalysisInput,
  type BackfillReviewAnalysisResult,
} from './backfill-review-analysis'

const ORG = organizationId('org-hotel')
const PROPERTY = propertyId('071b20fe-2598-4f63-a2a1-b9ac2f959575')
const NOW = new Date('2026-08-22T09:00:00.000Z')
const RUN_ID = '071b20fe-2598-4f63-a2a1-b9ac2f950001'

const LINEAGE = '26a69a51-ce4b-4d28-a61c-f1f5931e52ee'
/** A real `member."userId"`, which is what the consent ledger's actor column is. */
const CONSENT_ACTOR = 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD'

/**
 * The live closed-beta shape: the head at `stateVersion` 7 is an
 * `analysis_backfill` row, and the consent it replays is the merchant decision
 * at 5. The two differ on purpose — a rule that read the head would report 7,
 * and the refusal assertions below pin 5.
 */
const ENABLED: ReviewAnalysisBackfillEnablement = {
  state: 'enabled',
  capabilities: ['review_analysis', 'reply_drafting'],
  authorizedSourceEpoch: 3,
  reviewAnalysisEpoch: 2,
  analysisStartSequence: 40,
  stateVersion: 7,
  authorizationLineageId: LINEAGE,
  consentActor: { userId: CONSENT_ACTOR, stateVersion: 5, memberRole: 'owner' },
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
  authorityLookups: number
  emitted: ReadonlyArray<
    Readonly<{ reviewId: string; analysisSequence: number; sourceRevision: number }>
  >
}>

type Harness = Readonly<{
  store: ReviewAnalysisBackfillStorePort
  propertyAuthority: PropertyAuthorityLookup
  recorded: Recorded
}>

function harness(
  overrides: Readonly<{
    context?: Partial<ReviewAnalysisBackfillContext>
    candidates?: ReadonlyArray<ReviewAnalysisBackfillCandidate>
    /** Sequences the allocator hands out, in order. Defaults to head + 1, +2, … */
    allocate?: ReadonlyArray<number>
    /** Users the identity-owned live authority decision allows. */
    grantHolders?: ReadonlyArray<string>
    /** A run already open on this property — the second-run refusal. */
    activeRun?: ReviewAnalysisBackfillRun
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
  const state = { repositions: 0, allocations: 0, authorityLookups: 0, runsOpened: 0 }
  const emitted: Array<{
    reviewId: string
    analysisSequence: number
    sourceRevision: number
  }> = []
  let openedReviewIds: ReadonlyArray<ReviewId> = []

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
    // The run is the unit under test in advance-review-analysis-backfill.test.ts;
    // here it only has to accept what the command writes.
    readActiveRun: async () => overrides.activeRun ?? null,
    openRun: async ({ orderedReviewIds }) => {
      state.runsOpened += 1
      openedReviewIds = orderedReviewIds
      return RUN_ID
    },
    readRunMember: async ({ ordinal }) => {
      const pinned = openedReviewIds[ordinal]
      return pinned ? { reviewId: pinned, sourceRevision: null } : null
    },
    readEligibleCandidate: async (reviewId) =>
      pool.find((candidate) => candidate.reviewId === reviewId) ?? null,
    readOutcomeState: async () => null,
    advanceRun: async () => {},
    skipRunCandidate: async () => {},
    recordRunRecovery: async () => {},
    closeRun: async () => {},
  }

  return {
    store: {
      runExclusive: (_input, run) => run(session),
      listRunningRuns: async () => [],
    },
    propertyAuthority: async (_organizationId, _propertyId, userId) => {
      state.authorityLookups += 1
      return (overrides.grantHolders ?? [CONSENT_ACTOR]).includes(userId)
    },
    recorded: {
      get repositions() {
        return state.repositions
      },
      get allocations() {
        return state.allocations
      },
      get authorityLookups() {
        return state.authorityLookups
      },
      emitted,
    },
  }
}

/**
 * The use case under test, wired to one harness. Both dependencies must travel
 * together — the live Identity decision settles actor authority, and a call
 * site that forgot it would silently refuse every actor.
 */
function useCase(
  h: Harness,
  store: ReviewAnalysisBackfillStorePort = h.store,
): (input: BackfillReviewAnalysisInput) => Promise<BackfillReviewAnalysisResult> {
  return createBackfillReviewAnalysis({
    backfillStore: store,
    propertyAuthority: h.propertyAuthority,
  })
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
    const backfill = useCase(h)

    const result = await backfill(input())

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    // ONE event, not six: the rest are allocated as each predecessor settles,
    // because `storeAnalysis` refuses any sequence but the allocation head.
    expect(result.firstAnalysisSequence).toBe(257)
    expect(result.pinnedReviewCount).toBe(6)
    expect(result.plan.firstAnalysisSequence).toBe(257)
    expect(result.plan.lastAnalysisSequence).toBe(262)
    const emitted = h.recorded.emitted.map((e) => e.analysisSequence)
    expect(emitted).toEqual([257])
    // No stored sequence leaked into an event: every one comes from the
    // allocator, never from `reviews.analysis_sequence`.
    expect(emitted.some((sequence) => stored.includes(sequence))).toBe(false)
  })

  it('allocates exactly once however many reviews the run pins', async () => {
    const h = harness({
      candidates: candidates([9, 9, 9]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 3 },
    })

    await useCase(h)(input())

    // One allocation, one event. Allocating all three here would move
    // `review_ai_analysis_heads.head_sequence` to 13 before the first event is
    // consumed, and `storeAnalysis` refuses any sequence but the head — so 11
    // and 12 could never be stored. That is the five-calls-one-analysis bug.
    expect(h.recorded.allocations).toBe(1)
    expect(h.recorded.emitted.map((e) => e.analysisSequence)).toEqual([11])
  })

  it('aborts when the allocator does not hand back the head successor', async () => {
    const h = harness({
      candidates: candidates([1, 2, 3]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 3 },
      // A concurrent allocation slipped in: 12, not 11.
      allocate: [12],
    })

    await expect(useCase(h)(input())).rejects.toThrow(
      /allocated 12, expected the head successor 11/,
    )
  })

  it('refuses a second run while one is still open on the property', async () => {
    const h = harness({
      candidates: candidates([1, 2]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 2 },
      activeRun: {
        id: RUN_ID,
        sourceEpoch: 3,
        reviewAnalysisEpoch: 3,
        analysisStartSequence: 10,
        requestedReviewCount: 2,
        emittedReviewCount: 1,
        skippedReviewCount: 0,
        recoveredReviewCount: 0,
        currentAnalysisSequence: 11,
        currentReviewId: null,
        currentEmittedAtEpochMillis: NOW.getTime(),
        correlationId: 'corr-1',
      },
    })

    const result = await useCase(h)(input())

    expect(result).toMatchObject({
      status: 'refused',
      refusal: 'backfill_already_running',
    })
    // Nothing written: no epoch bump, no allocation, no event.
    expect(h.recorded.repositions).toBe(0)
    expect(h.recorded.allocations).toBe(0)
    expect(h.recorded.emitted).toEqual([])
  })

  it('aborts when the repositioned watermark is not the observed head', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })
    // A replayed reposition returns the START RECORDED EARLIER, not the head
    // observed now — the retry guard that stops a second backfill on one ticket.
    const store: ReviewAnalysisBackfillStorePort = {
      listRunningRuns: h.store.listRunningRuns,
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

    await expect(useCase(h, store)(input())).rejects.toThrow(
      /watermark moved to 4, expected the observed head 10/,
    )
    expect(h.recorded.emitted).toEqual([])
  })

  it('caps the run at the limit and reports the range it would cover', async () => {
    const h = harness({
      candidates: candidates([1, 2, 3, 4, 5]),
      context: { analysisHeadSequence: 100, eligibleReviewCount: 5 },
    })

    const result = await useCase(h)(input({ limit: 2 }))

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.firstAnalysisSequence).toBe(101)
    expect(result.pinnedReviewCount).toBe(2)
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

    const result = await useCase(h)(input({ dryRun: true }))

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
      // Refusing needs the lineage and the state version in the message,
      // because that is what an operator has to look up. The bound is the
      // head's version: the search runs at or below it.
      name: 'no merchant consent decision to carry the actor forward from',
      context: { enablement: { ...ENABLED, consentActor: null } },
      refusal: 'consent_actor_absent',
      message:
        /no merchant consent-decision row \(enable, change, revoke, restore_reset\) exists for authorization lineage 26a69a51-ce4b-4d28-a61c-f1f5931e52ee at or below state_version 7/,
    },
    {
      // The live shape, verbatim: the ops operator's email in a
      // member."userId" column, so `member` yields no row at all.
      //
      // `state_version 5`, not the head's 7, is the assertion that pins the
      // selection rule: the message must name the CONSENT DECISION being
      // replayed, and 7 is an `analysis_backfill` row that decided nothing.
      name: 'the recorded actor is not a member of the organization',
      context: {
        enablement: {
          ...ENABLED,
          consentActor: {
            userId: 'denev@kodes.agency',
            stateVersion: 5,
            memberRole: null,
          },
        },
      },
      refusal: 'consent_actor_unauthorized',
      // Names the actor it tried, so the operator can act without reading SQL.
      message:
        /consent-evidence actor 'denev@kodes.agency' for authorization lineage 26a69a51-ce4b-4d28-a61c-f1f5931e52ee at state_version 5 .*legacy member\.role is absent — no current member row was observed/,
    },
    {
      // An admin's authority rests on a grant, and the harness reports none.
      name: 'the member who consented is an admin with no active property grant',
      context: {
        enablement: {
          ...ENABLED,
          consentActor: { userId: CONSENT_ACTOR, stateVersion: 5, memberRole: 'admin' },
        },
      },
      grantHolders: [],
      refusal: 'consent_actor_unauthorized',
      message:
        /consent-evidence actor 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD' for authorization lineage 26a69a51-ce4b-4d28-a61c-f1f5931e52ee at state_version 5 .*member\.role is 'admin'/,
    },
  ] as const

  for (const testCase of cases) {
    it(`refuses and writes nothing: ${testCase.name}`, async () => {
      const h = harness({
        candidates: candidates([1, 2, 3]),
        context: { eligibleReviewCount: 3, ...testCase.context },
        grantHolders: 'grantHolders' in testCase ? testCase.grantHolders : undefined,
      })

      const result = await useCase(h)(input())

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

    const result = await useCase(h)(input())

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
      listRunningRuns: h.store.listRunningRuns,
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

    await expect(useCase(h, store)(input())).rejects.toThrow(
      /recorded consent actor 'someone-else', expected the validated 'DfFoZQ7kFBrfeXHhph4DMwv3FgJPPauD'/,
    )
    expect(h.recorded.emitted).toEqual([])
  })

  it('reports the member whose consent it replayed, never an operator', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })

    const result = await useCase(h)(input())

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.consentActorUserId).toBe(CONSENT_ACTOR)
  })

  it('accepts an admin consent actor holding an active grant on the property', async () => {
    // The seam the architecture matrix insists on: identity owns the grant
    // table, so an admin's authority is decided by its lookup, not by a join
    // this context writes. Same actor as the refusing case above — only the
    // lookup's answer differs.
    const h = harness({
      candidates: candidates([1]),
      context: {
        analysisHeadSequence: 10,
        eligibleReviewCount: 1,
        enablement: {
          ...ENABLED,
          consentActor: { userId: CONSENT_ACTOR, stateVersion: 5, memberRole: 'admin' },
        },
      },
      grantHolders: [CONSENT_ACTOR],
    })

    const result = await useCase(h)(input())

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.consentActorUserId).toBe(CONSENT_ACTOR)
    expect(h.recorded.authorityLookups).toBe(1)
  })

  it('validates an owner-labelled actor through current identity authority', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })

    const result = await useCase(h)(input())

    expect(result.status).toBe('applied')
    expect(h.recorded.authorityLookups).toBe(1)
  })

  it('denies when current identity authority denies despite a legacy owner label', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: { analysisHeadSequence: 10, eligibleReviewCount: 1 },
    })

    const result = await createBackfillReviewAnalysis({
      backfillStore: h.store,
      propertyAuthority: async () => false,
    })(input())

    expect(result).toMatchObject({
      status: 'refused',
      refusal: 'consent_actor_unauthorized',
    })
    expect(h.recorded.repositions).toBe(0)
    expect(h.recorded.emitted).toEqual([])
  })

  it('allows current identity authority despite a legacy member label', async () => {
    const h = harness({
      candidates: candidates([1]),
      context: {
        analysisHeadSequence: 10,
        eligibleReviewCount: 1,
        enablement: {
          ...ENABLED,
          consentActor: { userId: CONSENT_ACTOR, stateVersion: 5, memberRole: 'member' },
        },
      },
    })

    const result = await createBackfillReviewAnalysis({
      backfillStore: h.store,
      propertyAuthority: async () => true,
    })(input())

    expect(result.status).toBe('applied')
  })
})
