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
