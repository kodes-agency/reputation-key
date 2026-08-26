import { z } from 'zod/v4'

export const contactRequestPurposeSchema = z.enum(['manager_follow_up'] as const)

export const contactRequestEmailSchema = z.string().trim().max(254).pipe(z.email())
export const contactRequestNameSchema = z.string().trim().min(1).max(100)

export const contactRequestContactSchema = z.strictObject({
  email: contactRequestEmailSchema,
  name: contactRequestNameSchema.optional(),
})

/**
 * Future public-boundary contract. Consent deliberately defaults to false;
 * the lifecycle still requires the caller to send an explicit true value.
 */
export const submitContactRequestInputSchema = z
  .object({
    organizationId: z.string().min(1).max(255),
    propertyId: z.uuid(),
    portalId: z.uuid(),
    responseId: z.uuid(),
    email: contactRequestEmailSchema,
    name: contactRequestNameSchema.optional(),
    consent: z.boolean().default(false),
    purpose: contactRequestPurposeSchema.optional(),
  })
  .strict()

export type SubmitContactRequestDto = z.infer<typeof submitContactRequestInputSchema>
