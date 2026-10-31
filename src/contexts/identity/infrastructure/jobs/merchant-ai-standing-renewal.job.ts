import type { Job } from 'bullmq'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'merchant-ai-standing-renewal' as const

export const createMerchantAiStandingRenewalHandler =
  (sweep: () => Promise<unknown>) =>
  async (_job: Job): Promise<void> => {
    await trace(`job.${JOB_NAME}`, sweep)
  }
