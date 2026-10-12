import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  GeneratePropertyTrendInput,
  GeneratePropertyTrendResult,
} from '../../application/use-cases/generate-property-trend'

export const GENERATE_PROPERTY_TREND_JOB_NAME = 'generate-property-ai-trend'

/**
 * One scheduled trend and the Property it belongs to. The family is
 * property-scoped, and the delayed-execution gate reads that scope from the
 * payload alone: a job naming only its schedule is denied `missing_scope`
 * before this handler runs. Identifier-only.
 */
const propertyTrendJobData = z
  .object({
    scheduleId: z.uuid(),
    organizationId: z.string().min(1).max(255),
    propertyId: z.uuid(),
  })
  .strict()

export type GeneratePropertyTrendJobData = z.infer<typeof propertyTrendJobData>

/** The one reading of the payload, for the producer and the handler alike. */
export const parseGeneratePropertyTrendJobData = (
  data: unknown,
): GeneratePropertyTrendJobData => propertyTrendJobData.parse(data)

export type GeneratePropertyTrendJobDependencies = Readonly<{
  generatePropertyTrend(
    input: GeneratePropertyTrendInput,
  ): Promise<GeneratePropertyTrendResult>
}>

export const createGeneratePropertyTrendJobHandler = (
  dependencies: GeneratePropertyTrendJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    const data = parseGeneratePropertyTrendJobData(job.data)
    const result = await dependencies.generatePropertyTrend({
      scheduleId: data.scheduleId,
      organizationId: organizationId(data.organizationId),
      propertyId: propertyId(data.propertyId),
    })
    if (result.status === 'retry') {
      throw new Error(`AI property trend retry required: ${result.code}`)
    }
  }
}
