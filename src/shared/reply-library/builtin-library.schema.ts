import { z } from 'zod/v4'
import { REVIEW_TOPICS_V3 } from '../review-topic-taxonomy'
import {
  BUILTIN_REPLY_LIBRARY_VERSION,
  type BuiltinReplyLibrary,
} from './builtin-library'
import { BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS } from './reply-voice-language-groups'

const languageSchema = z.enum(['en-Latn', 'es-Latn'])
const localizedStrings = z.record(languageSchema, z.string().min(1))
const voiceLanguageSchema = z
  .object({
    greeting: z
      .object({
        positive: z.string().min(1),
        negative: z.string().min(1),
        formal: z.string().min(1),
        fallback: z.string().min(1),
      })
      .strict(),
    closings: z
      .object({
        positiveText: z.array(z.string().min(1)).min(1),
        positiveRatingOnly: z.array(z.string().min(1)).min(1),
        threeStar: z.array(z.string().min(1)).min(1),
        negative: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    contactSentences: z.array(z.string().min(1)).min(1),
    signOffWords: z
      .object({
        positive: z.array(z.string().min(1)).min(1),
        negative: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    signer: z
      .object({
        positive: z.string().min(1),
        negativeNamed: z.string().min(1),
        negativeFallback: z.string().min(1),
      })
      .strict(),
    visitWords: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict()

const templateSchema = z
  .object({
    key: z.string().regex(/^[A-Z][A-Z0-9_-]*$/u),
    group: z.string().min(1),
    title: z.string().min(1),
    essential: z.boolean(),
    starsMin: z.number().int().min(1).max(5),
    starsMax: z.number().int().min(1).max(5),
    reviewKind: z.enum(['text', 'rating_only']),
    topic: z.enum(REVIEW_TOPICS_V3).nullable(),
    guidance: z.string().min(1).nullable(),
    wordings: z
      .array(z.object({ key: z.string().min(1), text: localizedStrings }).strict())
      .min(1),
  })
  .strict()
  .superRefine((template, ctx) => {
    if (template.starsMin > template.starsMax) {
      ctx.addIssue({ code: 'custom', path: ['starsMax'], message: 'Invalid star range' })
    }
    const keys = template.wordings.map(({ key }) => key)
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordings'],
        message: 'Duplicate wording key',
      })
    }
  })

const librarySchema = z
  .object({
    version: z.literal(BUILTIN_REPLY_LIBRARY_VERSION),
    source: z.string().min(1),
    languages: z.record(languageSchema, z.string().min(1)),
    voice: z.record(z.enum(BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS), voiceLanguageSchema),
    templates: z.array(templateSchema).min(1),
  })
  .strict()
  .superRefine((library, ctx) => {
    const keys = library.templates.map(({ key }) => key)
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['templates'],
        message: 'Duplicate template key',
      })
    }
  })

export function parseBuiltinReplyLibrary(value: unknown): BuiltinReplyLibrary {
  return librarySchema.parse(value) as BuiltinReplyLibrary
}
