import { describe, expect, it, vi } from 'vitest'
import type {
  AiAuthorizationErasureClaim,
  AiAuthorizationErasureStorePort,
} from '../ports/ai-authorization-erasure.port'
import {
  AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS,
  createEraseAiAuthorizationDerivatives,
} from './erase-ai-authorization-derivatives'

const NOW = new Date('2026-08-28T08:00:00.000Z')
const CLAIM: AiAuthorizationErasureClaim = {
  lifecycleId: '41000000-0000-4000-8000-000000000001',
  leaseOwner: '41000000-0000-4000-8000-000000000002',
  attempt: 1,
  deadlineEpochMillis: NOW.getTime() + 24 * 60 * 60 * 1_000,
}

const createStore = (
  overrides: Partial<AiAuthorizationErasureStorePort> = {},
): AiAuthorizationErasureStorePort => ({
  claimNext: vi.fn(async () => null),
  eraseClaim: vi.fn(async () => ({
    status: 'completed' as const,
    deleted: {
      reviewAnalysis: 2,
      propertyAggregate: 3,
      propertyTrend: 4,
    },
  })),
  recordClaimFailure: vi.fn(async () => ({ status: 'retry_scheduled' as const })),
  readBacklog: vi.fn(async () => ({
    pending: 0,
    inProgress: 0,
    terminalFailed: 0,
    overdue: 0,
  })),
  ...overrides,
})

describe('erase AI authorization derivatives', () => {
  it('processes a bounded claimed batch and reports class-separated deletion evidence', async () => {
    const claimNext = vi
      .fn<AiAuthorizationErasureStorePort['claimNext']>()
      .mockResolvedValueOnce(CLAIM)
      .mockResolvedValueOnce(null)
    const store = createStore({ claimNext })
    const erase = createEraseAiAuthorizationDerivatives({
      store,
      clock: () => NOW,
      leaseOwner: CLAIM.leaseOwner,
      batchSize: 2,
    })

    await expect(erase()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retryScheduled: 0,
      terminalFailed: 0,
      lostClaims: 0,
      deleted: {
        reviewAnalysis: 2,
        propertyAggregate: 3,
        propertyTrend: 4,
        total: 9,
      },
      batchFull: false,
      backlog: { pending: 0, inProgress: 0, terminalFailed: 0, overdue: 0 },
    })
    expect(claimNext).toHaveBeenCalledWith({
      leaseOwner: CLAIM.leaseOwner,
      now: NOW,
    })
    expect(store.eraseClaim).toHaveBeenCalledWith({ claim: CLAIM, now: NOW })
  })

  it('records a safe bounded retry without persisting the thrown error text', async () => {
    const claimNext = vi
      .fn<AiAuthorizationErasureStorePort['claimNext']>()
      .mockResolvedValueOnce(CLAIM)
      .mockResolvedValueOnce(null)
    const recordClaimFailure = vi.fn(async () => ({
      status: 'retry_scheduled' as const,
    }))
    const store = createStore({
      claimNext,
      eraseClaim: vi.fn(async () => {
        throw new Error('review text and provider detail must never be retained')
      }),
      recordClaimFailure,
    })
    const erase = createEraseAiAuthorizationDerivatives({
      store,
      clock: () => NOW,
      leaseOwner: CLAIM.leaseOwner,
      batchSize: 2,
    })

    await expect(erase()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      retryScheduled: 1,
      terminalFailed: 0,
    })
    expect(recordClaimFailure).toHaveBeenCalledWith({
      claim: CLAIM,
      failureCode: 'local_delete_failed',
      occurredAt: NOW,
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
    })
    expect(JSON.stringify(recordClaimFailure.mock.calls)).not.toContain('review text')
  })

  it('uses the persisted attempt budget to terminal-settle the last failure', async () => {
    const finalClaim = {
      ...CLAIM,
      attempt: AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS,
    }
    const store = createStore({
      claimNext: vi
        .fn<AiAuthorizationErasureStorePort['claimNext']>()
        .mockResolvedValueOnce(finalClaim)
        .mockResolvedValueOnce(null),
      eraseClaim: vi.fn(async () => {
        throw new Error('unsafe implementation detail')
      }),
      recordClaimFailure: vi.fn(async () => ({ status: 'terminal_failed' as const })),
      readBacklog: vi.fn(async () => ({
        pending: 0,
        inProgress: 0,
        terminalFailed: 1,
        overdue: 0,
      })),
    })
    const erase = createEraseAiAuthorizationDerivatives({
      store,
      clock: () => NOW,
      leaseOwner: CLAIM.leaseOwner,
      batchSize: 2,
    })

    await expect(erase()).resolves.toMatchObject({
      claimed: 1,
      retryScheduled: 0,
      terminalFailed: 1,
      backlog: { terminalFailed: 1 },
    })
    expect(store.recordClaimFailure).toHaveBeenCalledWith(
      expect.objectContaining({ nextAttemptAt: null }),
    )
  })

  it('counts a claim lost to a lease race without inventing completion evidence', async () => {
    const store = createStore({
      claimNext: vi
        .fn<AiAuthorizationErasureStorePort['claimNext']>()
        .mockResolvedValueOnce(CLAIM)
        .mockResolvedValueOnce(null),
      eraseClaim: vi.fn(async () => ({ status: 'lost_claim' as const })),
    })
    const erase = createEraseAiAuthorizationDerivatives({
      store,
      clock: () => NOW,
      leaseOwner: CLAIM.leaseOwner,
      batchSize: 2,
    })

    await expect(erase()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      lostClaims: 1,
      deleted: { total: 0 },
    })
  })

  it('stops at the configured cap and exposes remaining overdue work', async () => {
    const claimNext = vi
      .fn<AiAuthorizationErasureStorePort['claimNext']>()
      .mockResolvedValueOnce(CLAIM)
    const store = createStore({
      claimNext,
      readBacklog: vi.fn(async () => ({
        pending: 4,
        inProgress: 0,
        terminalFailed: 0,
        overdue: 2,
      })),
    })
    const erase = createEraseAiAuthorizationDerivatives({
      store,
      clock: () => NOW,
      leaseOwner: CLAIM.leaseOwner,
      batchSize: 1,
    })

    await expect(erase()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      batchFull: true,
      backlog: { pending: 4, overdue: 2 },
    })
    expect(claimNext).toHaveBeenCalledTimes(1)
  })
})
