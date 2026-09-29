import { describe, expect, it } from 'vitest'
import {
  AI_REVIEW_ANALYSIS_MAX_REOPENS,
  AI_REVIEW_ANALYSIS_REOPEN_CODES,
} from './review-analysis-reopen'

describe('which abandoned Review Analysis is reopened', () => {
  it('reopens the outcomes an import burst produces, where nobody judged the review', () => {
    // The closed-beta drop (2026-09-29) ended as `operation_ambiguous`; the
    // reaper fences stuck attempts as `operation_abandoned`/`operation_ambiguous`.
    expect(AI_REVIEW_ANALYSIS_REOPEN_CODES).toEqual(
      expect.arrayContaining([
        'operation_ambiguous',
        'operation_abandoned',
        'provider_unavailable',
        'provider_rate_limited',
      ]),
    )
  })

  it.each([
    'redaction_blocked',
    'language_not_supported',
    'source_too_large',
    'text_unavailable',
    'source_expired',
    'provider_refused',
    'output_invalid',
    'output_truncated',
    'invalid_request',
    'forbidden',
  ])('never reopens %s, an answer every retry would repeat', (code) => {
    expect(AI_REVIEW_ANALYSIS_REOPEN_CODES).not.toContain(code)
  })

  it('bounds how many operations one revision can cost', () => {
    expect(AI_REVIEW_ANALYSIS_MAX_REOPENS).toBeGreaterThanOrEqual(1)
    expect(AI_REVIEW_ANALYSIS_MAX_REOPENS).toBeLessThanOrEqual(5)
  })
})
