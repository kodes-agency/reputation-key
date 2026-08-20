import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
  canonicalizeRawAiReviewSource,
  encodeCanonicalAiReviewSource,
  type RawAiReviewSource,
} from './ai-review-source-contract'

type RepeatedString = Readonly<{ repeat: string; count: number }>
type VectorString = string | null | RepeatedString

type Vector = Readonly<{
  vectorId: string
  input: Readonly<{
    text: VectorString
    rating: number
    languageCode: string | null
    reviewedAtEpochMillis: number
    reviewerDisplayName: VectorString
  }>
  expected:
    | Readonly<{
        status: 'success'
        text: VectorString
        canonicalByteLength: number
        hex?: string
        digest: string
      }>
    | Readonly<{ status: 'failure'; error: string }>
}>

const vectors = JSON.parse(
  readFileSync(new URL('./ai-review-source-v1.vectors.json', import.meta.url), 'utf8'),
) as ReadonlyArray<Vector>

function materialize(value: VectorString): string | null {
  if (value === null || typeof value === 'string') return value
  return value.repeat.repeat(value.count)
}

function materializeInput(vector: Vector): RawAiReviewSource {
  return {
    ...vector.input,
    text: materialize(vector.input.text),
    reviewerDisplayName: materialize(vector.input.reviewerDisplayName),
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update('ai-source-v1\0', 'utf8').update(bytes).digest('hex')
}

describe('ai-source-v1', () => {
  it.each(vectors)('reproduces $vectorId', (vector) => {
    const invoke = () => canonicalizeRawAiReviewSource(materializeInput(vector))
    if (vector.expected.status === 'failure') {
      expect(invoke).toThrow(vector.expected.error)
      return
    }

    const canonical = invoke()
    expect(canonical.text).toBe(materialize(vector.expected.text))
    expect(canonical.bytes).toHaveLength(vector.expected.canonicalByteLength)
    if (vector.expected.hex !== undefined) {
      expect(Buffer.from(canonical.bytes).toString('hex')).toBe(vector.expected.hex)
    }
    expect(digest(canonical.bytes)).toBe(vector.expected.digest)
    expect(
      encodeCanonicalAiReviewSource({
        text: canonical.text,
        rating: canonical.rating,
        languageCode: canonical.languageCode,
        reviewedAtEpochMillis: canonical.reviewedAtEpochMillis,
      }).bytes,
    ).toEqual(canonical.bytes)
  })

  it('matches expanding Unicode folds only on complete scalar intervals', () => {
    const result = canonicalizeRawAiReviewSource({
      text: 'FUSS Fuß fußball ss',
      reviewerDisplayName: 'Fuß',
      rating: 4,
      languageCode: 'de-Latn',
      reviewedAtEpochMillis: 1,
    })
    expect(result.text).toBe('[PERSON] [PERSON] [PERSON]ball ss')
  })

  it('normalizes raw source, strips controls, and escapes every raw placeholder', () => {
    const result = canonicalizeRawAiReviewSource({
      text: 'Ａlice\u202E [CONTACT] [SECRET] [PERSON]',
      reviewerDisplayName: 'Alice',
      rating: 3,
      languageCode: 'en',
      reviewedAtEpochMillis: 2,
    })
    expect(result.text).toBe('[PERSON] {#2#} {#6#} {#1#}')
  })

  it('rejects malformed canonical source and raw materialization overflow', () => {
    expect(() =>
      encodeCanonicalAiReviewSource({
        text: 'not normalized: Ａ',
        rating: 5,
        languageCode: 'en',
        reviewedAtEpochMillis: 3,
      }),
    ).toThrow(/NFKC/)
    expect(() =>
      encodeCanonicalAiReviewSource({
        text: 'unsafe\u202e',
        rating: 5,
        languageCode: 'en',
        reviewedAtEpochMillis: 3,
      }),
    ).toThrow(/control or bidi/)
    for (const languageCode of ['e', '1n', 'en--US', 'en_US', 'en-abcdefghi']) {
      expect(() =>
        encodeCanonicalAiReviewSource({
          text: null,
          rating: 5,
          languageCode,
          reviewedAtEpochMillis: 3,
        }),
      ).toThrow(/BCP 47/)
    }
    expect(() =>
      encodeCanonicalAiReviewSource({
        text: '[CONTACT]',
        rating: 5,
        languageCode: 'en',
        reviewedAtEpochMillis: 3,
      }),
    ).toThrow(/forbidden closed placeholder/)
    expect(() =>
      canonicalizeRawAiReviewSource({
        text: 'x'.repeat(MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1 + 1),
        reviewerDisplayName: null,
        rating: 5,
        languageCode: null,
        reviewedAtEpochMillis: 3,
      }),
    ).toThrow(/materialization byte limit/)
    expect(() =>
      encodeCanonicalAiReviewSource({
        text: '\ud800',
        rating: 5,
        languageCode: null,
        reviewedAtEpochMillis: 3,
      }),
    ).toThrow(/unpaired surrogate/)
  })
})
