import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './canonical-json'
import { parseCanonicalReplyLanguageTag } from './ai-review-language-catalogue'
import {
  hasProhibitedReplyCommitment,
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
} from './ai-personalized-reply-contract'
import {
  scanAiReplyOutput,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
} from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'
import {
  replyDraftingV2OutputSchema,
  REPLY_DRAFTING_V2_LANGUAGES,
  REPLY_DRAFTING_V2_VERSIONS,
  type ReplyDraftingV2Output,
} from './reply-drafting-v2-schema'
import {
  lintReplyDraftingV2Body,
  replyBodyFinding,
  REPLY_BODY_LINT_DIGEST,
  type Language,
  type ReplyBodyFinding,
} from './reply-drafting-v2-lint'

// Unicode word edges; accent folding admits accented and unaccented variants.
// Negation cannot authorize a compensation offer or admission either.
const SPANISH_COMMITMENTS =
  /(?<![\p{L}\p{N}])(?:reembols\p{L}*|devolucion(?:es)?\s+del\s+dinero|compensa\p{L}*|cupon\p{L}*|vale(?:s)?|descuent\p{L}*|garanti[zc]\p{L}*|promet\p{L}*|nuestra\s+culpa|asum\p{L}*\s+la\s+responsabilidad|es\s+responsabilidad\s+nuestra)(?![\p{L}\p{N}])/u
// At most two intervening words on a body bounded at 1200 characters.
const SPANISH_FREE =
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded intervening word count and literal compensation terms with Unicode word edges
  /(?<![\p{L}\p{N}])(?:(?:gratis|gratuit\p{L}*)\s+(?:\p{L}+\s+){0,2}(?:noche|estancia|comida|mejora)\p{L}*|(?:noche|estancia|comida|mejora)\p{L}*\s+(?:\p{L}+\s+){0,2}(?:gratis|gratuit\p{L}*))(?![\p{L}\p{N}])/u

export function hasSpanishReplyCommitment(text: string): boolean {
  const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return SPANISH_COMMITMENTS.test(folded) || SPANISH_FREE.test(folded)
}

export const REPLY_DRAFTING_V2_PROFILE_DIGEST = createHash('sha256')
  .update('repkey-personalized-reply-v4\0')
  .update(
    canonicalizeRfc8785({
      version: REPLY_DRAFTING_V2_VERSIONS.profile,
      languages: REPLY_DRAFTING_V2_LANGUAGES,
      historicalCommitmentAuthority: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
      spanish: [SPANISH_COMMITMENTS, SPANISH_FREE].map((p) => p.toString()),
      schema: {
        cases: [
          'praise',
          'praise_with_issue',
          'mixed',
          'complaint',
          'serious',
          'money',
          'unclear',
        ],
        mainPoint: [1, 2],
        avoidTerms: [0, 8, 2, 40],
        replyText: [24, 1200],
      },
      sentenceReferences: 'all-present',
      avoidance: 'accent-case-fold;word-edge-through-four;word-start-above',
      lint: REPLY_BODY_LINT_DIGEST,
      leakage: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
    }),
  )
  .digest('hex')

export type ReplyDraftingV2Acceptance =
  | Readonly<{
      status: 'accepted'
      draft: ReplyDraftingV2Output
      findings: readonly ReplyBodyFinding[]
    }>
  | Readonly<{ status: 'hard_failure'; findings: readonly ReplyBodyFinding[] }>
  | Readonly<{ status: 'refused'; reason: 'shape' | 'language' | 'scanner_unavailable' }>

function languageOf(tag: string): Language | null {
  const group = parseCanonicalReplyLanguageTag(tag)?.templateGroup
  if (group === 'en-Latn') return 'en'
  if (group === 'es-Latn') return 'es'
  return group === 'bg-Cyrl' ? 'bg' : null
}

/** Metadata and rejected bodies never leave this acceptance seam. */
export function acceptReplyDraftingV2(
  input: Readonly<{
    output: unknown
    sentences: readonly Readonly<{ n: number; text: string }>[]
    targetLanguageTag: string
    rating: number
    countryCode: string
    maxWords?: number
  }>,
): ReplyDraftingV2Acceptance {
  const parsed = replyDraftingV2OutputSchema.safeParse(input.output)
  if (!parsed.success) return { status: 'refused', reason: 'shape' }
  const draft = parsed.data
  const language = languageOf(input.targetLanguageTag)
  if (language === null || language !== languageOf(draft.languageCode))
    return { status: 'refused', reason: 'language' }
  const scan = scanAiReplyOutput({
    text: draft.replyText,
    countryCode: input.countryCode,
    expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
    expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (scan === 'scanner_unavailable')
    return { status: 'refused', reason: 'scanner_unavailable' }
  const source = new Set(input.sentences.map(({ n }) => n))
  const reviewText = input.sentences.map(({ text }) => text).join(' ')
  const findings = [
    ...lintReplyDraftingV2Body({
      body: draft.replyText,
      language,
      rating: input.rating,
      modelCase: draft.case,
      avoidTerms: draft.avoidTerms,
      reviewText,
      reviewWordCount: reviewText.split(/\s+/u).filter(Boolean).length,
      ...(input.maxWords === undefined ? {} : { maxWords: input.maxWords }),
    }),
  ]
  if (!draft.mainPoint.every((n) => source.has(n)))
    findings.push(replyBodyFinding('sentence_reference'))
  if (
    hasProhibitedReplyCommitment(draft.replyText) ||
    hasSpanishReplyCommitment(draft.replyText)
  )
    findings.push(replyBodyFinding('prohibited_content'))
  if (scan !== 'safe') findings.push(replyBodyFinding('private_data'))
  if (findings.some((finding) => finding.severity === 'hard'))
    return { status: 'hard_failure', findings }
  return { status: 'accepted', draft, findings }
}
