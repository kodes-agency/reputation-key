import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'

const NOW = new Date('2026-08-20T12:00:00.000Z')

const expectation = {
  organizationId: 'org-reply-observation-capacity',
  propertyId: 'c2000000-0000-0000-0000-000000000001',
  reviewId: 'c2000000-0000-0000-0000-000000000010',
  observationRevision: 1,
  sourceEpoch: 0,
  materialReviewRevision: 1,
  change: 'added',
  resolution: 'external_current_live',
  provenance: 'external_or_unknown',
  matchedReplyId: null,
  matchedPublicationCycle: null,
  occurredAt: NOW,
} as const

describe('Review reply-observation exact-current admission', () => {
  it('bounds nested Review-to-Inbox applies below the shared pool capacity', async () => {
    vi.resetModules()
    const firstModule = await import('./reply-observation-authority')
    vi.resetModules()
    const secondModule = await import('./reply-observation-authority')
    const maxConcurrent = firstModule.REPLY_OBSERVATION_MAX_CONCURRENT_APPLIES
    expect(maxConcurrent).toBe(4)
    let activeTransactions = 0
    let peakTransactions = 0
    let releaseCallbacks!: () => void
    const callbackBarrier = new Promise<void>((resolve) => {
      releaseCallbacks = resolve
    })
    const currentRow = {
      organizationId: expectation.organizationId,
      propertyId: expectation.propertyId,
      reviewId: expectation.reviewId,
      observationRevision: expectation.observationRevision,
      sourceEpoch: expectation.sourceEpoch,
      materialReviewRevision: expectation.materialReviewRevision,
      currentReviewSourceEpoch: expectation.sourceEpoch,
      currentReviewMaterialReviewRevision: expectation.materialReviewRevision,
      headState: 'live',
      headProvenance: expectation.provenance,
      state: 'live',
      change: expectation.change,
      resolution: expectation.resolution,
      provenance: expectation.provenance,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      observedAt: NOW,
      reviewSourceContentState: 'active',
      responseTargetEligibility: 'measured',
      responseTargetStartAt: NOW,
    }
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      for: () => query,
      limit: async () => [currentRow],
    }
    const tx = {
      execute: async () => undefined,
      select: () => query,
    }
    const transaction = vi.fn(async (apply: (input: typeof tx) => Promise<unknown>) => {
      activeTransactions += 1
      peakTransactions = Math.max(peakTransactions, activeTransactions)
      try {
        return await apply(tx)
      } finally {
        activeTransactions -= 1
      }
    })
    const authorities = [
      firstModule.createReviewReplyObservationAuthority({
        transaction,
      } as unknown as Database),
      secondModule.createReviewReplyObservationAuthority({
        transaction,
      } as unknown as Database),
    ] as const
    const calls = Array.from({ length: maxConcurrent + 3 }, (_, index) =>
      authorities[index % authorities.length]!.withExactCurrent(
        expectation,
        async () => callbackBarrier,
      ),
    )

    await vi.waitFor(() => {
      expect(transaction).toHaveBeenCalledTimes(maxConcurrent)
    })
    expect(activeTransactions).toBe(maxConcurrent)
    expect(peakTransactions).toBe(maxConcurrent)
    expect(maxConcurrent * firstModule.REPLY_OBSERVATION_APPLY_CLIENTS).toBeLessThan(
      POOL_MAX_CONNECTIONS,
    )

    releaseCallbacks()
    await expect(Promise.all(calls)).resolves.toHaveLength(calls.length)
    expect(peakTransactions).toBe(maxConcurrent)
  })

  it.each([
    {
      label: 'unknown source state',
      reviewSourceContentState: 'unknown',
      responseTargetEligibility: 'measured',
      responseTargetStartAt: NOW,
    },
    {
      label: 'unknown target eligibility',
      reviewSourceContentState: 'active',
      responseTargetEligibility: 'unknown',
      responseTargetStartAt: null,
    },
    {
      label: 'measured target without a provider start',
      reviewSourceContentState: 'active',
      responseTargetEligibility: 'measured',
      responseTargetStartAt: null,
    },
    {
      label: 'excluded target with a provider start',
      reviewSourceContentState: 'active',
      responseTargetEligibility: 'historical_onboarding',
      responseTargetStartAt: NOW,
    },
  ])('fails closed for $label', async (invalidMetadata) => {
    const { createReviewReplyObservationAuthority } =
      await import('./reply-observation-authority')
    const currentRow = {
      organizationId: expectation.organizationId,
      propertyId: expectation.propertyId,
      reviewId: expectation.reviewId,
      observationRevision: expectation.observationRevision,
      sourceEpoch: expectation.sourceEpoch,
      materialReviewRevision: expectation.materialReviewRevision,
      currentReviewSourceEpoch: expectation.sourceEpoch,
      currentReviewMaterialReviewRevision: expectation.materialReviewRevision,
      headState: 'live',
      headProvenance: expectation.provenance,
      state: 'live',
      change: expectation.change,
      resolution: expectation.resolution,
      provenance: expectation.provenance,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      observedAt: NOW,
      ...invalidMetadata,
    }
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      for: () => query,
      limit: async () => [currentRow],
    }
    const tx = {
      execute: async () => undefined,
      select: () => query,
    }
    const db = {
      transaction: async (apply: (input: typeof tx) => Promise<unknown>) => apply(tx),
    } as unknown as Database
    const apply = vi.fn(async () => 'unexpected')

    await expect(
      createReviewReplyObservationAuthority(db).withExactCurrent(expectation, apply),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(apply).not.toHaveBeenCalled()
  })
})
