import { loadModule } from 'cld3-asm'
import manifest from './ai-reply-language-verifier-v1.manifest.json'
import {
  evaluateLanguageScriptConsistency,
  lookupAiLetterScriptExtensions,
  AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
} from './ai-language-script-consistency'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type EvaluatedReviewLanguage,
  isAiReviewLanguageRuntimeAvailable,
  type ReplyTemplateLanguageGroup,
  isAiUnicodeWhiteSpace,
  mapReviewLanguageMetadata,
} from './ai-review-language-catalogue'
import {
  AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
  evaluateZhOrthography,
} from './ai-zh-orthography-verifier'

export const AI_REPLY_LANGUAGE_VERIFIER_VERSION = 'reply-language-verifier-v1' as const
export const MIN_REPLY_LANGUAGE_LETTERS_V1 = 24 as const
export const MIN_REPLY_LANGUAGE_PROBABILITY_V1 = 0.85 as const

const CLOSED_PLACEHOLDERS = Object.freeze([
  '[PERSON]',
  '[CONTACT]',
  '[ADDRESS]',
  '[FINANCIAL]',
  '[IDENTIFIER]',
  '[SECRET]',
] as const)

const GROUP_BY_CLD3_PRIMARY: Readonly<Record<string, ReplyTemplateLanguageGroup>> =
  Object.freeze({
    en: 'en-Latn',
    es: 'es-Latn',
    fr: 'fr-Latn',
    de: 'de-Latn',
    pt: 'pt-Latn',
    it: 'it-Latn',
    nl: 'nl-Latn',
    pl: 'pl-Latn',
    tr: 'tr-Latn',
    uk: 'uk-Cyrl',
    ru: 'ru-Cyrl',
    ar: 'ar-Arab',
    he: 'he-Hebr',
    iw: 'he-Hebr',
    hi: 'hi-Deva',
    bn: 'bn-Beng',
    ta: 'ta-Taml',
    th: 'th-Thai',
    vi: 'vi-Latn',
    id: 'id-Latn',
    ja: 'ja-Jpan',
    ko: 'ko-Kore',
    bg: 'bg-Cyrl',
  })

export type ReplyLanguageDetection = Readonly<{
  language: string
  probability: number
  reliable: boolean
}>

export type ReplyLanguageDetector = Readonly<{
  detect(text: string): ReplyLanguageDetection
  dispose?(): void
}>

export type ConcreteReplyLanguageResult =
  | Readonly<{ status: 'resolved'; language: ConcreteReplyLanguage }>
  | Readonly<{
      status: 'language_not_supported'
      reason: 'metadata_language_mismatch' | 'insufficient_language_evidence'
    }>
  | Readonly<{ status: 'policy_unavailable' }>

export type ReplyLanguageOutputResult =
  | Readonly<{ status: 'valid' }>
  | Readonly<{ status: 'output_invalid' }>

export type PreparedReplyLanguageDetectorInput = Readonly<{
  status: 'ready'
  text: string
  letterCount: number
}>

function isInvalidScalar(codePoint: number): boolean {
  return (
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xffff) === 0xfffe ||
    (codePoint & 0xffff) === 0xffff
  )
}

function placeholderLengthAt(text: string, index: number): number {
  if (text.charCodeAt(index) !== 0x5b) return 0
  for (const placeholder of CLOSED_PLACEHOLDERS) {
    if (text.startsWith(placeholder, index)) return placeholder.length
  }
  return 0
}

export function prepareReplyLanguageDetectorInput(
  text: string,
): PreparedReplyLanguageDetectorInput | Readonly<{ status: 'policy_unavailable' }> {
  if (text.normalize('NFKC') !== text) return { status: 'policy_unavailable' }
  let normalized = ''
  let pendingSpace = false
  let letterCount = 0
  for (let index = 0; index < text.length; ) {
    const placeholderLength = placeholderLengthAt(text, index)
    if (placeholderLength > 0) {
      pendingSpace = normalized.length > 0
      index += placeholderLength
      continue
    }
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined || isInvalidScalar(codePoint)) {
      return { status: 'policy_unavailable' }
    }
    index += codePoint > 0xffff ? 2 : 1
    if (isAiUnicodeWhiteSpace(codePoint)) {
      pendingSpace = normalized.length > 0
      continue
    }
    if (pendingSpace) {
      normalized += ' '
      pendingSpace = false
    }
    normalized += String.fromCodePoint(codePoint)
    if (lookupAiLetterScriptExtensions(codePoint) >= 0) letterCount += 1
  }
  return {
    status: 'ready',
    text: normalized,
    letterCount,
  }
}

function normalizedPrimary(label: string): string | null {
  if (label === 'iw') return 'he'
  if (label === 'und' || label.length === 0 || !/^[a-z]{2,3}$/.test(label)) return null
  return label
}

function primaryForGroup(group: ReplyTemplateLanguageGroup): string {
  const primary = group.slice(0, group.indexOf('-'))
  return primary === 'he' ? 'he' : primary
}

function detect(
  prepared: PreparedReplyLanguageDetectorInput,
  detector: ReplyLanguageDetector,
): ReplyLanguageDetection | null {
  const result = detector.detect(prepared.text)
  if (
    typeof result.language !== 'string' ||
    typeof result.reliable !== 'boolean' ||
    !Number.isFinite(result.probability) ||
    result.probability < 0 ||
    result.probability > 1
  ) {
    return null
  }
  return result
}

function verifiedScript(
  text: string,
  tag: string,
  group: ReplyTemplateLanguageGroup,
): 'accepted' | 'insufficient' | 'rejected' | 'unavailable' {
  const consistency = evaluateLanguageScriptConsistency(text, tag)
  if (consistency.status === 'policy_unavailable') return 'unavailable'
  if (consistency.status !== 'consistent') return 'rejected'
  if (group !== 'zh-Hans' && group !== 'zh-Hant') return 'accepted'
  const orthography = evaluateZhOrthography(text, group === 'zh-Hans' ? 'Hans' : 'Hant')
  if (orthography.status === 'policy_unavailable') return 'unavailable'
  if (orthography.status === 'insufficient_evidence') return 'insufficient'
  return orthography.status === 'accepted' ? 'accepted' : 'rejected'
}

export function resolveConcreteReplyLanguage(
  input: Readonly<{
    text: string
    evaluatedLanguage: EvaluatedReviewLanguage
    detector: ReplyLanguageDetector
  }>,
): ConcreteReplyLanguageResult {
  if (!isAiReviewLanguageRuntimeAvailable()) return { status: 'policy_unavailable' }
  const prepared = prepareReplyLanguageDetectorInput(input.text)
  if (prepared.status !== 'ready') return { status: 'policy_unavailable' }
  if (prepared.letterCount < MIN_REPLY_LANGUAGE_LETTERS_V1) {
    return { status: 'language_not_supported', reason: 'insufficient_language_evidence' }
  }

  let detection: ReplyLanguageDetection | null
  try {
    detection = detect(prepared, input.detector)
  } catch {
    return { status: 'policy_unavailable' }
  }
  const detectedPrimary =
    detection === null ? null : normalizedPrimary(detection.language)
  if (
    detection === null ||
    !detection.reliable ||
    detection.probability < MIN_REPLY_LANGUAGE_PROBABILITY_V1 ||
    detectedPrimary === null
  ) {
    return { status: 'language_not_supported', reason: 'insufficient_language_evidence' }
  }

  const explicit = input.evaluatedLanguage.group !== 'und'
  let templateGroup: ReplyTemplateLanguageGroup
  let tag: string
  if (explicit) {
    const remapped = mapReviewLanguageMetadata(input.evaluatedLanguage.tag)
    if (
      remapped.status !== 'supported' ||
      remapped.language.group !== input.evaluatedLanguage.group ||
      remapped.language.tag !== input.evaluatedLanguage.tag ||
      detectedPrimary !==
        primaryForGroup(input.evaluatedLanguage.group as ReplyTemplateLanguageGroup)
    ) {
      return { status: 'language_not_supported', reason: 'metadata_language_mismatch' }
    }
    templateGroup = input.evaluatedLanguage.group as ReplyTemplateLanguageGroup
    tag = input.evaluatedLanguage.tag
  } else if (detectedPrimary === 'zh') {
    const hans = evaluateZhOrthography(input.text, 'Hans')
    const hant = evaluateZhOrthography(input.text, 'Hant')
    if (hans.status === 'policy_unavailable' || hant.status === 'policy_unavailable') {
      return { status: 'policy_unavailable' }
    }
    if ((hans.status === 'accepted') === (hant.status === 'accepted')) {
      return {
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      }
    }
    templateGroup = hans.status === 'accepted' ? 'zh-Hans' : 'zh-Hant'
    tag = templateGroup
  } else {
    const mapped = GROUP_BY_CLD3_PRIMARY[detectedPrimary]
    if (mapped === undefined) {
      return {
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      }
    }
    templateGroup = mapped
    tag = mapped
  }

  const script = verifiedScript(input.text, tag, templateGroup)
  if (script === 'unavailable') return { status: 'policy_unavailable' }
  if (script !== 'accepted') {
    return {
      status: 'language_not_supported',
      reason:
        explicit && script !== 'insufficient'
          ? 'metadata_language_mismatch'
          : 'insufficient_language_evidence',
    }
  }
  const language = parseCanonicalReplyLanguageTag(tag)
  if (language === null || language.templateGroup !== templateGroup) {
    return { status: 'policy_unavailable' }
  }
  return { status: 'resolved', language }
}

export function verifyReplyLanguageOutput(
  text: string,
  expected: ConcreteReplyLanguage,
  detector: ReplyLanguageDetector,
): ReplyLanguageOutputResult {
  const mapped = mapReviewLanguageMetadata(expected.tag)
  if (
    mapped.status !== 'supported' ||
    mapped.language.group !== expected.templateGroup ||
    mapped.language.tag !== expected.tag
  ) {
    return { status: 'output_invalid' }
  }
  if (!isAiReviewLanguageRuntimeAvailable()) return { status: 'output_invalid' }
  const prepared = prepareReplyLanguageDetectorInput(text)
  if (
    prepared.status !== 'ready' ||
    prepared.letterCount < MIN_REPLY_LANGUAGE_LETTERS_V1
  ) {
    return { status: 'output_invalid' }
  }
  let detection: ReplyLanguageDetection | null
  try {
    detection = detect(prepared, detector)
  } catch {
    return { status: 'output_invalid' }
  }
  if (
    detection === null ||
    !detection.reliable ||
    detection.probability < MIN_REPLY_LANGUAGE_PROBABILITY_V1 ||
    normalizedPrimary(detection.language) !== primaryForGroup(expected.templateGroup) ||
    verifiedScript(text, expected.tag, expected.templateGroup) !== 'accepted'
  ) {
    return { status: 'output_invalid' }
  }
  return { status: 'valid' }
}

export function verifyReplyTemplateCatalogueEntry(
  text: string,
  templateGroup: ReplyTemplateLanguageGroup,
  detector: ReplyLanguageDetector,
): ReplyLanguageOutputResult {
  const expected = parseCanonicalReplyLanguageTag(templateGroup)
  if (expected === null) return { status: 'output_invalid' }
  return verifyReplyLanguageOutput(text, expected, detector)
}

export async function createCld3ReplyLanguageDetector(): Promise<
  Required<ReplyLanguageDetector>
> {
  const factory = await loadModule({ timeout: 10_000 })
  const identifier = factory.create(0, 65_536)
  let disposed = false
  return Object.freeze({
    detect(text: string): ReplyLanguageDetection {
      if (disposed) throw new Error('CLD3 detector is disposed')
      const result = identifier.findLanguage(text)
      return {
        language: result.language,
        probability: result.probability,
        reliable: result.is_reliable,
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      identifier.dispose()
    },
  })
}

if (
  manifest.dependencies.languageCatalogueDigest !== LANGUAGE_CATALOGUE_DIGEST ||
  manifest.version !== AI_REPLY_LANGUAGE_VERIFIER_VERSION ||
  manifest.dependencies.languageScriptConsistencyDigest !==
    AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST ||
  manifest.dependencies.zhOrthographyDigest !== AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST ||
  !/^[a-f0-9]{64}$/.test(manifest.attestationDigest)
) {
  throw new Error('Reply language verifier manifest drift')
}

export const AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST = manifest.attestationDigest
