import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  scanAiReplyOutput,
} from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'

type Vector = Readonly<{
  vectorId: string
  text: string
  expected:
    | 'safe'
    | 'forbidden_scalar'
    | 'placeholder'
    | 'structured_candidate'
    | 'ambiguous_candidate'
    | 'scanner_unavailable'
}>

const vectors = JSON.parse(
  readFileSync(
    new URL('./ai-reply-output-leakage-v1.vectors.json', import.meta.url),
    'utf8',
  ),
) as readonly Vector[]

function scan(text: string) {
  return scanAiReplyOutput({
    text,
    countryCode: 'US',
    expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
    expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

describe('gbp-reply-output-leakage-v1', () => {
  it('exports a lowercase SHA-256 profile attestation', () => {
    expect(AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(vectors)('reproduces $vectorId', (vector) => {
    expect(scan(vector.text)).toBe(vector.expected)
  })

  it('rejects every closed placeholder under full case folding', () => {
    for (const placeholder of [
      '[person]',
      '[contact]',
      '[address]',
      '[financial]',
      '[identifier]',
      '[secret]',
    ]) {
      expect(scan(`Thank you ${placeholder} for the feedback.`)).toBe('placeholder')
    }
  })

  it('rejects every forbidden scalar category and punctuation member', () => {
    const forbidden = [
      'Number 1',
      'Line\ttab',
      'No\u00a0break',
      'Emoji 😀',
      'Private \ue000',
      'Noncharacter \ufdd0',
      ...'@:/\\[]{}<>_=+*#%&;|~^`'.split('').map((character) => `x${character}y`),
    ]
    for (const text of forbidden) expect(scan(text), text).not.toBe('safe')
  })

  it('accepts the 64-candidate boundary and rejects 65 without returning a span', () => {
    const sixtyFour = Array.from(
      { length: 64 },
      (_, index) => `u${index}@example.com`,
    ).join(' ')
    expect(scan(sixtyFour)).toBe('structured_candidate')
    const result = scan(`${sixtyFour} overflow@example.com`)
    expect(result).toBe('ambiguous_candidate')
    expect(JSON.stringify(result)).not.toContain('example.com')
  })

  it('fails closed for profile drift, detector drift, and malformed Unicode', () => {
    expect(
      scanAiReplyOutput({
        text: 'Thank you.',
        countryCode: 'US',
        expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
        expectedProfileDigest: '0'.repeat(64),
        expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
      }),
    ).toBe('scanner_unavailable')
    expect(
      scanAiReplyOutput({
        text: 'Thank you.',
        countryCode: 'US',
        expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
        expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
        expectedDetectorProfileDigest: 'f'.repeat(64),
      }),
    ).toBe('scanner_unavailable')
    expect(scan('\ud800')).toBe('scanner_unavailable')
  })
})
