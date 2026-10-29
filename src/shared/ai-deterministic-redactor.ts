import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  AI_CLOSED_PLACEHOLDERS,
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  foldAiMarkerText,
  scanStructuredMarkerCandidates,
  type AiClosedPlaceholder,
  type AiStructuredMarkerBlockReason,
} from './ai-structured-marker-detectors'

export const AI_REDACTION_PROFILE_VERSION = 'gbp-review-global-v1' as const

const REDACTION_MANIFEST = Object.freeze({
  version: AI_REDACTION_PROFILE_VERSION,
  detectorVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  detectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  maximumIntervals: 64,
  maximumRedactedRatioNumerator: 3,
  maximumRedactedRatioDenominator: 5,
  preservedSourcePlaceholder: '[PERSON]',
  attestedPersonCountsTowardIntervalAndRatioCaps: true,
  emittedPlaceholders: Object.freeze([
    '[CONTACT]',
    '[ADDRESS]',
    '[FINANCIAL]',
    '[IDENTIFIER]',
    '[SECRET]',
  ]),
})

export const AI_REDACTION_PROFILE_DIGEST = createHash('sha256')
  .update('repkey-ai-deterministic-redactor-profile-v1\0', 'utf8')
  .update(canonicalizeRfc8785(REDACTION_MANIFEST), 'utf8')
  .digest('hex')

export type AiRedactionCounts = Readonly<Record<AiClosedPlaceholder, number>>

export type AiRedactionBlockReason =
  | AiStructuredMarkerBlockReason
  | 'profile_mismatch'
  | 'forbidden_source_placeholder'
  | 'redaction_ratio_exceeded'

export type AiDeterministicRedactionInput = Readonly<{
  text: string
  countryCode: string
  expectedRedactionProfileVersion: string
  expectedRedactionProfileDigest: string
  expectedDetectorProfileVersion: string
  expectedDetectorProfileDigest: string
}>

export type AiDeterministicRedactionResult =
  | Readonly<{
      status: 'redacted'
      text: string
      counts: AiRedactionCounts
    }>
  | Readonly<{
      status: 'redaction_blocked'
      reason: AiRedactionBlockReason
    }>

const FOLDED_PLACEHOLDERS = AI_CLOSED_PLACEHOLDERS.map((placeholder) =>
  foldAiMarkerText(placeholder),
)

function emptyCounts(): Record<AiClosedPlaceholder, number> {
  return {
    '[PERSON]': 0,
    '[CONTACT]': 0,
    '[ADDRESS]': 0,
    '[FINANCIAL]': 0,
    '[IDENTIFIER]': 0,
    '[SECRET]': 0,
  }
}

function countScalars(value: string): number {
  let count = 0
  for (const _scalar of value) count += 1
  return count
}

function countExactPersonPlaceholders(text: string): number {
  let count = 0
  let cursor = 0
  for (;;) {
    const index = text.indexOf('[PERSON]', cursor)
    if (index < 0) return count
    count += 1
    cursor = index + '[PERSON]'.length
  }
}

function hasForbiddenSourcePlaceholder(text: string): boolean {
  const withoutAttestedPersonTokens = text.replaceAll('[PERSON]', '')
  const folded = foldAiMarkerText(withoutAttestedPersonTokens)
  return FOLDED_PLACEHOLDERS.some((placeholder) => folded.includes(placeholder))
}

export type AiDeterministicSentenceRedactionInput = Readonly<
  Omit<AiDeterministicRedactionInput, 'text'> & { sentences: readonly string[] }
>

export type AiDeterministicSentenceRedactionResult =
  | Readonly<{
      status: 'redacted'
      /** One entry per input sentence, in order, so numbering never moves. */
      sentences: readonly string[]
      counts: AiRedactionCounts
    }>
  | Readonly<{
      status: 'redaction_blocked'
      reason: AiRedactionBlockReason
    }>

/**
 * `redactAiReviewText` for a review already cut into sentences (review-analysis
 * v3): the redaction a sentence carries is the redaction of the review it is part
 * of, rendered per sentence so that no sentence loses its number.
 *
 * The sentences are scanned joined by the one space the whole canonical text
 * carries between them, so a marker a line break cut in two ("+359 888" and
 * "123 456", "john@" and "example.com") is read as the one marker it is, and the
 * two limits that bound a redaction (64 intervals, a redacted share of at most
 * three fifths) are counted over the whole review, as the whole text counts
 * them. Each interval is then written into every sentence it touches: a marker
 * across two sentences leaves one placeholder in each, so neither half survives.
 * Scanning each sentence alone would read neither half and would refuse a short
 * sentence that is mostly one address, a review `redactAiReviewText` accepts.
 *
 * The caller still compares this with the redaction of the whole text, because
 * the joined sentences differ from it in the width of their whitespace.
 */
export function redactAiReviewSentences(
  input: AiDeterministicSentenceRedactionInput,
): AiDeterministicSentenceRedactionResult {
  if (
    input.expectedRedactionProfileVersion !== AI_REDACTION_PROFILE_VERSION ||
    input.expectedRedactionProfileDigest !== AI_REDACTION_PROFILE_DIGEST ||
    input.expectedDetectorProfileVersion !== AI_STRUCTURED_MARKER_DETECTORS_VERSION ||
    input.expectedDetectorProfileDigest !== AI_STRUCTURED_MARKER_DETECTORS_DIGEST
  ) {
    return { status: 'redaction_blocked', reason: 'profile_mismatch' }
  }

  try {
    const joined = input.sentences.join(' ')
    if (hasForbiddenSourcePlaceholder(joined)) {
      return { status: 'redaction_blocked', reason: 'forbidden_source_placeholder' }
    }
    const scan = scanStructuredMarkerCandidates({
      text: joined,
      countryCode: input.countryCode,
      expectedProfileVersion: input.expectedDetectorProfileVersion,
      expectedProfileDigest: input.expectedDetectorProfileDigest,
    })
    if (scan.status === 'blocked') {
      return { status: 'redaction_blocked', reason: scan.reason }
    }

    const personCount = countExactPersonPlaceholders(joined)
    if (scan.intervals.length + personCount > 64) {
      return { status: 'redaction_blocked', reason: 'candidate_limit_exceeded' }
    }
    const sourceScalarCount = countScalars(joined)
    const redactedScalarCount =
      personCount * '[PERSON]'.length +
      scan.intervals.reduce((total, interval) => total + interval.scalarLength, 0)
    if (sourceScalarCount > 0 && redactedScalarCount * 5 > sourceScalarCount * 3) {
      return { status: 'redaction_blocked', reason: 'redaction_ratio_exceeded' }
    }

    const counts = emptyCounts()
    counts['[PERSON]'] = personCount
    for (const interval of scan.intervals) counts[interval.placeholder] += 1
    const rendered: string[] = []
    let sentenceStart = 0
    for (const sentence of input.sentences) {
      const sentenceEnd = sentenceStart + sentence.length
      const parts: string[] = []
      let cursor = sentenceStart
      for (const interval of scan.intervals) {
        if (interval.endUtf16 <= sentenceStart) continue
        if (interval.startUtf16 >= sentenceEnd) break
        parts.push(
          joined.slice(cursor, Math.max(interval.startUtf16, sentenceStart)),
          interval.placeholder,
        )
        cursor = Math.min(interval.endUtf16, sentenceEnd)
      }
      parts.push(joined.slice(cursor, sentenceEnd))
      rendered.push(parts.join(''))
      sentenceStart = sentenceEnd + 1
    }
    return Object.freeze({
      status: 'redacted' as const,
      sentences: Object.freeze(rendered),
      counts: Object.freeze(counts),
    })
  } catch {
    return { status: 'redaction_blocked', reason: 'scanner_unavailable' }
  }
}

export function redactAiReviewText(
  input: AiDeterministicRedactionInput,
): AiDeterministicRedactionResult {
  if (
    input.expectedRedactionProfileVersion !== AI_REDACTION_PROFILE_VERSION ||
    input.expectedRedactionProfileDigest !== AI_REDACTION_PROFILE_DIGEST ||
    input.expectedDetectorProfileVersion !== AI_STRUCTURED_MARKER_DETECTORS_VERSION ||
    input.expectedDetectorProfileDigest !== AI_STRUCTURED_MARKER_DETECTORS_DIGEST
  ) {
    return { status: 'redaction_blocked', reason: 'profile_mismatch' }
  }

  try {
    if (hasForbiddenSourcePlaceholder(input.text)) {
      return { status: 'redaction_blocked', reason: 'forbidden_source_placeholder' }
    }
    const scan = scanStructuredMarkerCandidates({
      text: input.text,
      countryCode: input.countryCode,
      expectedProfileVersion: input.expectedDetectorProfileVersion,
      expectedProfileDigest: input.expectedDetectorProfileDigest,
    })
    if (scan.status === 'blocked') {
      return { status: 'redaction_blocked', reason: scan.reason }
    }

    const personCount = countExactPersonPlaceholders(input.text)
    if (scan.intervals.length + personCount > 64) {
      return { status: 'redaction_blocked', reason: 'candidate_limit_exceeded' }
    }
    const sourceScalarCount = countScalars(input.text)
    const redactedScalarCount =
      personCount * '[PERSON]'.length +
      scan.intervals.reduce((total, interval) => total + interval.scalarLength, 0)
    if (sourceScalarCount > 0 && redactedScalarCount * 5 > sourceScalarCount * 3) {
      return { status: 'redaction_blocked', reason: 'redaction_ratio_exceeded' }
    }

    const counts = emptyCounts()
    counts['[PERSON]'] = personCount
    const rendered: string[] = []
    let cursor = 0
    for (const interval of scan.intervals) {
      rendered.push(input.text.slice(cursor, interval.startUtf16), interval.placeholder)
      counts[interval.placeholder] += 1
      cursor = interval.endUtf16
    }
    rendered.push(input.text.slice(cursor))
    return Object.freeze({
      status: 'redacted' as const,
      text: rendered.join(''),
      counts: Object.freeze(counts),
    })
  } catch {
    return { status: 'redaction_blocked', reason: 'scanner_unavailable' }
  }
}
