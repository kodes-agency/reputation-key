// Portal context — create portal DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'
import { normalizeSlug, SLUG_PATTERN } from '#/shared/domain/slug'

const createPortalFieldsSchema = z.object({
  name: z.string().min(1, 'Portal name is required').max(100),
  slug: z.string().min(2).max(64).optional(),
  description: z.string().max(500).optional(),
  privateFeedbackThreshold: z.number().int().min(1).max(5).optional(),
  propertyId: z.string().min(1, 'Property ID is required'),
  entityType: z.literal('property').optional(),
  entityId: z.string().optional(),
  theme: z
    .object({
      primaryColor: z.string(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
    })
    .optional(),
})

export const createPortalInputSchema = createPortalFieldsSchema
  .strict()
  .superRefine((input, ctx) => {
    if (input.entityId !== undefined && input.entityId !== input.propertyId) {
      ctx.addIssue({
        code: 'custom',
        path: ['entityId'],
        message: 'Portal ownership must match the selected Property',
      })
    }
  })

const SLUG_RULE_MESSAGE =
  'Use 2–64 lowercase letters, numbers or hyphens, starting and ending with a letter or number.'
const UNDERIVABLE_SLUG_MESSAGE =
  'This name has no letters or numbers to build a web address from — enter a slug such as “tokyo-suite”.'

export const createPortalFormInputSchema = createPortalFieldsSchema
  .pick({
    name: true,
    description: true,
    theme: true,
    privateFeedbackThreshold: true,
  })
  .required()
  .extend({ slug: z.string() })
  .superRefine((values, ctx) => {
    const typed = values.slug.trim()
    const candidate = typed.length > 0 ? typed : normalizeSlug(values.name)
    if (SLUG_PATTERN.test(candidate)) return
    ctx.addIssue({
      code: 'custom',
      path: ['slug'],
      message: typed.length > 0 ? SLUG_RULE_MESSAGE : UNDERIVABLE_SLUG_MESSAGE,
    })
  })

export type CreatePortalInput = z.infer<typeof createPortalInputSchema>
export type CreatePortalFormInput = z.infer<typeof createPortalFormInputSchema>
