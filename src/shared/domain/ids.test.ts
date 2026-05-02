import { scanEventId, ratingId, feedbackId } from './ids'

describe('guest branded IDs', () => {
  it('creates ScanEventId', () => {
    const id = scanEventId('test-id')
    expect(id).toBe('test-id')
  })

  it('creates RatingId', () => {
    const id = ratingId('test-id')
    expect(id).toBe('test-id')
  })

  it('creates FeedbackId', () => {
    const id = feedbackId('test-id')
    expect(id).toBe('test-id')
  })
})
