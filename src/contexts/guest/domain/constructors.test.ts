import { buildRating, buildFeedback } from './constructors'
import {
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

const baseRatingInput = {
  id: ratingId('10000000-0000-0000-0000-000000000001'),
  organizationId: organizationId('org-test'),
  portalId: portalId('20000000-0000-0000-0000-000000000001'),
  propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
  sessionId: 'session-abc',
  value: 5,
  source: 'qr' as const,
  ipHash: 'hash123',
  now: new Date('2026-05-01T12:00:00Z'),
}

describe('buildRating', () => {
  it('builds valid rating', () => {
    const result = buildRating(baseRatingInput)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      value: 5,
      sessionId: 'session-abc',
      source: 'qr',
    })
  })

  it('rejects invalid rating value', () => {
    const result = buildRating({ ...baseRatingInput, value: 0 })
    expect(result.isErr()).toBe(true)
  })
})

describe('buildFeedback', () => {
  const baseFeedbackInput = {
    id: feedbackId('40000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-test'),
    portalId: portalId('20000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
    sessionId: 'session-abc',
    ratingId: ratingId('10000000-0000-0000-0000-000000000001'),
    comment: 'Great service!',
    source: 'qr' as const,
    ipHash: 'hash123',
    now: new Date('2026-05-01T12:00:00Z'),
  }

  it('builds valid feedback', () => {
    const result = buildFeedback(baseFeedbackInput)
    expect(result.isOk()).toBe(true)
  })

  it('rejects empty feedback', () => {
    const result = buildFeedback({ ...baseFeedbackInput, comment: '' })
    expect(result.isErr()).toBe(true)
  })
})
