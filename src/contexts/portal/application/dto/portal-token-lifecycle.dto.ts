import { z } from 'zod/v4'

const portalTokenPortalIdSchema = z.string().min(1, 'Portal ID is required')

export const issuePortalTokenInputSchema = z.object({
  portalId: portalTokenPortalIdSchema,
})

const portalTokenGracePeriodDaysSchema = z
  .number()
  .int('Transition period must be a whole number')
  .min(1, 'Transition period must be at least 1 day')
  .max(90, 'Transition period must be no more than 90 days')

export const plannedPortalTokenReplacementFormSchema = z.object({
  gracePeriodDays: portalTokenGracePeriodDaysSchema,
})

export const rotatePortalTokenInputSchema = issuePortalTokenInputSchema
  .extend({
    replacementKind: z.enum(['planned', 'security']).optional(),
    gracePeriodDays: portalTokenGracePeriodDaysSchema.optional(),
  })
  .refine(
    (value) =>
      value.replacementKind !== 'security' || value.gracePeriodDays === undefined,
    {
      message: 'Immediate security replacement cannot include a grace period',
      path: ['gracePeriodDays'],
    },
  )

const portalTokenRevokeReasonSchema = z
  .string()
  .trim()
  .min(1, 'Reason is required')
  .max(500)

export const revokePortalTokensInputSchema = issuePortalTokenInputSchema.extend({
  reason: portalTokenRevokeReasonSchema,
})

export type RotatePortalTokenInput = z.infer<typeof rotatePortalTokenInputSchema>
export type RevokePortalTokensInput = z.infer<typeof revokePortalTokensInputSchema>
