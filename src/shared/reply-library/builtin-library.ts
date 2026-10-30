import rawLibrary from './builtin-library-v1.json'
import { canonicalizeRfc8785 } from '../canonical-json'
import { sha256Hex } from '../domain/sha256'
import type { ReviewTopicV3 } from '../review-topic-taxonomy'
import type { BuiltinReplyVoiceLanguageGroup } from './reply-voice-language-groups'

export const BUILTIN_REPLY_LIBRARY_VERSION = 'reply-library-builtin-v1' as const
export const BUILTIN_REPLY_LIBRARY_VERSION_NUMBER = 1 as const
export type BuiltinReplyLanguageGroup = 'en-Latn' | 'es-Latn'

type BuiltinReplyVoice = Readonly<{
  greeting: Readonly<Record<'positive' | 'negative' | 'formal' | 'fallback', string>>
  closings: Readonly<
    Record<
      'positiveText' | 'positiveRatingOnly' | 'threeStar' | 'negative',
      readonly string[]
    >
  >
  contactSentences: readonly string[]
  signOffWords: Readonly<Record<'positive' | 'negative', readonly string[]>>
  signer: Readonly<Record<'positive' | 'negativeNamed' | 'negativeFallback', string>>
  visitWords: Readonly<Record<string, string>>
}>

export type BuiltinReplyTemplate = Readonly<{
  key: string
  group: string
  title: string
  essential: boolean
  starsMin: number
  starsMax: number
  reviewKind: 'text' | 'rating_only'
  topic: ReviewTopicV3 | null
  guidance: string | null
  wordings: readonly Readonly<{
    key: string
    text: Readonly<Record<BuiltinReplyLanguageGroup, string>>
  }>[]
}>

export type BuiltinReplyLibrary = Readonly<{
  version: typeof BUILTIN_REPLY_LIBRARY_VERSION
  source: string
  languages: Readonly<Record<BuiltinReplyLanguageGroup, string>>
  voice: Readonly<Record<BuiltinReplyVoiceLanguageGroup, BuiltinReplyVoice>>
  templates: readonly BuiltinReplyTemplate[]
}>

export const BUILTIN_REPLY_LIBRARY = Object.freeze(
  rawLibrary as unknown as BuiltinReplyLibrary,
)
export const BUILTIN_REPLY_LIBRARY_DIGEST = sha256Hex(
  `repkey-builtin-reply-library\0${canonicalizeRfc8785(BUILTIN_REPLY_LIBRARY)}`,
)
