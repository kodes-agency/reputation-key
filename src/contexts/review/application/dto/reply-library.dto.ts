import { z } from 'zod/v4'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import {
  type ReplyVoiceField,
  type ResolvedReplyVoice,
} from '#/shared/reply-library/reply-voice'
import { REVIEW_TOPICS_V3, type ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import {
  parseCanonicalReplyLanguageTag,
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  type ReplyTemplateLanguageGroup,
} from '#/shared/reply-language-catalogue'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import { REPLY_TEMPLATE_SLOT_TOKENS, unknownReplyTemplateSlots } from '../../domain/rules'
import type { Reply } from '../../domain/types'
import { checkReplyText, type Finding } from '#/shared/reply-library/reply-checks'

// Google allows 4,096 bytes for the whole reply; the voice adds the greeting, closing,
// contact sentence and signature around a template body.
const TEMPLATE_BODY_MAX_BYTES = 3_500

const REPLY_LIBRARY_FIELD_LIMITS = Object.freeze({
  greeting: 120,
  signOff: 200,
  escalationContact: 200,
  title: 120,
  openLabel: 80,
  languageTag: 35,
  /**
   * UTF-16 units: the textarea's `maxLength` and the DB CHECK
   * (`char_length(body) <= 4096`, reply-library.schema.ts). Not the limit a body
   * must meet to be sendable — that is Google's 4,096 UTF-8 bytes, checked in
   * `replyTemplateBodySchema` — and never tighter than it, because no text has
   * fewer UTF-8 bytes than UTF-16 units.
   */
  body: 4096,
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
  // The body is loaded as a reply comment, and `loadReplyTemplate` refuses one
  // Google cannot take (reply-template-operations.ts). Checking the same rule
  // on the stored, trimmed body here means a template that saves is one that
  // can load; before, 2,049 Cyrillic letters saved and then never loaded.
  .superRefine((body, ctx) => {
    const problem = replyCommentProblem(body)
    // `empty` is the `.min(1)` issue above, reported once.
    if (problem === null || problem === 'empty') return
    ctx.addIssue({
      code: 'custom',
      message:
        problem === 'too_long'
          ? 'Template body is too long for Google. Shorten it to 4,096 bytes or fewer.'
          : "Template body contains a character Google doesn't accept. Remove any unusual control characters and try again.",
    })
  })

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

export type ReplyProfileValues = z.infer<typeof replyProfileValuesSchema>
export type ReplyTemplateValues = z.infer<typeof replyTemplateValuesSchema>

const replyLibraryScopeSchema = z.enum(['account', 'property'])
export const replyLibraryRefSchema = z
  .string()
  .refine(
    (value) =>
      /^builtin:[A-Z][A-Z0-9_-]*$/u.test(value) ||
      /^template:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      ),
    'Choose a valid reply template',
  )
const replyVoiceFieldSchema = z.enum([
  'useFirstName',
  'privacyMode',
  'greetingStyle',
  'contact',
  'emojiMode',
  'emojiSet',
  'signerName',
  'signerTitle',
  'businessNameShort',
  'visitWordKey',
] satisfies readonly ReplyVoiceField[])

const VOICE_VARIABLE_VALUES: Readonly<Record<string, string>> = Object.freeze({
  business_name: 'Business',
  contact: 'manager@example.test',
  signer_name: 'Manager',
  signer_title: 'General Manager',
  visit_word: 'visit',
})

function voiceTextSchema(maximum: number, label: string, urlMessage?: string) {
  return z
    .string()
    .trim()
    .max(maximum, `${label} must be ${maximum} characters or fewer`)
    .superRefine((value, ctx) => {
      if (value.length === 0) return
      const problem = replyCommentProblem(value)
      if (problem !== null) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} contains text Google does not accept`,
        })
        return
      }
      const checked = value.replaceAll(/\{([a-z_]+)\}/gu, (token, name: string) => {
        return Object.hasOwn(VOICE_VARIABLE_VALUES, name)
          ? VOICE_VARIABLE_VALUES[name]!
          : token
      })
      const { blocks } = checkReplyText({
        text: checked,
        kind: 'final_reply',
        languageGroup: 'en-Latn',
        privacyMode: false,
        emojiAllowed: true,
      })
      if (blocks.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            urlMessage && blocks.some(({ code }) => code === 'url')
              ? urlMessage
              : `${label} contains blocked reply content`,
        })
      }
    })
}

function nullableVoiceTextSchema(maximum: number, label: string, urlMessage?: string) {
  return voiceTextSchema(maximum, label, urlMessage)
    .nullable()
    .transform((value) => value?.trim() || null)
}

const localizedVoiceTextSchema = voiceTextSchema(200, 'Voice wording').min(
  1,
  'Voice wording cannot be blank',
)
const localizedVoiceTextListSchema = z.array(localizedVoiceTextSchema).max(6)

const localizedVoiceOverrideSchema = z
  .object({
    closings: z
      .object({
        positiveText: localizedVoiceTextListSchema.optional(),
        positiveRatingOnly: localizedVoiceTextListSchema.optional(),
        threeStar: localizedVoiceTextListSchema.optional(),
        negative: localizedVoiceTextListSchema.optional(),
      })
      .strict()
      .optional(),
    contactSentences: localizedVoiceTextListSchema.optional(),
    signOffWords: z
      .object({
        positive: localizedVoiceTextListSchema.optional(),
        negative: localizedVoiceTextListSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const replyVoiceSetSchema = z
  .object({
    useFirstName: z.boolean().optional(),
    privacyMode: z.boolean().optional(),
    greetingStyle: z
      .object({
        positive: z.enum(['hi', 'hello', 'dear']),
        negative: z.enum(['hi', 'hello', 'dear']),
      })
      .strict()
      .optional(),
    contact: nullableVoiceTextSchema(
      200,
      'Contact',
      'Use an email address or phone number',
    ).optional(),
    emojiMode: z.enum(['off', 'positive']).optional(),
    emojiSet: z.array(voiceTextSchema(16, 'Emoji').min(1)).max(5).optional(),
    signerName: nullableVoiceTextSchema(120, 'Signer name').optional(),
    signerTitle: nullableVoiceTextSchema(120, 'Signer title').optional(),
    businessNameShort: nullableVoiceTextSchema(120, 'Business name').optional(),
    visitWordKey: z
      .enum(['visit', 'stay', 'appointment', 'meal', 'trip', 'session'])
      .optional(),
  })
  .strict()

export const getReplyLibraryInputSchema = z
  .object({ propertyId: z.uuid('Choose a valid property') })
  .strict()
export const saveReplyVoiceInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    scope: replyLibraryScopeSchema,
    set: replyVoiceSetSchema,
    reset: z.array(replyVoiceFieldSchema),
    localized: z
      .object({
        'en-Latn': localizedVoiceOverrideSchema.optional(),
        'es-Latn': localizedVoiceOverrideSchema.optional(),
        'bg-Cyrl': localizedVoiceOverrideSchema.optional(),
      })
      .strict()
      .optional(),
    expectedVersion: z.number().int().min(0),
  })
  .strict()

const layeredReplyTemplateBodySchema = z
  .string()
  .trim()
  .min(1, 'Template body is required')
  .max(REPLY_LIBRARY_FIELD_LIMITS.body)
  .refine(
    (body) => new TextEncoder().encode(body).byteLength <= TEMPLATE_BODY_MAX_BYTES,
    {
      message:
        'Keep a template under 3,500 bytes so the greeting and signature still fit',
    },
  )
  .superRefine((body, ctx) => {
    const problem = replyCommentProblem(body)
    if (problem === null || problem === 'empty') return
    ctx.addIssue({
      code: 'custom',
      message:
        problem === 'too_long'
          ? 'Template body is too long for Google. Shorten it to 4,096 bytes or fewer.'
          : "Template body contains a character Google doesn't accept.",
    })
  })

const replyTemplateWordingSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    languageGroup: z.enum(REPLY_TEMPLATE_LANGUAGE_GROUPS),
    body: layeredReplyTemplateBodySchema,
  })
  .strict()

const storedReplyTemplateWordingsSchema = z
  .array(replyTemplateWordingSchema)
  .min(1, 'Add at least one template wording')
const replyTemplateWordingsSchema = z.preprocess<
  z.input<typeof storedReplyTemplateWordingsSchema>,
  typeof storedReplyTemplateWordingsSchema,
  z.input<typeof storedReplyTemplateWordingsSchema>
>(
  (value) =>
    Array.isArray(value)
      ? value.filter(
          (wording) =>
            typeof wording === 'object' &&
            wording !== null &&
            'body' in wording &&
            typeof wording.body === 'string' &&
            wording.body.trim().length > 0,
        )
      : value,
  storedReplyTemplateWordingsSchema,
)

export const saveReplyTemplateInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    scope: replyLibraryScopeSchema,
    base: replyLibraryRefSchema.optional(),
    templateId: z.uuid('Choose a valid template').optional(),
    title: replyTemplateTitleSchema,
    starsMin: replyTemplateStarSchema,
    starsMax: replyTemplateStarSchema,
    reviewKind: z.enum(['text', 'rating_only']),
    topic: z.enum(REVIEW_TOPICS_V3).nullable(),
    // The editor presents paired English/Spanish rows. A language may be left
    // blank; blank rows are UI placeholders, not stored wordings.
    wordings: replyTemplateWordingsSchema,
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.starsMin > input.starsMax) {
      ctx.addIssue({ code: 'custom', path: ['starsMax'], message: 'Invalid star range' })
    }
    const pairs = input.wordings.map(
      ({ key, languageGroup }) => `${key}\0${languageGroup}`,
    )
    if (new Set(pairs).size !== pairs.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordings'],
        message: 'Duplicate wording language',
      })
    }
  })

export const setReplyTemplateHiddenInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    scope: replyLibraryScopeSchema,
    ref: replyLibraryRefSchema,
    hidden: z.boolean(),
  })
  .strict()

export const resetReplyTemplateInputSchema = z
  .object({
    propertyId: z.uuid('Choose a valid property'),
    scope: replyLibraryScopeSchema,
    ref: replyLibraryRefSchema,
  })
  .strict()

export const checkReplyDraftInputSchema = z
  // The checker reports length itself (`too_long`); this cap only bounds the request.
  .object({ reviewId: z.uuid(), text: z.string().max(20_000) })
  .strict()

const replyTemplateLanguageTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property_default') }).strict(),
  z.object({ kind: z.literal('review_language') }).strict(),
])

export const listReplyTemplatesInputSchema = z
  .object({
    reviewId: z.uuid(),
    targetLanguage: replyTemplateLanguageTargetSchema,
  })
  .strict()

export const loadReplyTemplateInputSchema = z
  .object({
    reviewId: z.uuid(),
    templateId: z.union([z.uuid(), replyLibraryRefSchema]),
    targetLanguage: replyTemplateLanguageTargetSchema,
    excludeWordingKeys: z.array(z.string()).optional(),
  })
  .strict()

export type ReplyLibraryScope = z.infer<typeof replyLibraryScopeSchema>
export type ReplyLibraryRef = z.infer<typeof replyLibraryRefSchema>
export type GetReplyLibraryInput = z.infer<typeof getReplyLibraryInputSchema>
export type SaveReplyVoiceInput = z.infer<typeof saveReplyVoiceInputSchema>
export type SaveReplyTemplateInput = z.infer<typeof saveReplyTemplateInputSchema>
export type SetReplyTemplateHiddenInput = z.infer<
  typeof setReplyTemplateHiddenInputSchema
>
export type ResetReplyTemplateInput = z.infer<typeof resetReplyTemplateInputSchema>
export type CheckReplyDraftInput = z.infer<typeof checkReplyDraftInputSchema>
export type ReplyTemplateLanguageTarget = z.infer<
  typeof replyTemplateLanguageTargetSchema
>
export type ListReplyTemplatesInput = z.infer<typeof listReplyTemplatesInputSchema>
export type LoadReplyTemplateInput = z.infer<typeof loadReplyTemplateInputSchema>

export type ReplyDraftCheckDto = Readonly<{
  blocks: readonly Finding[]
  warnings: readonly Finding[]
  maxSimilarity: number
  similar: boolean
}>

export type ReplyTemplateListItemDto = Readonly<{
  id: ReplyLibraryRef
  ref: ReplyLibraryRef
  title: string
  aspect: null
  openLabel: string | null
  languageTag: string
  version: number
  layer: 'builtin' | 'account' | 'property'
}>

export type ReplyTemplateListResultDto = Readonly<{
  profile: null
  groups: readonly Readonly<{
    languageGroup: ReplyTemplateLanguageGroup
    templates: readonly ReplyTemplateListItemDto[]
  }>[]
  recommendedTemplateId: ReplyLibraryRef | null
  recommendedReason: string | null
}>

export type LoadedReplyTemplateDto = Reply &
  Readonly<{
    duplicateCheck: ReplyDraftCheckDto
    hasAlternativeWording: boolean
  }>

export type ReplyLibraryTemplateDto = Readonly<{
  ref: ReplyLibraryRef
  layer: 'builtin' | 'account' | 'property'
  revision: number
  title: string
  starsMin: number
  starsMax: number
  reviewKind: 'text' | 'rating_only'
  topic: ReviewTopicV3 | null
  essential: boolean
  wordings: Readonly<
    Partial<
      Record<
        ReplyTemplateLanguageGroup,
        readonly Readonly<{ key: string; body: string }>[]
      >
    >
  >
  status: 'builtin' | 'customized' | 'yours' | 'hidden'
  baseChanged: boolean
}>

export type ReplyLibraryDto = Readonly<{
  voice: ResolvedReplyVoice
  voiceVersion: Readonly<{ account: number; property: number }>
  templates: readonly ReplyLibraryTemplateDto[]
  supportedLanguages: readonly ReplyTemplateLanguageGroup[]
  /** Only `getReplyLibrary` sets it: whether the caller may change the library. */
  canManage?: boolean
}>
