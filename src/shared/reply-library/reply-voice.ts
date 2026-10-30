import { BUILTIN_REPLY_LIBRARY, type BuiltinReplyLibrary } from './builtin-library'
import {
  BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS,
  type BuiltinReplyVoiceLanguageGroup,
} from './reply-voice-language-groups'

export type ReplyVoiceSource = 'builtin' | 'account' | 'property'
export type GreetingStyle = 'hi' | 'hello' | 'dear'
export type EmojiMode = 'off' | 'positive'
export type ReplyBand = 'positiveText' | 'positiveRatingOnly' | 'threeStar' | 'negative'

export type ReplyVoiceSettings = Readonly<{
  useFirstName: boolean
  privacyMode: boolean
  greetingStyle: Readonly<{ positive: GreetingStyle; negative: GreetingStyle }>
  contact: string | null
  emojiMode: EmojiMode
  emojiSet: readonly string[]
  signerName: string | null
  signerTitle: string | null
  businessNameShort: string | null
  visitWordKey: string
}>

export const DEFAULT_REPLY_VOICE_SETTINGS: ReplyVoiceSettings = Object.freeze({
  useFirstName: true,
  privacyMode: false,
  greetingStyle: Object.freeze({ positive: 'hi', negative: 'hello' }),
  contact: null,
  emojiMode: 'off',
  emojiSet: Object.freeze([]),
  signerName: null,
  signerTitle: null,
  businessNameShort: null,
  visitWordKey: 'visit',
})

export type ReplyVoiceField = keyof ReplyVoiceSettings
export type LocalizedReplyVoiceOverride = Readonly<{
  closings?: Partial<Record<ReplyBand, readonly string[]>>
  contactSentences?: readonly string[]
  signOffWords?: Partial<Record<'positive' | 'negative', readonly string[]>>
}>

export type ReplyVoiceOverride = Partial<ReplyVoiceSettings> &
  Readonly<{
    overriddenFields: readonly ReplyVoiceField[]
    localized?: Partial<
      Record<BuiltinReplyVoiceLanguageGroup, LocalizedReplyVoiceOverride>
    >
  }>

export type BuiltinReplyVoice = Readonly<{
  settings: ReplyVoiceSettings
  localized: BuiltinReplyLibrary['voice']
}>

export const BUILTIN_REPLY_VOICE: BuiltinReplyVoice = Object.freeze({
  settings: DEFAULT_REPLY_VOICE_SETTINGS,
  localized: BUILTIN_REPLY_LIBRARY.voice,
})

export type ResolvedVoiceField<T> = Readonly<{ value: T; source: ReplyVoiceSource }>
type ResolvedSettings = {
  readonly [Field in ReplyVoiceField]: ResolvedVoiceField<ReplyVoiceSettings[Field]>
}

export type ResolvedLocalizedReplyVoice = Readonly<{
  greeting: BuiltinReplyLibrary['voice'][BuiltinReplyVoiceLanguageGroup]['greeting']
  closings: { readonly [Band in ReplyBand]: ResolvedVoiceField<readonly string[]> }
  contactSentences: ResolvedVoiceField<readonly string[]>
  signOffWords: {
    readonly positive: ResolvedVoiceField<readonly string[]>
    readonly negative: ResolvedVoiceField<readonly string[]>
  }
  signer: BuiltinReplyLibrary['voice'][BuiltinReplyVoiceLanguageGroup]['signer']
  visitWords: BuiltinReplyLibrary['voice'][BuiltinReplyVoiceLanguageGroup]['visitWords']
}>

export type ResolvedReplyVoice = ResolvedSettings &
  Readonly<{
    localized: Readonly<
      Record<BuiltinReplyVoiceLanguageGroup, ResolvedLocalizedReplyVoice>
    >
  }>

function owns(value: object | undefined, key: PropertyKey): boolean {
  return value !== undefined && Object.hasOwn(value, key)
}

function resolveSetting<Field extends ReplyVoiceField>(
  field: Field,
  builtin: ReplyVoiceSettings,
  account: ReplyVoiceOverride | null,
  property: ReplyVoiceOverride | null,
): ResolvedVoiceField<ReplyVoiceSettings[Field]> {
  if (property?.overriddenFields.includes(field) && owns(property, field)) {
    return { value: property[field] as ReplyVoiceSettings[Field], source: 'property' }
  }
  if (account?.overriddenFields.includes(field) && owns(account, field)) {
    return { value: account[field] as ReplyVoiceSettings[Field], source: 'account' }
  }
  return { value: builtin[field], source: 'builtin' }
}

function resolveLocalizedValue<T>(
  key: string,
  builtin: T,
  account: Record<string, unknown> | undefined,
  property: Record<string, unknown> | undefined,
): ResolvedVoiceField<T> {
  if (owns(property, key)) return { value: property![key] as T, source: 'property' }
  if (owns(account, key)) return { value: account![key] as T, source: 'account' }
  return { value: builtin, source: 'builtin' }
}

function localizedVoice(
  language: BuiltinReplyVoiceLanguageGroup,
  builtin: BuiltinReplyVoice,
  account: ReplyVoiceOverride | null,
  property: ReplyVoiceOverride | null,
): ResolvedLocalizedReplyVoice {
  const base = builtin.localized[language]
  const accountLocale = account?.localized?.[language]
  const propertyLocale = property?.localized?.[language]
  const accountClosings = accountLocale?.closings as Record<string, unknown> | undefined
  const propertyClosings = propertyLocale?.closings as Record<string, unknown> | undefined
  const accountSignOff = accountLocale?.signOffWords as
    Record<string, unknown> | undefined
  const propertySignOff = propertyLocale?.signOffWords as
    Record<string, unknown> | undefined

  return {
    greeting: base.greeting,
    closings: {
      positiveText: resolveLocalizedValue(
        'positiveText',
        base.closings.positiveText,
        accountClosings,
        propertyClosings,
      ),
      positiveRatingOnly: resolveLocalizedValue(
        'positiveRatingOnly',
        base.closings.positiveRatingOnly,
        accountClosings,
        propertyClosings,
      ),
      threeStar: resolveLocalizedValue(
        'threeStar',
        base.closings.threeStar,
        accountClosings,
        propertyClosings,
      ),
      negative: resolveLocalizedValue(
        'negative',
        base.closings.negative,
        accountClosings,
        propertyClosings,
      ),
    },
    contactSentences: resolveLocalizedValue(
      'contactSentences',
      base.contactSentences,
      accountLocale as Record<string, unknown> | undefined,
      propertyLocale as Record<string, unknown> | undefined,
    ),
    signOffWords: {
      positive: resolveLocalizedValue(
        'positive',
        base.signOffWords.positive,
        accountSignOff,
        propertySignOff,
      ),
      negative: resolveLocalizedValue(
        'negative',
        base.signOffWords.negative,
        accountSignOff,
        propertySignOff,
      ),
    },
    signer: base.signer,
    visitWords: base.visitWords,
  }
}

export function resolveVoice(
  builtin: BuiltinReplyVoice,
  account: ReplyVoiceOverride | null,
  property: ReplyVoiceOverride | null,
): ResolvedReplyVoice {
  return {
    useFirstName: resolveSetting('useFirstName', builtin.settings, account, property),
    privacyMode: resolveSetting('privacyMode', builtin.settings, account, property),
    greetingStyle: resolveSetting('greetingStyle', builtin.settings, account, property),
    contact: resolveSetting('contact', builtin.settings, account, property),
    emojiMode: resolveSetting('emojiMode', builtin.settings, account, property),
    emojiSet: resolveSetting('emojiSet', builtin.settings, account, property),
    signerName: resolveSetting('signerName', builtin.settings, account, property),
    signerTitle: resolveSetting('signerTitle', builtin.settings, account, property),
    businessNameShort: resolveSetting(
      'businessNameShort',
      builtin.settings,
      account,
      property,
    ),
    visitWordKey: resolveSetting('visitWordKey', builtin.settings, account, property),
    localized: Object.fromEntries(
      BUILTIN_REPLY_VOICE_LANGUAGE_GROUPS.map((language) => [
        language,
        localizedVoice(language, builtin, account, property),
      ]),
    ) as Record<BuiltinReplyVoiceLanguageGroup, ResolvedLocalizedReplyVoice>,
  }
}

export function replyBand(rating: number, hasText: boolean): ReplyBand {
  if (rating >= 4) return hasText ? 'positiveText' : 'positiveRatingOnly'
  if (rating === 3) return 'threeStar'
  return 'negative'
}
