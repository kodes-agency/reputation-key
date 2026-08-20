import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  AI_CLOSED_PLACEHOLDERS,
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  foldAiMarkerText,
  scanStructuredMarkerCandidates,
} from './ai-structured-marker-detectors'

export const AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION =
  'gbp-reply-output-leakage-v1' as const

export const AI_REPLY_OUTPUT_LEAKAGE_REASONS = Object.freeze([
  'safe',
  'forbidden_scalar',
  'placeholder',
  'structured_candidate',
  'ambiguous_candidate',
  'scanner_unavailable',
] as const)

export type AiReplyOutputLeakageResult = (typeof AI_REPLY_OUTPUT_LEAKAGE_REASONS)[number]

const FORBIDDEN_ASCII = '@:/\\[]{}<>_=+*#%&;|~^`'
const FOLDED_PLACEHOLDERS = AI_CLOSED_PLACEHOLDERS.map((placeholder) =>
  foldAiMarkerText(placeholder),
)

const OUTPUT_LEAKAGE_MANIFEST = Object.freeze({
  version: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  detectorVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  detectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  precedence: Object.freeze([
    'placeholder',
    'structured_candidate',
    'ambiguous_candidate',
    'scanner_unavailable',
    'forbidden_scalar',
    'safe',
  ]),
  allowedScalarCategories: Object.freeze(['Letter', 'Mark', 'Punctuation', 'U+0020']),
  forbiddenScalarCategories: Object.freeze([
    'Noncharacter',
    'Number',
    'SeparatorExceptU+0020',
    'Control',
    'Format',
    'Surrogate',
    'PrivateUse',
    'Symbol',
  ]),
  forbiddenAscii: '@:/\\[]{}<>_=+*#%&;|~^`',
  reasons: AI_REPLY_OUTPUT_LEAKAGE_REASONS,
})

export const AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST = createHash('sha256')
  .update('repkey-reply-output-leakage-profile-v1\0', 'utf8')
  .update(canonicalizeRfc8785(OUTPUT_LEAKAGE_MANIFEST), 'utf8')
  .digest('hex')

export type AiReplyOutputLeakageInput = Readonly<{
  text: string
  countryCode: string
  expectedProfileVersion: string
  expectedProfileDigest: string
  expectedDetectorProfileDigest: string
}>

function isScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0xd800 || unit > 0xdfff) continue
    if (
      unit > 0xdbff ||
      index + 1 >= value.length ||
      value.charCodeAt(index + 1) < 0xdc00 ||
      value.charCodeAt(index + 1) > 0xdfff
    ) {
      return false
    }
    index += 1
  }
  return true
}

function isNoncharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xffff) === 0xfffe ||
    (codePoint & 0xffff) === 0xffff
  )
}

function containsPlaceholder(value: string): boolean {
  const folded = foldAiMarkerText(value)
  return FOLDED_PLACEHOLDERS.some((placeholder) => folded.includes(placeholder))
}

function containsForbiddenScalar(value: string): boolean {
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!
    if (isNoncharacter(codePoint) || FORBIDDEN_ASCII.includes(scalar)) return true
    if (scalar === ' ') continue
    if (
      /\p{N}/u.test(scalar) ||
      /\p{Z}/u.test(scalar) ||
      /\p{Cc}|\p{Cf}|\p{Cs}|\p{Co}/u.test(scalar) ||
      /\p{S}/u.test(scalar)
    ) {
      return true
    }
    if (!/[\p{L}\p{M}\p{P}]/u.test(scalar)) return true
  }
  return false
}

export function scanAiReplyOutput(
  input: AiReplyOutputLeakageInput,
): AiReplyOutputLeakageResult {
  if (
    input.expectedProfileVersion !== AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION ||
    input.expectedProfileDigest !== AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST ||
    input.expectedDetectorProfileDigest !== AI_STRUCTURED_MARKER_DETECTORS_DIGEST
  ) {
    return 'scanner_unavailable'
  }
  if (typeof input.text !== 'string' || !isScalarString(input.text)) {
    return 'scanner_unavailable'
  }

  try {
    const normalized = input.text.normalize('NFKC')
    if (containsPlaceholder(normalized)) return 'placeholder'
    if (normalized !== input.text) return 'forbidden_scalar'

    const markers = scanStructuredMarkerCandidates({
      text: normalized,
      countryCode: input.countryCode,
      expectedProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
      expectedProfileDigest: input.expectedDetectorProfileDigest,
    })
    if (markers.status === 'blocked') {
      if (
        markers.reason === 'ambiguous_candidate' ||
        markers.reason === 'candidate_limit_exceeded' ||
        markers.reason === 'input_too_large'
      ) {
        return 'ambiguous_candidate'
      }
      return 'scanner_unavailable'
    }
    if (markers.intervals.length > 0) return 'structured_candidate'
    if (containsForbiddenScalar(normalized)) return 'forbidden_scalar'
    return 'safe'
  } catch {
    return 'scanner_unavailable'
  }
}
