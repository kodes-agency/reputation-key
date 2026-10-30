import type {
  ReplyLibraryDto,
  SaveReplyVoiceInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import type {
  ReplyVoiceField,
  ReplyVoiceSettings,
  ResolvedReplyVoice,
} from '#/shared/reply-library/reply-voice'

export type VoiceLanguage = 'en-Latn' | 'es-Latn'
export type VoiceListKey =
  | 'positiveText'
  | 'positiveRatingOnly'
  | 'threeStar'
  | 'negative'
  | 'contactSentences'
  | 'positiveSignOff'
  | 'negativeSignOff'

export type VoiceDraft = Readonly<{
  useFirstName: boolean
  privacyMode: boolean
  positiveGreeting: 'hi' | 'hello' | 'dear'
  negativeGreeting: 'hi' | 'hello' | 'dear'
  businessName: string
  signerName: string
  signerTitle: string
  contact: string
  emojiMode: 'off' | 'positive'
  emojiSet: string
  visitWordKey: string
  language: VoiceLanguage
  lists: Record<VoiceLanguage, Record<VoiceListKey, string>>
}>

export const GREETINGS = [
  { value: 'hi', label: 'Hi' },
  { value: 'hello', label: 'Hello' },
  { value: 'dear', label: 'Dear' },
] as const

export const WORDING_LISTS: readonly Readonly<{
  key: VoiceListKey
  label: string
}>[] = [
  { key: 'positiveText', label: 'Closings for 4–5 stars with text' },
  { key: 'positiveRatingOnly', label: 'Closings for 4–5 stars without text' },
  { key: 'threeStar', label: 'Closings for 3 stars' },
  { key: 'negative', label: 'Closings for 1–2 stars' },
  { key: 'contactSentences', label: 'Contact sentences' },
  { key: 'positiveSignOff', label: 'Positive sign-off words' },
  { key: 'negativeSignOff', label: 'Negative sign-off words' },
]

const lines = (values: readonly string[]) => values.join('\n')

export function initialVoiceDraft(voice: ResolvedReplyVoice): VoiceDraft {
  const lists = Object.fromEntries(
    (['en-Latn', 'es-Latn'] as const).map((language) => {
      const locale = voice.localized[language]
      return [
        language,
        {
          positiveText: lines(locale.closings.positiveText.value),
          positiveRatingOnly: lines(locale.closings.positiveRatingOnly.value),
          threeStar: lines(locale.closings.threeStar.value),
          negative: lines(locale.closings.negative.value),
          contactSentences: lines(locale.contactSentences.value),
          positiveSignOff: lines(locale.signOffWords.positive.value),
          negativeSignOff: lines(locale.signOffWords.negative.value),
        },
      ]
    }),
  ) as VoiceDraft['lists']
  return {
    useFirstName: voice.useFirstName.value,
    privacyMode: voice.privacyMode.value,
    positiveGreeting: voice.greetingStyle.value.positive,
    negativeGreeting: voice.greetingStyle.value.negative,
    businessName: voice.businessNameShort.value ?? '',
    signerName: voice.signerName.value ?? '',
    signerTitle: voice.signerTitle.value ?? '',
    contact: voice.contact.value ?? '',
    emojiMode: voice.emojiMode.value,
    emojiSet: voice.emojiSet.value.join(' '),
    visitWordKey: voice.visitWordKey.value,
    language: 'en-Latn',
    lists,
  }
}

function parsedVoiceLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parsedEmojiSet(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean)
}

export function voiceDraftChanged(draft: VoiceDraft, saved: VoiceDraft): boolean {
  return JSON.stringify({ ...draft, language: saved.language }) !== JSON.stringify(saved)
}

export function emojiSetTooLarge(value: string): boolean {
  return parsedEmojiSet(value).length > 5
}

export function resolveDraftVoice(
  base: ResolvedReplyVoice,
  draft: VoiceDraft,
): ResolvedReplyVoice {
  const value = <T>(next: T) => ({ value: next, source: 'property' as const })
  const localized = Object.fromEntries(
    Object.entries(base.localized).map(([language, locale]) => {
      const lists = draft.lists[language as VoiceLanguage]
      if (!lists) return [language, locale]
      return [
        language,
        {
          ...locale,
          closings: {
            positiveText: value(parsedVoiceLines(lists.positiveText)),
            positiveRatingOnly: value(parsedVoiceLines(lists.positiveRatingOnly)),
            threeStar: value(parsedVoiceLines(lists.threeStar)),
            negative: value(parsedVoiceLines(lists.negative)),
          },
          contactSentences: value(parsedVoiceLines(lists.contactSentences)),
          signOffWords: {
            positive: value(parsedVoiceLines(lists.positiveSignOff)),
            negative: value(parsedVoiceLines(lists.negativeSignOff)),
          },
        },
      ]
    }),
  ) as ResolvedReplyVoice['localized']
  return {
    ...base,
    useFirstName: value(draft.useFirstName),
    privacyMode: value(draft.privacyMode),
    greetingStyle: value({
      positive: draft.positiveGreeting,
      negative: draft.negativeGreeting,
    }),
    businessNameShort: value(draft.businessName.trim() || null),
    signerName: value(draft.signerName.trim() || null),
    signerTitle: value(draft.signerTitle.trim() || null),
    contact: value(draft.contact.trim() || null),
    emojiMode: value(draft.emojiMode),
    emojiSet: value(draft.emojiSet.trim().split(/\s+/u).filter(Boolean).slice(0, 5)),
    visitWordKey: value(draft.visitWordKey),
    localized,
  }
}

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

type VoiceLocaleChange = NonNullable<
  NonNullable<SaveReplyVoiceInput['localized']>[VoiceLanguage]
>

function changedLines(next: string, previous: string): string[] | undefined {
  return same(next, previous) ? undefined : parsedVoiceLines(next)
}

function localizedLanguageChanges(
  next: VoiceDraft['lists'][VoiceLanguage],
  previous: VoiceDraft['lists'][VoiceLanguage],
): VoiceLocaleChange | undefined {
  const positiveText = changedLines(next.positiveText, previous.positiveText)
  const positiveRatingOnly = changedLines(
    next.positiveRatingOnly,
    previous.positiveRatingOnly,
  )
  const threeStar = changedLines(next.threeStar, previous.threeStar)
  const negative = changedLines(next.negative, previous.negative)
  const positive = changedLines(next.positiveSignOff, previous.positiveSignOff)
  const negativeSignOff = changedLines(next.negativeSignOff, previous.negativeSignOff)
  const contactSentences = changedLines(next.contactSentences, previous.contactSentences)
  const closings = {
    ...(positiveText ? { positiveText } : {}),
    ...(positiveRatingOnly ? { positiveRatingOnly } : {}),
    ...(threeStar ? { threeStar } : {}),
    ...(negative ? { negative } : {}),
  }
  const signOffWords = {
    ...(positive ? { positive } : {}),
    ...(negativeSignOff ? { negative: negativeSignOff } : {}),
  }
  const locale: VoiceLocaleChange = {
    ...(Object.keys(closings).length > 0 ? { closings } : {}),
    ...(contactSentences ? { contactSentences } : {}),
    ...(Object.keys(signOffWords).length > 0 ? { signOffWords } : {}),
  }
  return Object.keys(locale).length > 0 ? locale : undefined
}

function localizedChanges(
  draft: VoiceDraft,
  saved: VoiceDraft,
): SaveReplyVoiceInput['localized'] {
  const changed: NonNullable<SaveReplyVoiceInput['localized']> = {}
  for (const language of ['en-Latn', 'es-Latn'] as const) {
    const locale = localizedLanguageChanges(draft.lists[language], saved.lists[language])
    if (locale) changed[language] = locale
  }
  return Object.keys(changed).length > 0 ? changed : undefined
}

function draftSettings(draft: VoiceDraft): ReplyVoiceSettings {
  const visitWordKey = (
    ['visit', 'stay', 'appointment', 'meal', 'trip', 'session'] as const
  ).find((word) => word === draft.visitWordKey)
  return {
    useFirstName: draft.useFirstName,
    privacyMode: draft.privacyMode,
    greetingStyle: {
      positive: draft.positiveGreeting,
      negative: draft.negativeGreeting,
    },
    businessNameShort: draft.businessName.trim() || null,
    signerName: draft.signerName.trim() || null,
    signerTitle: draft.signerTitle.trim() || null,
    contact: draft.contact.trim() || null,
    emojiMode: draft.emojiMode,
    emojiSet: parsedEmojiSet(draft.emojiSet),
    visitWordKey: visitWordKey ?? 'visit',
  }
}

export function voiceSaveInput(
  propertyId: string,
  scope: SaveReplyVoiceInput['scope'],
  draft: VoiceDraft,
  saved: VoiceDraft,
  library: ReplyLibraryDto,
): SaveReplyVoiceInput {
  const next = draftSettings(draft)
  const previous = draftSettings(saved)
  const set: SaveReplyVoiceInput['set'] = {}
  const reset: ReplyVoiceField[] = []
  const nullable = new Set<ReplyVoiceField>([
    'businessNameShort',
    'signerName',
    'signerTitle',
    'contact',
  ])
  for (const field of Object.keys(next) as ReplyVoiceField[]) {
    if (field === 'emojiSet' && next.emojiMode === 'off') continue
    if (same(next[field], previous[field])) continue
    // A cleared contact or signer is an explicit blank: at a property it must not
    // fall back to the account's value.
    ;(set as Record<ReplyVoiceField, unknown>)[field] = nullable.has(field)
      ? (next[field] ?? null)
      : next[field]
  }
  const localized = localizedChanges(draft, saved)
  return {
    propertyId,
    scope,
    set,
    reset,
    ...(localized ? { localized } : {}),
    expectedVersion:
      scope === 'property' ? library.voiceVersion.property : library.voiceVersion.account,
  }
}
