import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  scanStructuredMarkerCandidates,
} from './ai-structured-marker-detectors'

type Vector = Readonly<{
  vectorId: string
  text: string
  countryCode: string
  expectedStatus: 'safe' | 'blocked'
  expectedPlaceholders?: readonly string[]
  expectedReason?: string
}>

const vectors = JSON.parse(
  readFileSync(
    new URL('./ai-structured-marker-detectors-v1.vectors.json', import.meta.url),
    'utf8',
  ),
) as readonly Vector[]

function scan(text: string, countryCode = 'US') {
  return scanStructuredMarkerCandidates({
    text,
    countryCode,
    expectedProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

describe('structured-marker-detectors-v1', () => {
  it('exports a lowercase SHA-256 profile attestation', () => {
    expect(AI_STRUCTURED_MARKER_DETECTORS_DIGEST).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(vectors)('reproduces $vectorId', (vector) => {
    const result = scan(vector.text, vector.countryCode)
    expect(result.status).toBe(vector.expectedStatus)
    if (result.status === 'safe') {
      expect(result.intervals.map((interval) => interval.placeholder)).toEqual(
        vector.expectedPlaceholders ?? [],
      )
    } else {
      expect(result.reason).toBe(vector.expectedReason)
    }
  })

  it('accepts 64 resolved candidates and rejects the 65th without exposing values', () => {
    const sixtyFour = Array.from(
      { length: 64 },
      (_, index) => `u${index}@example.com`,
    ).join(' ')
    const accepted = scan(sixtyFour)
    expect(accepted.status).toBe('safe')
    if (accepted.status === 'safe') expect(accepted.intervals).toHaveLength(64)

    const rejected = scan(`${sixtyFour} overflow@example.com`)
    expect(rejected).toEqual({ status: 'blocked', reason: 'candidate_limit_exceeded' })
    expect(JSON.stringify(rejected)).not.toContain('overflow@example.com')
  })

  it('resolves nested/overlapping contact markers to one longest interval', () => {
    const result = scan('Visit https://example.com/contact?email=owner@example.com now')
    expect(result.status).toBe('safe')
    if (result.status !== 'safe') return
    expect(result.intervals).toHaveLength(1)
    expect(result.intervals[0]?.placeholder).toBe('[CONTACT]')
  })

  it('does not reconstruct across sentence punctuation after a valid email', () => {
    const text = 'Email owner@example.com. Your visit was memorable.'
    const result = scan(text)
    expect(result.status).toBe('safe')
    if (result.status !== 'safe') return
    const emailStart = text.indexOf('owner@example.com')
    expect(result.intervals).toEqual([
      {
        startUtf16: emailStart,
        endUtf16: emailStart + 'owner@example.com'.length,
        scalarLength: 'owner@example.com'.length,
        placeholder: '[CONTACT]',
      },
    ])
  })

  it('keeps the full outer boundary when a contained marker has higher priority', () => {
    const text = 'https://example.com/sk_test_1234567890abcdefghijklmnop'
    const result = scan(text)
    expect(result.status).toBe('safe')
    if (result.status !== 'safe') return
    expect(result.intervals).toEqual([
      {
        startUtf16: 0,
        endUtf16: text.length,
        scalarLength: text.length,
        placeholder: '[SECRET]',
      },
    ])
  })

  it('fails closed for malformed Unicode, profile drift, and over-bound candidates', () => {
    expect(scan('\ud800')).toEqual({ status: 'blocked', reason: 'invalid_unicode' })
    expect(
      scanStructuredMarkerCandidates({
        text: 'safe text',
        countryCode: 'US',
        expectedProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
        expectedProfileDigest: '0'.repeat(64),
      }),
    ).toEqual({ status: 'blocked', reason: 'profile_mismatch' })
    expect(scan(`${'a'.repeat(255)}@example.com`)).toEqual({
      status: 'blocked',
      reason: 'ambiguous_candidate',
    })
  })

  it('ignores bounded invalid checksum candidates rather than treating them as PII', () => {
    const result = scan(
      'invalid card 4111 1111 1111 1112 and IBAN GB00WEST12345698765432',
    )
    expect(result).toEqual({ status: 'safe', intervals: [], candidateCount: 0 })
  })
})
