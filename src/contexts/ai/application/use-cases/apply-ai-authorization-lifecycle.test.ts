import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  AiAuthorizationLifecycleApplyResult,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'
import { createApplyAiAuthorizationLifecycle } from './apply-ai-authorization-lifecycle'
import type { ApplyAiAuthorizationLifecycleInput } from './apply-ai-authorization-lifecycle'

/**
 * Deep-frozen, fence included. The delegator hands the caller's object to the
 * store by reference, so the recorded call argument IS this object — an
 * in-place write would otherwise compare equal to itself. Freezing turns such
 * a write into a TypeError under module strict mode.
 */
const TRIGGER: ApplyAiAuthorizationLifecycleInput = Object.freeze({
  eventEnvelopeId: '41000000-0000-4000-8000-000000000201',
  organizationId: organizationId('41000000-0000-4000-8000-000000000202'),
  propertyId: propertyId('41000000-0000-4000-8000-000000000203'),
  authorizationState: 'enabled',
  fence: Object.freeze({
    authorizationLineageId: '41000000-0000-4000-8000-000000000204',
    authorizationStateVersion: 7,
    sourceEpoch: 3,
    reviewAnalysisEpoch: 5,
    analysisStartSequence: 20_004,
    replyDraftingEpoch: 2,
    propertyTrendsEpoch: 1,
  }),
  correlationId: '41000000-0000-4000-8000-000000000205',
  occurredAt: new Date('2026-08-28T07:30:00.000Z'),
})

/**
 * The trigger the store is required to receive, written out independently of
 * `TRIGGER` so the delegation assertion has a fixed reference point rather than
 * comparing the passed-by-reference object against itself.
 */
const EXPECTED: ApplyAiAuthorizationLifecycleInput = {
  eventEnvelopeId: '41000000-0000-4000-8000-000000000201',
  organizationId: organizationId('41000000-0000-4000-8000-000000000202'),
  propertyId: propertyId('41000000-0000-4000-8000-000000000203'),
  authorizationState: 'enabled',
  fence: {
    authorizationLineageId: '41000000-0000-4000-8000-000000000204',
    authorizationStateVersion: 7,
    sourceEpoch: 3,
    reviewAnalysisEpoch: 5,
    analysisStartSequence: 20_004,
    replyDraftingEpoch: 2,
    propertyTrendsEpoch: 1,
  },
  correlationId: '41000000-0000-4000-8000-000000000205',
  occurredAt: new Date('2026-08-28T07:30:00.000Z'),
}

const APPLIED: AiAuthorizationLifecycleApplyResult = {
  status: 'applied',
  lifecycle: {
    id: '41000000-0000-4000-8000-000000000206',
    eventEnvelopeId: TRIGGER.eventEnvelopeId,
    organizationId: TRIGGER.organizationId,
    propertyId: TRIGGER.propertyId,
    authorizationState: 'enabled',
    transitionKind: 'enable',
    fence: TRIGGER.fence,
    authorizedCapabilities: ['review_analysis'],
    visibleDataClasses: ['review_analysis'],
    retiredDataClasses: [],
    erasureStatus: 'not_required',
    erasureDeadlineEpochMillis: null,
    appliedAtEpochMillis: Date.parse('2026-08-28T07:30:01.000Z'),
  },
  enrollment: {
    status: 'queued',
    enrollmentId: '41000000-0000-4000-8000-000000000207',
  },
}

function createHarness(outcome: AiAuthorizationLifecycleApplyResult | Error) {
  /**
   * Snapshots taken at call time. `mock.calls` retains live references, so
   * anything the delegator rewrites in place would still be inspected here
   * post-mutation; a clone freezes what the store actually received.
   */
  const received: ApplyAiAuthorizationLifecycleInput[] = []
  const applyAuthorizationLifecycle = vi.fn(
    async (input: ApplyAiAuthorizationLifecycleInput) => {
      received.push(structuredClone(input))
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  )
  const applyAiAuthorizationLifecycle = createApplyAiAuthorizationLifecycle({
    enrollments: {
      applyAuthorizationLifecycle,
    } as unknown as ReviewAnalysisEnrollmentStorePort,
  })
  return { applyAiAuthorizationLifecycle, applyAuthorizationLifecycle, received }
}

describe('apply AI authorization lifecycle', () => {
  /**
   * The store is the transaction authority and the only fence comparator, so
   * the delivered trigger must reach it verbatim and alone. The comparison is
   * against `EXPECTED`, an independent literal — not against `TRIGGER` itself,
   * which the delegator passes by reference and could therefore be found equal
   * to a mutated copy of itself. A dropped or rewritten fence field would
   * silently widen the generation the store is asked to match.
   */
  it('hands the complete Identity trigger to the store unchanged', async () => {
    const harness = createHarness(APPLIED)

    await expect(harness.applyAiAuthorizationLifecycle(TRIGGER)).resolves.toEqual(APPLIED)
    expect(harness.applyAuthorizationLifecycle).toHaveBeenCalledOnce()
    // Exactly one argument: the store must not be handed side-channel context.
    expect(harness.applyAuthorizationLifecycle.mock.calls[0]).toHaveLength(1)
    expect(harness.received).toEqual([EXPECTED])
  })

  it('returns the applied lifecycle and enrollment evidence the store wrote', async () => {
    const harness = createHarness(APPLIED)

    const result = await harness.applyAiAuthorizationLifecycle(TRIGGER)

    expect(result).toStrictEqual(APPLIED)
  })

  /**
   * A replayed envelope and a stale generation are different facts: `duplicate`
   * means the transition already committed, `obsolete` means it must never
   * commit. Neither may be flattened into the other or into `applied`.
   */
  it.each([
    [
      'a replayed envelope',
      {
        status: 'duplicate',
        lifecycleId: '41000000-0000-4000-8000-000000000208',
        enrollmentId: '41000000-0000-4000-8000-000000000209',
      } satisfies AiAuthorizationLifecycleApplyResult,
    ],
    [
      'a superseded reply-drafting epoch',
      {
        status: 'obsolete',
        reason: 'reply_drafting_epoch_changed',
      } satisfies AiAuthorizationLifecycleApplyResult,
    ],
    [
      'an inactive property',
      {
        status: 'obsolete',
        reason: 'property_inactive',
      } satisfies AiAuthorizationLifecycleApplyResult,
    ],
  ])('preserves the tagged refusal for %s', async (_label, outcome) => {
    const harness = createHarness(outcome)

    await expect(harness.applyAiAuthorizationLifecycle(TRIGGER)).resolves.toStrictEqual(
      outcome,
    )
  })

  /**
   * The whole transition commits in one store transaction. Swallowing a
   * rollback into a benign tagged result would report visibility and erasure
   * evidence that was never written.
   */
  it('propagates a failed transaction instead of reporting a benign outcome', async () => {
    const harness = createHarness(new Error('lifecycle transaction rolled back'))

    await expect(harness.applyAiAuthorizationLifecycle(TRIGGER)).rejects.toThrow(
      'lifecycle transaction rolled back',
    )
    expect(harness.applyAuthorizationLifecycle).toHaveBeenCalledOnce()
  })
})
