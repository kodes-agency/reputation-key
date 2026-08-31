import { beforeEach, describe, expect, it, vi } from 'vitest'

const evidence = vi.hoisted(() => ({
  openRetentionRun: vi.fn(async () => 'retention-run'),
  closeRetentionRun: vi.fn(async () => {}),
  failRetentionRun: vi.fn(async () => {}),
}))

vi.mock('#/shared/db/retention/evidence', () => evidence)
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, operation: () => Promise<unknown>) => operation(),
}))

import {
  AI_AUTHORIZATION_ERASURE_RETENTION_SUBJECT,
  createAiAuthorizationErasureHandler,
} from './ai-authorization-erasure.job'

const NOW = new Date('2026-08-28T08:00:00.000Z')
const success = {
  claimed: 2,
  completed: 2,
  retryScheduled: 0,
  terminalFailed: 0,
  lostClaims: 0,
  deleted: {
    reviewAnalysis: 3,
    propertyAggregate: 4,
    propertyTrend: 5,
    total: 12,
  },
  batchFull: false,
  backlog: { pending: 0, inProgress: 0, terminalFailed: 0, overdue: 0 },
} as const

describe('AI authorization erasure job', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes content-free successful deletion evidence', async () => {
    const handler = createAiAuthorizationErasureHandler({
      db: {} as never,
      clock: () => NOW,
      batchSize: 25,
      erase: vi.fn(async () => success),
    })

    await expect(handler({ data: {} } as never)).resolves.toEqual(success)
    expect(evidence.openRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      AI_AUTHORIZATION_ERASURE_RETENTION_SUBJECT,
      25,
      NOW,
    )
    expect(evidence.closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'retention-run',
      {
        finishedAt: NOW,
        batches: 1,
        rowsDeleted: 12,
        outcome: 'completed',
      },
    )
  })

  it('turns a scheduled local retry into the existing retention failure signal', async () => {
    const handler = createAiAuthorizationErasureHandler({
      db: {} as never,
      clock: () => NOW,
      batchSize: 25,
      erase: vi.fn(async () => ({ ...success, retryScheduled: 1, completed: 1 })),
    })

    await expect(handler({ data: {} } as never)).rejects.toThrow(
      'AI authorization erasure requires recovery',
    )
    expect(evidence.closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'retention-run',
      {
        finishedAt: NOW,
        batches: 1,
        rowsDeleted: 12,
        outcome: 'failed',
        errorCode: 'ai_erasure_retry_scheduled',
      },
    )
  })

  it('prioritizes a deadline breach over retry state in the operational signal', async () => {
    const handler = createAiAuthorizationErasureHandler({
      db: {} as never,
      clock: () => NOW,
      batchSize: 25,
      erase: vi.fn(async () => ({
        ...success,
        terminalFailed: 1,
        backlog: { ...success.backlog, terminalFailed: 1, overdue: 1 },
      })),
    })

    await expect(handler({ data: {} } as never)).rejects.toThrow(
      'AI authorization erasure requires recovery',
    )
    expect(evidence.closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'retention-run',
      expect.objectContaining({
        outcome: 'failed',
        errorCode: 'ai_erasure_deadline_breached',
      }),
    )
  })

  it('best-effort closes fatal worker errors without retaining the raw exception', async () => {
    const handler = createAiAuthorizationErasureHandler({
      db: {} as never,
      clock: () => NOW,
      batchSize: 25,
      erase: vi.fn(async () => {
        throw new Error('private content must not reach evidence')
      }),
    })

    await expect(handler({ data: {} } as never)).rejects.toThrow(
      'AI authorization erasure worker failed',
    )
    expect(evidence.failRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'retention-run',
      NOW,
      expect.objectContaining({ message: 'ai_erasure_worker_failed' }),
    )
    expect(JSON.stringify(evidence.failRetentionRun.mock.calls)).not.toContain(
      'private content',
    )
  })
})
