import process from 'node:process'
import manifest from './ai-review-language-catalogue-v1.manifest.json'
import {
  AI_REVIEW_LANGUAGE_CANONICAL_REGION_TABLE_DIGEST,
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  isCanonicalAiReviewLanguageRegion,
} from './generated/ai-review-language-canonical-regions-v1'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

export const REPLY_TEMPLATE_LANGUAGE_GROUPS = Object.freeze([
  'en-Latn',
  'es-Latn',
  'fr-Latn',
  'de-Latn',
  'pt-Latn',
  'it-Latn',
  'nl-Latn',
  'pl-Latn',
  'tr-Latn',
  'uk-Cyrl',
  'ru-Cyrl',
  'ar-Arab',
  'he-Hebr',
  'hi-Deva',
  'bn-Beng',
  'ta-Taml',
  'th-Thai',
  'vi-Latn',
  'id-Latn',
  'zh-Hans',
  'zh-Hant',
  'ja-Jpan',
  'ko-Kore',
  'bg-Cyrl',
] as const)

export const REVIEW_LANGUAGE_GROUPS = Object.freeze([
  'und',
  ...REPLY_TEMPLATE_LANGUAGE_GROUPS,
] as const)

export type ReplyTemplateLanguageGroup = (typeof REPLY_TEMPLATE_LANGUAGE_GROUPS)[number]
export type ReviewLanguageGroup = (typeof REVIEW_LANGUAGE_GROUPS)[number]

const canonicalTagBrand: unique symbol = Symbol('CanonicalSupportedBcp47Tag')
const evaluatedLanguageBrand: unique symbol = Symbol('EvaluatedReviewLanguage')
declare const concreteLanguageBrand: unique symbol

export type CanonicalSupportedBcp47Tag = string & {
  readonly [canonicalTagBrand]: 'CanonicalSupportedBcp47Tag'
}

export type EvaluatedReviewLanguage = Readonly<{
  tag: CanonicalSupportedBcp47Tag | 'und'
  group: ReviewLanguageGroup
  readonly [evaluatedLanguageBrand]: true
}>

export type ConcreteReplyLanguage = Readonly<{
  tag: CanonicalSupportedBcp47Tag
  templateGroup: ReplyTemplateLanguageGroup
  readonly [concreteLanguageBrand]: true
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

const SUPPORTED_GROUP: Readonly<Record<ReplyTemplateLanguageGroup, true>> = Object.freeze(
  Object.fromEntries(
    REPLY_TEMPLATE_LANGUAGE_GROUPS.map((group) => [group, true]),
  ) as Record<ReplyTemplateLanguageGroup, true>,
)

function isAsciiLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a)
  )
}

function isAsciiAlphanumeric(codePoint: number): boolean {
  return isAsciiLetter(codePoint) || (codePoint >= 0x30 && codePoint <= 0x39)
}

function isStructurallyValidLanguageTag(value: string): boolean {
  const parts = value.split('-')
  const primary = parts[0]
  if (
    primary === undefined ||
    primary.length < 2 ||
    primary.length > 8 ||
    [...primary].some((scalar) => !isAsciiLetter(scalar.codePointAt(0)!))
  ) {
    return false
  }
  return parts
    .slice(1)
    .every(
      (part) =>
        part.length >= 1 &&
        part.length <= 8 &&
        [...part].every((scalar) => isAsciiAlphanumeric(scalar.codePointAt(0)!)),
    )
}
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u
const UNICODE_WHITE_SPACE: Readonly<Record<number, true>> = Object.freeze({
  0x0009: true,
  0x000a: true,
  0x000b: true,
  0x000c: true,
  0x000d: true,
  0x0020: true,
  0x0085: true,
  0x00a0: true,
  0x1680: true,
  0x2000: true,
  0x2001: true,
  0x2002: true,
  0x2003: true,
  0x2004: true,
  0x2005: true,
  0x2006: true,
  0x2007: true,
  0x2008: true,
  0x2009: true,
  0x200a: true,
  0x2028: true,
  0x2029: true,
  0x202f: true,
  0x205f: true,
  0x3000: true,
})

export function isAiUnicodeWhiteSpace(codePoint: number): boolean {
  return Object.hasOwn(UNICODE_WHITE_SPACE, codePoint)
}

function scalarCountAtMost(value: string, maximum: number): boolean {
  let count = 0
  for (const _scalar of value) {
    count += 1
    if (count > maximum) return false
  }
  return true
}

function trimUnicodeWhiteSpace(value: string): string {
  let start = 0
  while (start < value.length) {
    const codePoint = value.codePointAt(start)!
    if (!isAiUnicodeWhiteSpace(codePoint)) break
    start += codePoint > 0xffff ? 2 : 1
  }
  let end = value.length
  while (end > start) {
    const trailing = value.charCodeAt(end - 1)
    const codePoint =
      trailing >= 0xdc00 && trailing <= 0xdfff && end >= 2
        ? value.codePointAt(end - 2)!
        : trailing
    if (!isAiUnicodeWhiteSpace(codePoint)) break
    end -= codePoint > 0xffff ? 2 : 1
  }
  return value.slice(start, end)
}

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
  if (metadata === null || metadata === undefined) {
    return { status: 'supported', language: UNDETERMINED_LANGUAGE }
  }

  const trimmed = trimUnicodeWhiteSpace(metadata)
  if (trimmed.length === 0) {
    return { status: 'supported', language: UNDETERMINED_LANGUAGE }
  }
  if (
    !scalarCountAtMost(trimmed, 64) ||
    CONTROL_PATTERN.test(trimmed) ||
    !isStructurallyValidLanguageTag(trimmed) ||
    trimmed.toLowerCase().startsWith('x-')
  ) {
    return { status: 'language_not_supported', reason: 'malformed_metadata' }
  }

  let locale: Intl.Locale
  try {
    locale = new Intl.Locale(trimmed)
  } catch {
    try {
      new Intl.Locale('en')
    } catch {
      return { status: 'policy_unavailable' }
    }
    return { status: 'language_not_supported', reason: 'malformed_metadata' }
  }

  const firstSeparator = trimmed.indexOf('-')
  const syntacticPrimary = trimmed
    .slice(0, firstSeparator < 0 ? trimmed.length : firstSeparator)
    .toLowerCase()
  const primary = (locale.language ?? syntacticPrimary).toLowerCase()
  if (primary === 'und' || primary === 'zxx') {
    return { status: 'supported', language: UNDETERMINED_LANGUAGE }
  }

  const explicitRegion = locale.region
  if (
    explicitRegion !== undefined &&
    !isCanonicalAiReviewLanguageRegion(explicitRegion)
  ) {
    return { status: 'language_not_supported', reason: 'malformed_metadata' }
  }

  let maximized: Intl.Locale
  try {
    maximized = locale.maximize()
  } catch {
    return { status: 'policy_unavailable' }
  }
  const script = maximized.script
  if (script === undefined) return { status: 'policy_unavailable' }
  const group = `${maximized.language.toLowerCase()}-${script}`
  if (!Object.hasOwn(SUPPORTED_GROUP, group)) {
    return { status: 'language_not_supported', reason: 'unsupported_group' }
  }

  const templateGroup = group as ReplyTemplateLanguageGroup
  const canonicalTag = `${templateGroup}${explicitRegion === undefined ? '' : `-${explicitRegion}`}`
  return {
    status: 'supported',
    language: makeEvaluatedLanguage(
      canonicalTag as CanonicalSupportedBcp47Tag,
      templateGroup,
    ),
  }
}

export function isReplyTemplateLanguageGroup(
  value: string,
): value is ReplyTemplateLanguageGroup {
  return Object.hasOwn(SUPPORTED_GROUP, value)
}
export function parseCanonicalReplyLanguageTag(
  value: string,
): ConcreteReplyLanguage | null {
  if (value.length < 7 || value.length > 11) return null
  const templateGroup = value.slice(0, 7)
  if (!isReplyTemplateLanguageGroup(templateGroup)) return null
  if (value.length !== 7) {
    if (value.charCodeAt(7) !== 0x2d) return null
    const region = value.slice(8)
    if (!isCanonicalAiReviewLanguageRegion(region)) return null
  }
  return Object.freeze({
    tag: value as CanonicalSupportedBcp47Tag,
    templateGroup,
  }) as ConcreteReplyLanguage
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
