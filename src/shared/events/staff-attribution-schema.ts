import { z } from 'zod/v4'
import { databaseUuidSchema } from './reply-publication-cancelled-schema'

export const primaryStaffAttributionSchema = z
  .object({
    staffParticipantId: databaseUuidSchema,
    staffParticipationId: databaseUuidSchema,
    portalResponsibilityId: databaseUuidSchema,
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.effectiveTo !== null &&
      new Date(value.effectiveTo).getTime() <= new Date(value.effectiveFrom).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Primary Staff attribution interval must be half-open and non-empty',
      })
    }
  })
