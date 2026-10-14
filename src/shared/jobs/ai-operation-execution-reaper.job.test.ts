// AI operation recovery reaper job unit tests.
//
// The job module is the queue seam: one reap, one budget release, one
// content-free log line. What it can get wrong is (a) logging a pass in which
// candidates failed at the level of a clean one, so nobody reading the log sees
// that a systemic fault is leaving operations unrecovered, (b) skipping the
// budget release when candidates failed, and (c) leaking an identifier into the
// completion line.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => mockLogger),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))

import {
  createAiOperationExecutionReaperHandler,
  JOB_NAME,
} from './ai-operation-execution-reaper.job'

const CLEAN_OUTCOME = Object.freeze({
  recoveryCandidatesVisited: 4,
  operationsFenced: 2,
  operationsDelivered: 1,
  operationsSettled: 3,
  operationsRaced: 0,
  candidatesFailed: 0,
  batchFull: false,
})

const COMPLETION_MESSAGE = 'AI operation recovery reaper completed'

describe('AI operation recovery reaper job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs a clean pass at info with the counts and the released reservations', async () => {
    const releaseStaleReservations = vi.fn(async () => 5)

    await createAiOperationExecutionReaperHandler({
      reap: async () => CLEAN_OUTCOME,
      releaseStaleReservations,
    })({} as Job)

    expect(mockLogger.info).toHaveBeenCalledWith(
      { job: JOB_NAME, ...CLEAN_OUTCOME, reservationsReleased: 5 },
      COMPLETION_MESSAGE,
    )
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('logs a pass in which a candidate failed at warn, and still releases the reservations', async () => {
    const outcome = { ...CLEAN_OUTCOME, candidatesFailed: 2 }
    const releaseStaleReservations = vi.fn(async () => 1)

    await createAiOperationExecutionReaperHandler({
      reap: async () => outcome,
      releaseStaleReservations,
    })({} as Job)

    expect(releaseStaleReservations).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { job: JOB_NAME, ...outcome, reservationsReleased: 1 },
      COMPLETION_MESSAGE,
    )
    expect(mockLogger.info).not.toHaveBeenCalled()
  })

  it('fails the job when the pass itself cannot run, so BullMQ retries the tick', async () => {
    await expect(
      createAiOperationExecutionReaperHandler({
        reap: async () => {
          throw new Error('operation store unavailable')
        },
        releaseStaleReservations: async () => 0,
      })({} as Job),
    ).rejects.toThrow('operation store unavailable')
    expect(mockLogger.info).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
