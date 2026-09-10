import { z } from 'zod/v4'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'
import {
  MAX_REPLY_LENGTH,
  REPLY_TEMPLATE_SLOT_TOKENS,
  unknownReplyTemplateSlots,
} from '../../domain/rules'

export const REPLY_LIBRARY_FIELD_LIMITS = Object.freeze({
  greeting: 120,
  signOff: 200,
  escalationContact: 200,
  title: 120,
  openLabel: 80,
  languageTag: 35,
  body: MAX_REPLY_LENGTH,
})

function supportedSlotsTextSchema(maximum: number, label: string) {
  return z
    .string()
    .max(maximum, `${label} must be ${maximum} characters or fewer`)
    .superRefine((value, ctx) => {
      const unknown = unknownReplyTemplateSlots(value)
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Unsupported reply template slot: ${unknown.join(', ')}`,
        })
      }
    })
}

export const replyProfileFieldSchemas = Object.freeze({
  greeting: supportedSlotsTextSchema(REPLY_LIBRARY_FIELD_LIMITS.greeting, 'Greeting'),
  signOffPositive: supportedSlotsTextSchema(
    REPLY_LIBRARY_FIELD_LIMITS.signOff,
    'Positive sign-off',
  ),
  signOffNegative: supportedSlotsTextSchema(
    REPLY_LIBRARY_FIELD_LIMITS.signOff,
    'Negative sign-off',
  ),
  emojiAllowed: z.boolean(),
  escalationContact: supportedSlotsTextSchema(
    REPLY_LIBRARY_FIELD_LIMITS.escalationContact,
    'Escalation contact',
  ).nullable(),
})

export const replyProfileValuesSchema = z.object(replyProfileFieldSchemas).strict()

export const replyTemplateTitleSchema = z
  .string()
  .trim()
  .min(1, 'Template title is required')
  .max(
    REPLY_LIBRARY_FIELD_LIMITS.title,
    `Template title must be ${REPLY_LIBRARY_FIELD_LIMITS.title} characters or fewer`,
  )

const replyTemplateStarSchema = z
  .number()
  .int('Ratings must be whole numbers')
  .min(1, 'Ratings must be between 1 and 5')
  .max(5, 'Ratings must be between 1 and 5')

export const replyTemplateRatingBandsSchema = z
  .array(replyTemplateStarSchema)
  .min(1, 'Choose at least one rating')
  .max(5, 'Choose no more than five ratings')
  .superRefine((bands, ctx) => {
    const sorted = [...bands].sort((a, b) => a - b)
    if (
      new Set(sorted).size !== sorted.length ||
      sorted.some((band, index) => index > 0 && band !== sorted[index - 1]! + 1)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Rating bands must be unique and contiguous',
      })
    }
  })

export const replyTemplateAspectSchema = z.enum(ASPECT_TAXONOMY_V1).nullable()

export const replyTemplateOpenLabelSchema = z
  .string()
  .max(
    REPLY_LIBRARY_FIELD_LIMITS.openLabel,
    `Open label must be ${REPLY_LIBRARY_FIELD_LIMITS.openLabel} characters or fewer`,
  )
  .nullable()

export const replyTemplateLanguageSchema = z
  .string()
  .max(
    REPLY_LIBRARY_FIELD_LIMITS.languageTag,
    `Language tag must be ${REPLY_LIBRARY_FIELD_LIMITS.languageTag} characters or fewer`,
  )
  .refine((value) => parseCanonicalReplyLanguageTag(value) !== null, {
    message: 'Unsupported reply template language',
  })

export const replyTemplateSlotSchema = z.enum(REPLY_TEMPLATE_SLOT_TOKENS)

export const replyTemplateBodySchema = supportedSlotsTextSchema(
  REPLY_LIBRARY_FIELD_LIMITS.body,
  'Template body',
)
  .trim()
  .min(1, 'Template body is required')

export const replyTemplateValuesSchema = z
  .object({
    title: replyTemplateTitleSchema,
    ratingMin: replyTemplateStarSchema,
    ratingMax: replyTemplateStarSchema,
    hasText: z.boolean(),
    aspect: replyTemplateAspectSchema,
    openLabel: replyTemplateOpenLabelSchema,
    languageTag: replyTemplateLanguageSchema,
    body: replyTemplateBodySchema,
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((template, ctx) => {
    if (template.ratingMin > template.ratingMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['ratingMax'],
        message: 'Maximum rating must be at least the minimum rating',
      })
    }
  })

export const propertyReplyLibraryInputSchema = z
  .object({ propertyId: z.uuid('Choose a valid property') })
  .strict()

export const savePropertyReplyProfileInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    profile: replyProfileValuesSchema,
  })
  .strict()

export const savePropertyReplyTemplateInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    templateId: z.uuid('Choose a valid template').optional(),
    template: replyTemplateValuesSchema,
  })
  .strict()

export const setPropertyReplyTemplateEnabledInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    templateId: z.uuid('Choose a valid template'),
    enabled: z.boolean(),
  })
  .strict()

export type ReplyProfileValues = z.infer<typeof replyProfileValuesSchema>
export type ReplyTemplateValues = z.infer<typeof replyTemplateValuesSchema>
export type PropertyReplyLibraryInput = z.infer<typeof propertyReplyLibraryInputSchema>
export type SavePropertyReplyProfileInput = z.infer<
  typeof savePropertyReplyProfileInputSchema
>
export type SavePropertyReplyTemplateInput = z.infer<
  typeof savePropertyReplyTemplateInputSchema
>
export type SetPropertyReplyTemplateEnabledInput = z.infer<
  typeof setPropertyReplyTemplateEnabledInputSchema
>
