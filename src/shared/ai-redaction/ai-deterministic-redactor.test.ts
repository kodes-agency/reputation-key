import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'

type Vector = Readonly<{
  vectorId: string
  text: string
  countryCode: string
  expected:
    | Readonly<{ status: 'redacted'; text: string; counts: Record<string, number> }>
    | Readonly<{ status: 'redaction_blocked'; reason: string }>
}>

const vectors = JSON.parse(
  readFileSync(
    new URL('./ai-deterministic-redactor-v1.vectors.json', import.meta.url),
    'utf8',
  ),
) as readonly Vector[]

function redact(text: string, countryCode = 'US') {
  return redactAiReviewText({
    text,
    countryCode,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

describe('gbp-review-global-v1 deterministic redactor', () => {
  it('exports a lowercase SHA-256 profile attestation', () => {
    expect(AI_REDACTION_PROFILE_DIGEST).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(vectors)('reproduces $vectorId', (vector) => {
    expect(redact(vector.text, vector.countryCode)).toEqual(vector.expected)
  })

  it('preserves only the source-attested PERSON token and never rewrites source input', () => {
    const source =
      'Thanks [PERSON]. Email owner@example.com. Your visit was memorable and helpful.'
    const result = redact(source)
    expect(source).toBe(
      'Thanks [PERSON]. Email owner@example.com. Your visit was memorable and helpful.',
    )
    expect(result).toMatchObject({
      status: 'redacted',
      text: 'Thanks [PERSON]. Email [CONTACT]. Your visit was memorable and helpful.',
    })
  })

  it('fails closed when more than 60 percent of source scalars would be redacted', () => {
    expect(redact('owner@example.com')).toEqual({
      status: 'redaction_blocked',
      reason: 'redaction_ratio_exceeded',
    })
  })

  it('counts attested PERSON substitutions in the redaction ratio', () => {
    expect(redact('[PERSON] okay')).toEqual({
      status: 'redaction_blocked',
      reason: 'redaction_ratio_exceeded',
    })
  })

  it('admits 64 total spans and rejects 65 including attested PERSON substitutions', () => {
    const filler = 'ordinary service feedback '.repeat(20)
    const accepted = redact(`${filler}${'[PERSON] '.repeat(64)}`)
    expect(accepted.status).toBe('redacted')
    if (accepted.status === 'redacted') expect(accepted.counts['[PERSON]']).toBe(64)
    expect(redact(`${filler}${'[PERSON] '.repeat(65)}`)).toEqual({
      status: 'redaction_blocked',
      reason: 'candidate_limit_exceeded',
    })
  })

  it('fails closed on profile drift without returning source text', () => {
    const result = redactAiReviewText({
      text: 'owner@example.com',
      countryCode: 'US',
      expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
      expectedRedactionProfileDigest: '0'.repeat(64),
      expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
      expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
    })
    expect(result).toEqual({ status: 'redaction_blocked', reason: 'profile_mismatch' })
    expect(JSON.stringify(result)).not.toContain('owner@example.com')
  })
})
