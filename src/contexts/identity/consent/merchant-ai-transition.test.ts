import { describe, expect, it } from 'vitest'
import { runtimeProfilesFor } from './merchant-ai-transition.server'

describe('recorded merchant AI runtime profiles', () => {
  it('preserves the retired profile when renewing an existing mixed grant', () => {
    expect(
      runtimeProfilesFor(['review_analysis', 'reply_drafting', 'property_trends']),
    ).toEqual({
      review_analysis: 'review-analysis-runtime-v2',
      reply_drafting: 'reply-drafting-runtime-v2',
      property_trends: 'property-trends-runtime-v1',
    })
  })

  it('does not add retired processing to a new grant or a revoke', () => {
    expect(runtimeProfilesFor(['review_analysis', 'reply_drafting'])).toEqual({
      review_analysis: 'review-analysis-runtime-v2',
      reply_drafting: 'reply-drafting-runtime-v2',
    })
    expect(runtimeProfilesFor([])).toEqual({})
  })
})
