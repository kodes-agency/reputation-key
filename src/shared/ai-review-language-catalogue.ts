import process from 'node:process'
import manifest from './ai-review-language-catalogue-v1.manifest.json'
import {
  AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from './generated/ai-review-language-canonical-regions-v1'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  mapReplyLanguageMetadata,
  type CanonicalSupportedBcp47Tag,
} from './reply-language-catalogue'
export {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  isAiUnicodeWhiteSpace,
  isReplyTemplateLanguageGroup,
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type CanonicalSupportedBcp47Tag,
  type ConcreteReplyLanguage,
  type ReplyLanguageMetadataMappingResult,
  type ReplyTemplateLanguageGroup,
} from './reply-language-catalogue'

export const REVIEW_LANGUAGE_GROUPS = Object.freeze([
  'und',
  ...REPLY_TEMPLATE_LANGUAGE_GROUPS,
] as const)

export type ReviewLanguageGroup = (typeof REVIEW_LANGUAGE_GROUPS)[number]

const evaluatedLanguageBrand: unique symbol = Symbol('EvaluatedReviewLanguage')

export type EvaluatedReviewLanguage = Readonly<{
  tag: CanonicalSupportedBcp47Tag | 'und'
  group: ReviewLanguageGroup
  readonly [evaluatedLanguageBrand]: true
}>


export type ReviewLanguageMappingResult =
  | Readonly<{ status: 'supported'; language: EvaluatedReviewLanguage }>
  | Readonly<{
      status: 'language_not_supported'
      reason: 'malformed_metadata' | 'unsupported_group'
    }>
  | Readonly<{ status: 'policy_unavailable' }>

export const AI_REVIEW_LANGUAGE_CATALOGUE_VERSION =
  'ai-review-language-catalogue-v1' as const
export const AI_REVIEW_LANGUAGE_UNICODE_VERSION = '17.0.0' as const
export const AI_REVIEW_LANGUAGE_ICU_VERSION = '78.2' as const

function makeEvaluatedLanguage(
  tag: CanonicalSupportedBcp47Tag | 'und',
  group: ReviewLanguageGroup,
): EvaluatedReviewLanguage {
  return Object.freeze({ tag, group, [evaluatedLanguageBrand]: true as const })
}

const UNDETERMINED_LANGUAGE = makeEvaluatedLanguage('und', 'und')
export function isAiReviewLanguageRuntimeAvailable(): boolean {
  return (
    process.versions.node === AI_REVIEW_LANGUAGE_REGION_NODE_VERSION &&
    process.versions.unicode === AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/, '') &&
    process.versions.icu === AI_REVIEW_LANGUAGE_ICU_VERSION
  )
}

export function mapReviewLanguageMetadata(
  metadata: string | null | undefined,
): ReviewLanguageMappingResult {
  if (!isAiReviewLanguageRuntimeAvailable()) return { status: 'policy_unavailable' }
  const mapped = mapReplyLanguageMetadata(metadata)
  if (mapped.status === 'runtime_unavailable') return { status: 'policy_unavailable' }
  if (mapped.status === 'language_not_supported') return mapped
  if (mapped.language === null) {
    return { status: 'supported', language: UNDETERMINED_LANGUAGE }
  }
  return {
    status: 'supported',
    language: makeEvaluatedLanguage(
      mapped.language.tag,
      mapped.language.templateGroup,
    ),
  }
}

if (
  manifest.version !== AI_REVIEW_LANGUAGE_CATALOGUE_VERSION ||
  manifest.unicodeVersion !== AI_REVIEW_LANGUAGE_UNICODE_VERSION ||
  manifest.icuVersion !== AI_REVIEW_LANGUAGE_ICU_VERSION ||
  canonicalizeRfc8785(manifest.groups) !== canonicalizeRfc8785(REVIEW_LANGUAGE_GROUPS) ||
  manifest.canonicalRegions.digest !== AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST ||
  manifest.canonicalRegions.nodeVersion !== AI_REVIEW_LANGUAGE_REGION_NODE_VERSION ||
  manifest.canonicalRegions.icuVersion !== AI_REVIEW_LANGUAGE_REGION_ICU_VERSION ||
  manifest.canonicalRegions.unicodeVersion !==
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION ||
  !/^[a-f0-9]{64}$/.test(manifest.attestationDigest)
) {
  throw new Error('AI review language catalogue profile is unavailable')
}

export const LANGUAGE_CATALOGUE_MANIFEST = Object.freeze(manifest)

export const LANGUAGE_CATALOGUE_DIGEST = manifest.attestationDigest
