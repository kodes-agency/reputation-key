import { describe, expect, it } from 'vitest'
import { replyTimeMissing } from './reply-time-missing'

describe('replyTimeMissing', () => {
  it('is nothing missing when there is an average', () => {
    expect(replyTimeMissing(true, { replyRate: 40, avgReplyHours: 6 })).toBeNull()
  })

  it('says there were no reviews before it says there were no replies', () => {
    expect(replyTimeMissing(false, { replyRate: 0, avgReplyHours: null })).toBe(
      'no_reviews',
    )
  })

  it('says nothing was replied to only when the reply rate is zero', () => {
    expect(replyTimeMissing(true, { replyRate: 0, avgReplyHours: null })).toBe(
      'no_replies',
    )
  })

  it('says the replies have no time when reviews were replied to on Google', () => {
    expect(replyTimeMissing(true, { replyRate: 40, avgReplyHours: null })).toBe(
      'no_reply_times',
    )
  })
})
