import { canonicalizeRfc8785 } from '../canonical-json'
import { createErrorFactory } from '../domain/errors'
import { sha256Hex } from '../domain/sha256'
import { replyCommentProblem } from '../google-provider-control/reply-comment'
import type { BuiltinReplyVoiceLanguageGroup } from './reply-voice-language-groups'
import { firstNameForGreeting } from './reviewer-first-name'
import { replyBand, type ResolvedReplyVoice } from './reply-voice'

export type ReplyRotationChoices = Readonly<{
  closing: number
  signOff: number
  contactSentence: number
  emoji: number
  includeContact?: boolean
}>

export type RenderReplyInput = Readonly<{
  body: string
  voice: ResolvedReplyVoice
  languageGroup: BuiltinReplyVoiceLanguageGroup
  rating: number
  hasText: boolean
  reviewerDisplayName: string | null
  propertyDisplayName: string
  choices: ReplyRotationChoices
}>

export type RenderReplyResult = Readonly<{
  text: string
  voiceDigest: string
  choices: Readonly<Required<ReplyRotationChoices>>
}>

export type ReplyRenderError = Readonly<{
  _tag: 'ReplyRenderError'
  code: 'too_long' | 'invalid_character'
  message: string
}>

const replyRenderError = createErrorFactory<
  ReplyRenderError['_tag'],
  ReplyRenderError['code']
>('ReplyRenderError')

export function isReplyRenderError(error: unknown): error is Error & ReplyRenderError {
  return (
    error instanceof Error &&
    '_tag' in error &&
    (error as { _tag?: unknown })._tag === 'ReplyRenderError'
  )
}

function normalizedIndex(index: number, length: number): number {
  if (length === 0) return 0
  const integer = Number.isFinite(index) ? Math.trunc(index) : 0
  return ((integer % length) + length) % length
}

function pick(
  values: readonly string[],
  index: number,
): Readonly<{ text: string; index: number }> {
  const chosen = normalizedIndex(index, values.length)
  return { text: values[chosen] ?? '', index: chosen }
}

function replace(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replaceAll(/\{([a-z_]+)\}/gu, (token, name: string) =>
    Object.hasOwn(variables, name) ? variables[name]! : token,
  )
}

function materialVoice(
  voice: ResolvedReplyVoice,
  languageGroup: BuiltinReplyVoiceLanguageGroup,
) {
  const locale = voice.localized[languageGroup]
  return {
    languageGroup,
    useFirstName: voice.useFirstName.value,
    privacyMode: voice.privacyMode.value,
    greetingStyle: voice.greetingStyle.value,
    contact: voice.contact.value?.trim() || null,
    emojiMode: voice.emojiMode.value,
    emojiSet: voice.emojiSet.value,
    signerName: voice.signerName.value,
    signerTitle: voice.signerTitle.value,
    businessNameShort: voice.businessNameShort.value,
    visitWordKey: voice.visitWordKey.value,
    localized: {
      greeting: locale.greeting,
      closings: {
        positiveText: locale.closings.positiveText.value,
        positiveRatingOnly: locale.closings.positiveRatingOnly.value,
        threeStar: locale.closings.threeStar.value,
        negative: locale.closings.negative.value,
      },
      contactSentences: locale.contactSentences.value,
      signOffWords: {
        positive: locale.signOffWords.positive.value,
        negative: locale.signOffWords.negative.value,
      },
      signer: locale.signer,
      visitWords: locale.visitWords,
    },
  }
}

export function digestResolvedReplyVoice(
  voice: ResolvedReplyVoice,
  languageGroup: BuiltinReplyVoiceLanguageGroup,
): string {
  return sha256Hex(
    `repkey-resolved-reply-voice\0${canonicalizeRfc8785(materialVoice(voice, languageGroup))}`,
  )
}

function greetingFor(input: RenderReplyInput, firstName: string | null): string {
  const locale = input.voice.localized[input.languageGroup]
  if (
    firstName === null ||
    !input.voice.useFirstName.value ||
    input.voice.privacyMode.value
  ) {
    return locale.greeting.fallback
  }
  const style =
    input.rating >= 4
      ? input.voice.greetingStyle.value.positive
      : input.voice.greetingStyle.value.negative
  const template =
    style === 'hi'
      ? locale.greeting.positive
      : style === 'hello'
        ? locale.greeting.negative
        : locale.greeting.formal
  return replace(template, { first_name: firstName })
}

// fallow-ignore-next-line complexity -- exhaustive optional voice slots are assembled in one deterministic render pass
export function renderReply(input: RenderReplyInput): RenderReplyResult {
  const locale = input.voice.localized[input.languageGroup]
  const band = replyBand(input.rating, input.hasText)
  const businessName =
    input.voice.businessNameShort.value?.trim() || input.propertyDisplayName.trim()
  // Privacy mode never names the visit as an appointment or session.
  const visitWordKey = input.voice.privacyMode.value
    ? 'visit'
    : input.voice.visitWordKey.value
  const visitWord =
    locale.visitWords[visitWordKey] ?? locale.visitWords.visit ?? visitWordKey
  const variables: Record<string, string> = {
    business_name: businessName,
    contact: input.voice.contact.value?.trim() ?? '',
    signer_name: input.voice.signerName.value ?? '',
    signer_title: input.voice.signerTitle.value ?? '',
    visit_word: visitWord,
  }

  const closing = pick(locale.closings[band].value, input.choices.closing)
  const positive = input.rating >= 4
  const signOff = pick(
    locale.signOffWords[positive ? 'positive' : 'negative'].value,
    input.choices.signOff,
  )
  const contactSentence = pick(
    locale.contactSentences.value,
    input.choices.contactSentence,
  )
  const emoji = pick(input.voice.emojiSet.value, input.choices.emoji)
  const includeContact = input.choices.includeContact ?? true
  const shouldContact =
    Boolean(input.voice.contact.value?.trim()) &&
    (input.rating <= 2 || (input.rating === 3 && includeContact))
  const firstName = firstNameForGreeting(input.reviewerDisplayName, input.languageGroup)

  const sections = [greetingFor(input, firstName), replace(input.body.trim(), variables)]
  if (shouldContact && contactSentence.text.trim()) {
    sections.push(replace(contactSentence.text.trim(), variables))
  }
  if (closing.text.trim()) {
    const suffix =
      positive &&
      input.voice.emojiMode.value === 'positive' &&
      emoji.text.trim().length > 0
        ? ` ${emoji.text.trim()}`
        : ''
    sections.push(`${replace(closing.text.trim(), variables)}${suffix}`)
  }

  let signer: string
  if (positive) {
    signer = replace(locale.signer.positive, variables)
  } else if (input.voice.signerName.value?.trim()) {
    signer = input.voice.signerTitle.value?.trim()
      ? `${input.voice.signerName.value.trim()}, ${input.voice.signerTitle.value.trim()}`
      : input.voice.signerName.value.trim()
  } else {
    signer = replace(locale.signer.negativeFallback, variables)
  }
  const signature = [replace(signOff.text.trim(), variables), signer.trim()]
    .filter(Boolean)
    .join('\n')
  if (signature) sections.push(signature)

  const text = sections.filter((section) => section.trim().length > 0).join('\n\n')
  const problem = replyCommentProblem(text)
  if (problem !== null) {
    throw replyRenderError(
      problem === 'too_long' ? 'too_long' : 'invalid_character',
      problem === 'too_long'
        ? 'Rendered reply must be 4,096 UTF-8 bytes or fewer.'
        : 'Rendered reply contains text Google does not accept.',
    )
  }

  return {
    text,
    voiceDigest: digestResolvedReplyVoice(input.voice, input.languageGroup),
    choices: {
      closing: closing.index,
      signOff: signOff.index,
      contactSentence: contactSentence.index,
      emoji: emoji.index,
      includeContact,
    },
  }
}
