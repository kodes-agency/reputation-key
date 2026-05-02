import { guestError, isGuestError } from './errors'

describe('guest domain errors', () => {
  it('creates error with tag', () => {
    const err = guestError('invalid_rating', 'Rating must be 1-5')
    expect(err._tag).toBe('GuestError')
    expect(err.code).toBe('invalid_rating')
  })

  it('type guard identifies GuestError', () => {
    const err = guestError('duplicate_rating', 'Already rated')
    expect(isGuestError(err)).toBe(true)
    expect(isGuestError(new Error('nope'))).toBe(false)
  })

  it('includes optional context', () => {
    const err = guestError('feedback_too_long', 'Too long', { max: 1000 })
    expect(err.context).toEqual({ max: 1000 })
  })
})
