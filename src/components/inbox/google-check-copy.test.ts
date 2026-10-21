import { describe, expect, it } from 'vitest'
import { GOOGLE_CHECK_COPY, sayGoogleCheck } from './google-check-copy'

describe('sayGoogleCheck for a check the manager asked for', () => {
  it('tells the manager a reply was found and that the item is closing', () => {
    expect(sayGoogleCheck('reply_found', 'manual')).toEqual({
      tone: 'success',
      message: 'Google shows a reply. Closing this item.',
    })
  })

  it('does not promise to close an item that is not open', () => {
    expect(sayGoogleCheck('reply_found', 'manual', false)).toEqual({
      tone: 'success',
      message: 'Google shows a reply.',
    })
  })

  it('tells the manager Google shows no reply yet', () => {
    expect(sayGoogleCheck('no_reply', 'manual')).toEqual({
      tone: 'info',
      message: 'Google shows no reply yet.',
    })
  })

  it('says one thing, with a minute to wait, for a Google that could not be read and for asking too often', () => {
    const message = "Couldn't check Google right now. Try again in a minute."
    expect(sayGoogleCheck('unavailable', 'manual')).toEqual({ tone: 'error', message })
    expect(sayGoogleCheck('rate_limited', 'manual')).toEqual({ tone: 'info', message })
  })

  it('says a review that cannot be checked will not be, rather than "try again"', () => {
    const say = sayGoogleCheck('not_checkable', 'manual')
    expect(say?.message).toBe(GOOGLE_CHECK_COPY.notCheckable)
    expect(say?.message).not.toMatch(/try again/i)
  })
})

describe('sayGoogleCheck for the check on return from Google', () => {
  it('speaks only when it found the reply, in the words of someone who just wrote one', () => {
    expect(sayGoogleCheck('reply_found', 'return')).toEqual({
      tone: 'success',
      message: 'Google shows your reply. Closing this item.',
    })
  })

  it.each(['no_reply', 'unavailable', 'rate_limited', 'not_checkable'] as const)(
    'says nothing for %s',
    (outcome) => {
      expect(sayGoogleCheck(outcome, 'return')).toBeNull()
    },
  )
})
