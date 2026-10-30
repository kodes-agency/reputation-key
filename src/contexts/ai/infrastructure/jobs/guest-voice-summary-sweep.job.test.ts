import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import { GuestVoiceSummarySweepError } from '../../application/use-cases/run-guest-voice-summary-sweep'
import {
  createGuestVoiceSummarySweepJobHandler,
  GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME,
} from './guest-voice-summary-sweep.job'

const STATS = {
  inspected: 3,
  sent: 2,
  alreadySent: 0,
  quiet: 1,
  skipped: 0,
  denied: 0,
  failed: 0,
}

const job = (data: unknown = {}) => ({ data }) as Job

function harness(sweep = vi.fn(async () => STATS)) {
  const logger = { info: vi.fn(), warn: vi.fn() }
  const authorizeScope = vi.fn(async () => true)
  const handler = createGuestVoiceSummarySweepJobHandler({
    sweep,
    authorizeScope,
    logger,
  })
  return { handler, sweep, logger, authorizeScope }
}

describe('the Monday sweep job', () => {
  it('has the name the schedule and the catalogue know it by', () => {
    expect(GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME).toBe('ai-guest-voice-summary-sweep')
  })

  it('runs the sweep under the schedule’s own scope authorizer and logs only counts', async () => {
    const { handler, sweep, logger, authorizeScope } = harness()

    await handler(job())

    expect(sweep).toHaveBeenCalledWith({ authorizeScope })
    expect(logger.info).toHaveBeenCalledWith(
      { job: GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME, ...STATS },
      'Guest voice summary sweep completed',
    )
  })

  it('says nothing when no Property was due', async () => {
    const { handler, logger } = harness(vi.fn(async () => ({ ...STATS, inspected: 0 })))

    await handler(job())

    expect(logger.info).not.toHaveBeenCalled()
  })

  it('logs the counts of a run that failed and then fails it, for a queue retry', async () => {
    const error = new GuestVoiceSummarySweepError({ ...STATS, failed: 1 })
    const { handler, logger } = harness(
      vi.fn(async () => {
        throw error
      }),
    )

    await expect(handler(job())).rejects.toBe(error)
    expect(logger.warn).toHaveBeenCalledWith(
      { job: GUEST_VOICE_SUMMARY_SWEEP_JOB_NAME, ...error.stats },
      'Guest voice summary sweep: Properties failed',
    )
  })

  it('carries any other error through untouched', async () => {
    const { handler, logger } = harness(
      vi.fn(async () => {
        throw new Error('database unavailable')
      }),
    )

    await expect(handler(job())).rejects.toThrow('database unavailable')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('refuses job data that carries anything beyond what a quarantine redrive adds', async () => {
    const { handler, sweep } = harness()

    await expect(handler(job({ organizationId: 'org-1' }))).rejects.toThrow(ZodError)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('accepts a job with no data', async () => {
    const { handler } = harness()

    await expect(handler({} as Job)).resolves.toBeUndefined()
  })
})
