import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAiReviewAnalysisEnrollmentSweepHandler,
  JOB_NAME,
} from './ai-review-analysis-enrollment-sweep.job'

const info = vi.fn()
const warn = vi.fn()
const logger = { info, warn }

afterEach(() => {
  info.mockClear()
  warn.mockClear()
})

const OUTCOME = Object.freeze({
  enrollmentsVisited: 3,
  runtimeBlocked: 1,
  replaysStarted: 1,
  revisionsPinned: 17,
  waitingForReplay: 0,
  enrollmentsCaughtUp: 1,
  enrollmentsSuperseded: 0,
  enrollmentsStalled: 0,
  batchFull: false,
})

describe('AI Review Analysis enrollment sweep job', () => {
  it('reports the bounded sweep outcome without tenant or review identifiers', async () => {
    const sweep = vi.fn(async () => OUTCOME)

    await createAiReviewAnalysisEnrollmentSweepHandler({ sweep, logger })({} as never)

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      { job: JOB_NAME, ...OUTCOME },
      'AI Review Analysis enrollment sweep completed',
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a full batch for the next recurring tick without self-enqueueing', async () => {
    const sweep = vi.fn(async () => ({ ...OUTCOME, batchFull: true }))

    await createAiReviewAnalysisEnrollmentSweepHandler({ sweep, logger })({} as never)

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      { job: JOB_NAME, ...OUTCOME, batchFull: true },
      'AI Review Analysis enrollment sweep reached its batch cap',
    )
    expect(info).not.toHaveBeenCalled()
  })

  it('lets a sweep failure fail the job so BullMQ retries the tick', async () => {
    const sweep = vi.fn(async () => {
      throw new Error('enrollment sweep unavailable')
    })

    await expect(
      createAiReviewAnalysisEnrollmentSweepHandler({ sweep, logger })({} as never),
    ).rejects.toThrow('enrollment sweep unavailable')
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
