import { z } from 'zod/v4'

export const getRecognitionBoardSchema = z
  .object({
    propertyId: z.uuid(),
    portalGroupId: z.uuid().optional(),
  })
  .strict()

export const getRecognitionSettingsSchema = z
  .object({
    propertyId: z.uuid(),
  })
  .strict()

export const activateRecognitionSchema = z
  .object({
    propertyId: z.uuid(),
    policyVersion: z.string().min(1).max(80),
    jurisdiction: z.string().min(1).max(80),
    noticeStatus: z.literal('completed'),
    consultationStatus: z.enum(['completed', 'not_required']),
    audience: z.literal('property_managers_and_scoped_staff'),
    selectedPortalGroupIds: z.array(z.uuid()).min(1),
    metricDefinitionVersionId: z.uuid(),
    aggregation: z.enum(['sum', 'latest', 'ratio']),
    periodKind: z.enum(['weekly', 'monthly', 'quarterly']),
    minimumExposure: z.number().int().min(1),
    minimumSample: z.number().int().min(1),
    freshnessSeconds: z.number().int().min(1),
    minimumCompleteness: z.number().min(0).max(1),
  })
  .strict()
export const deactivateRecognitionSchema = z
  .object({
    propertyId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
export type GetRecognitionBoardInput = z.infer<typeof getRecognitionBoardSchema>
export type GetRecognitionSettingsInput = z.infer<typeof getRecognitionSettingsSchema>
export type ActivateRecognitionInput = z.infer<typeof activateRecognitionSchema>
export type DeactivateRecognitionInput = z.infer<typeof deactivateRecognitionSchema>
