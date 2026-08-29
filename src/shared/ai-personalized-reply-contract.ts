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
  grounding: Object.freeze({ min: 1, max: 3, exactSourceExcerpt: true }),
  brandGrounding: Object.freeze({ exactPublicDisplayNameRequired: true }),
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

function folded(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und')
}

function supportedLanguageGroup(tag: string): 'en-Latn' | 'bg-Cyrl' | null {
  const parsed = parseCanonicalReplyLanguageTag(tag)
  if (parsed?.templateGroup === 'en-Latn') return 'en-Latn'
  if (parsed?.templateGroup === 'bg-Cyrl') return 'bg-Cyrl'
  return null
}

function hasValidGrounding(reviewText: string, draft: PersonalizedReplyDraft): boolean {
  const source = folded(reviewText)
  const reply = folded(draft.replyText)
  const seen = new Set<string>()
  for (const item of draft.grounding) {
    const sourceExcerpt = folded(item.sourceExcerpt)
    const replyExcerpt = folded(item.replyExcerpt)
    const key = `${sourceExcerpt}\0${replyExcerpt}`
    if (
      seen.has(key) ||
      !source.includes(sourceExcerpt) ||
      !reply.includes(replyExcerpt)
    ) {
      return false
    }
    seen.add(key)
  }
  return true
}

function usesExactPublicDisplayNameOnce(
  replyText: string,
  brandDisplayName: string,
): boolean {
  if (brandDisplayName.length === 0) return false
  const first = replyText.indexOf(brandDisplayName)
  return first >= 0 && replyText.indexOf(brandDisplayName, first + 1) === -1
}

function containsProhibitedContent(replyText: string, countryCode: string): boolean {
  if (PROHIBITED_REPLY_PATTERNS.some((pattern) => pattern.test(replyText))) return true
  return (
    scanAiReplyOutput({
      text: replyText,
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
  if (!usesExactPublicDisplayNameOnce(parsed.data.replyText, input.brandDisplayName)) {
    return { status: 'rejected', reason: 'brand' }
  }
  if (containsProhibitedContent(parsed.data.replyText, input.countryCode)) {
    return { status: 'rejected', reason: 'prohibited_content' }
  }
  return {
    status: 'accepted',
    profileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
    draft: parsed.data,
  }
}
