import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  scanAiReplyOutput,
} from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'
import { parseCanonicalReplyLanguageTag } from './ai-review-language-catalogue'
import {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  personalizedReplyDraftOutputSchema,
  type PersonalizedReplyDraft,
  type PersonalizedReplyTone,
} from './ai-personalized-reply-profile'

export {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  type PersonalizedReplyDraft,
  type PersonalizedReplyTone,
} from './ai-personalized-reply-profile'

export type PersonalizedReplyDraftInput = Readonly<{
  reviewText: string
  rating: 1 | 2 | 3 | 4 | 5
  targetLanguageTag: string
  tone: PersonalizedReplyTone
  countryCode: string
  brandDisplayName: string
  output: unknown
}>

export type PersonalizedReplyDraftResult =
  | Readonly<{
      status: 'accepted'
      profileVersion: typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION
      draft: PersonalizedReplyDraft
    }>
  | Readonly<{
      status: 'rejected'
      reason: 'shape' | 'language' | 'grounding' | 'brand' | 'prohibited_content'
    }>

const PROHIBITED_REPLY_PATTERNS = Object.freeze([
  // Compensation, pricing, or commitments that the Review cannot authorize.
  /\b(?:refund|reimburse|compensat\w*|free\s+(?:stay|night|meal|upgrade)|guarantee\w*|promise\w*)\b/iu,
  // Admissions or legal conclusions.
  /\b(?:liable|liability|admit\w*\s+(?:fault|liability)|our\s+fault|at\s+fault)\b/iu,
  // Bulgarian equivalents of compensation, promises, and admissions.
  /(?:обезщет\w*|възстанов\w*\s+(?:сум\w*|пар\w*)|безплат\w*\s+(?:нощув\w*|престой|хран\w*)|гарантирам\w*|обещав\w*|признав\w*\s+вин\w*)/iu,
] as const)

const PROFILE_MANIFEST = Object.freeze({
  version: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  languages: AI_PERSONALIZED_REPLY_LANGUAGES,
  tones: Object.freeze(['professional', 'friendly', 'casual'] as const),
  grounding: Object.freeze({
    min: 1,
    max: 3,
    exactSourceExcerpt: true,
    selfQuoteContentWordsMustAppearInReply: true,
    selfQuoteContentWordMinimumLength: 3,
  }),
  brandGrounding: Object.freeze({
    publicDisplayNameRequired: true,
    foldedComparison: true,
    repetitionAllowed: true,
    exemptFromOutputLeakageScan: true,
  }),
  replyText: Object.freeze({ min: 24, max: 1_200 }),
  outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  structuredMarkerDetectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  prohibitedPatternCount: PROHIBITED_REPLY_PATTERNS.length,
})

export const AI_PERSONALIZED_REPLY_PROFILE_DIGEST = createHash('sha256')
  .update('repkey-personalized-reply-profile-v1\0', 'utf8')
  .update(canonicalizeRfc8785(PROFILE_MANIFEST), 'utf8')
  .digest('hex')

/**
 * Case-, form- and typography-insensitive comparison key.
 *
 * NFKC and locale-independent lowercasing are not enough on their own: NFKC
 * leaves U+2019 (`’`) distinct from `'` and leaves line breaks intact, so a
 * model re-quoting a guest who typed `I’m` as `I'm`, or flattening a quote that
 * spanned a newline, failed the source-excerpt check. 4 of the 20 real reviews
 * on the beta property carry U+2019 and one carries both hazards in a single
 * 44-character sentence. Neither shape is a hallucination, which is the only
 * thing that check exists to catch.
 */
function folded(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\u2018\u2019\u201b\u2032]/gu, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
}

function supportedLanguageGroup(tag: string): 'en-Latn' | 'bg-Cyrl' | null {
  const parsed = parseCanonicalReplyLanguageTag(tag)
  if (parsed?.templateGroup === 'en-Latn') return 'en-Latn'
  if (parsed?.templateGroup === 'bg-Cyrl') return 'bg-Cyrl'
  return null
}

/**
 * The two sides of a grounding pair carry different weight, so they are
 * checked differently.
 *
 * `sourceExcerpt` is the anti-hallucination anchor and stays byte-exact
 * (folded) against the redacted review: a reply may not assert words the guest
 * never wrote.
 *
 * `replyExcerpt` only labels which part of the model's *own* reply that source
 * supports. Models re-quote themselves loosely - measured against a real
 * Bulgarian review, byte-exact self-quoting refused 6 of 8 live drafts: one
 * differed by a single character (`мнение.` vs `мнение!`), another compressed
 * its own sentence (`Благодарим Ви за препоръката!` for a reply reading
 * `Благодарим Ви за високата оценка и препоръката!`). Neither is a grounding
 * failure - the quoted source was exact in both, and a third swapped one
 * pronoun (`услугите ни` for a reply reading `услугите на KODES agency`).
 * The reply side therefore matches on content words - tokens of three
 * characters or more - so grammar drift, word order and punctuation cannot
 * fail a draft, while an excerpt carrying nouns or verbs the reply never used
 * is still refused.
 */
const CONTENT_WORD_MINIMUM_LENGTH = 3

function contentWords(value: string): string[] {
  return folded(value)
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length >= CONTENT_WORD_MINIMUM_LENGTH)
}

function contentWordsOccurInReply(
  replyCounts: Map<string, number>,
  excerpt: string,
): boolean {
  const needed = new Map<string, number>()
  for (const token of contentWords(excerpt)) {
    needed.set(token, (needed.get(token) ?? 0) + 1)
  }
  if (needed.size === 0) return false
  for (const [token, count] of needed) {
    if ((replyCounts.get(token) ?? 0) < count) return false
  }
  return true
}

function hasValidGrounding(reviewText: string, draft: PersonalizedReplyDraft): boolean {
  const source = folded(reviewText)
  const replyCounts = new Map<string, number>()
  for (const token of contentWords(draft.replyText)) {
    replyCounts.set(token, (replyCounts.get(token) ?? 0) + 1)
  }
  const seen = new Set<string>()
  for (const item of draft.grounding) {
    const sourceExcerpt = folded(item.sourceExcerpt)
    const key = `${sourceExcerpt}\0${folded(item.replyExcerpt)}`
    if (
      seen.has(key) ||
      !source.includes(sourceExcerpt) ||
      !contentWordsOccurInReply(replyCounts, item.replyExcerpt)
    ) {
      return false
    }
    seen.add(key)
  }
  return true
}

/**
 * The reply has to carry the property's approved public display name, because
 * that is the identity the merchant notice promises guests will see.
 *
 * It used to have to carry it byte-exactly and exactly once. Both halves cost
 * real drafts. Byte-exact: the prompt tells the model to ground itself in the
 * guest's words, and of the four real reviews on the beta property that name
 * the business, three spell it `Kodes` or `kodes` rather than `KODES agency`,
 * so following the prompt failed the validator. Exactly once: a reply that
 * opens with the business name and signs off with it - the most natural
 * hospitality shape there is - was refused for being more on-brand than
 * required. Neither is a safety property; the name is present either way, and a
 * human approves every reply before it reaches Google.
 */
function usesPublicDisplayName(replyText: string, brandDisplayName: string): boolean {
  const brand = folded(brandDisplayName)
  return brand.length > 0 && folded(replyText).includes(brand)
}

/**
 * Blank out the approved display name before the leakage scan.
 *
 * The scanner refuses digits and symbols outright, and the brand check above
 * *requires* the display name to appear - so a property legitimately named
 * `Hotel 5` or `Café & Bar` made the two rules mutually unsatisfiable and every
 * AI draft for it impossible. The approved name is reviewed Brand Profile data,
 * not model-invented content, so it is exempt by the same reasoning that admits
 * it into the reply at all.
 */
function withoutBrandDisplayName(replyText: string, brandDisplayName: string): string {
  if (brandDisplayName.length === 0) return replyText
  return replyText.split(brandDisplayName).join(' ')
}

function containsProhibitedContent(
  replyText: string,
  countryCode: string,
  brandDisplayName: string,
): boolean {
  const scanned = withoutBrandDisplayName(replyText, brandDisplayName)
  if (PROHIBITED_REPLY_PATTERNS.some((pattern) => pattern.test(scanned))) return true
  return (
    scanAiReplyOutput({
      text: scanned,
      countryCode,
      expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
    }) !== 'safe'
  )
}

/**
 * Validate provider output before it can enter the browser's ephemeral reply
 * draft. The validator accepts only English/Bulgarian, requires bidirectional
 * source/reply evidence, and refuses unsafe commitments or structured/private
 * material. It does not persist the suggestion.
 */
export function parsePersonalizedReplyDraft(
  input: PersonalizedReplyDraftInput,
): PersonalizedReplyDraftResult {
  const parsed = personalizedReplyDraftOutputSchema.safeParse(input.output)
  if (!parsed.success) return { status: 'rejected', reason: 'shape' }

  const targetGroup = supportedLanguageGroup(input.targetLanguageTag)
  const outputGroup = supportedLanguageGroup(parsed.data.languageCode)
  if (targetGroup === null || outputGroup === null || targetGroup !== outputGroup) {
    return { status: 'rejected', reason: 'language' }
  }
  if (!hasValidGrounding(input.reviewText, parsed.data)) {
    return { status: 'rejected', reason: 'grounding' }
  }
  if (!usesPublicDisplayName(parsed.data.replyText, input.brandDisplayName)) {
    return { status: 'rejected', reason: 'brand' }
  }
  if (
    containsProhibitedContent(
      parsed.data.replyText,
      input.countryCode,
      input.brandDisplayName,
    )
  ) {
    return { status: 'rejected', reason: 'prohibited_content' }
  }
  return {
    status: 'accepted',
    profileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
    draft: parsed.data,
  }
}
