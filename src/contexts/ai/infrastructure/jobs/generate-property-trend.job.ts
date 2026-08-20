import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import type { GeneratePropertyTrendResult } from '../../application/use-cases/generate-property-trend'

export const GENERATE_PROPERTY_TREND_JOB_NAME = 'generate-property-ai-trend'

const propertyTrendJobData = z
  .object({
    scheduleId: z.uuid(),
  })
  .strict()

export type GeneratePropertyTrendJobDependencies = Readonly<{
  generatePropertyTrend(
    input: Readonly<{
      scheduleId: string
    }>,
  ): Promise<GeneratePropertyTrendResult>
}>

export function createGeneratePropertyTrendJobHandler(
  dependencies: GeneratePropertyTrendJobDependencies,
): (job: Job) => Promise<void> {
  return async (job) => {
    const data = propertyTrendJobData.parse(job.data)
    const result = await dependencies.generatePropertyTrend({
      scheduleId: data.scheduleId,
    })
    if (result.status === 'retry') {
      throw new Error(`AI property trend retry required: ${result.code}`)
    }
  }
}
