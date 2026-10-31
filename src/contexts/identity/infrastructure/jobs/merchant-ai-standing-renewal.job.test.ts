import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createMerchantAiStandingRenewalHandler,
  JOB_NAME,
} from './merchant-ai-standing-renewal.job'

describe('merchant AI standing renewal job', () => {
  it('owns one enabled background schedule every ten minutes', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toEqual([
      expect.objectContaining({
        queue: 'background',
        schedule: 'every:600000',
        registration: 'enabled',
      }),
    ])
  })

  it('runs the sweep once per firing', async () => {
    const sweep = vi.fn(async () => ({ visited: 0 }))
    await createMerchantAiStandingRenewalHandler(sweep)({} as Job)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('lets a failing sweep fail the firing so the job runtime records it', async () => {
    const handler = createMerchantAiStandingRenewalHandler(async () => {
      throw new Error('listing failed')
    })
    await expect(handler({} as Job)).rejects.toThrow('listing failed')
  })
})
