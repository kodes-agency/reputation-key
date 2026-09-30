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

/**
 * The replace-code form: a planned replacement keeps the old code working for a
 * transition period; a security replacement stops it now. The days field is only
 * checked for a planned replacement, because the form hides it otherwise and a
 * stale or blank value there must not block the submit.
 */
export const portalCodeReplacementFormSchema = z
  .object({
    replacementKind: z.enum(['planned', 'security']),
    gracePeriodDays: z.union([z.number(), z.nan()]),
  })
  .superRefine((value, ctx) => {
    if (value.replacementKind !== 'planned') return
    const days = portalTokenGracePeriodDaysSchema.safeParse(value.gracePeriodDays)
    if (days.success) return
    for (const issue of days.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['gracePeriodDays'] })
    }
  })

export type PortalCodeReplacementForm = z.infer<typeof portalCodeReplacementFormSchema>

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

/** The rotate command for a validated replace-code choice. */
export function toRotatePortalTokenInput(
  portalId: string,
  choice: PortalCodeReplacementForm,
): RotatePortalTokenInput {
  return choice.replacementKind === 'planned'
    ? {
        portalId,
        replacementKind: 'planned',
        gracePeriodDays: choice.gracePeriodDays,
      }
    : { portalId, replacementKind: 'security' }
}
export type RevokePortalTokensInput = z.infer<typeof revokePortalTokensInputSchema>
